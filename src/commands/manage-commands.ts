/**
 * Small inline-action commands: re-explain, delete, copy QA, delete QA, toComment.
 */

import * as vscode from 'vscode';
import { getAIServiceManager, getCodeLensProvider } from '../state';
import { getCommentChar } from '../utils/comment-map';
import { buildCommentBlock, hasExistingComment } from './comment-helpers';
import { storageKey, t } from '../utils/helpers';
import { doExplain } from './explain-commands';

export async function reExplain(uri: vscode.Uri, line: number, col: number): Promise<void> {
  const aiServiceManager = getAIServiceManager();
  const codelensProvider = getCodeLensProvider();
  if (!aiServiceManager || !codelensProvider || !uri) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  const ed = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(line, col);
  const range = new vscode.Range(pos, new vscode.Position(line, doc.lineAt(line).text.length));
  const text = doc.getText(range);
  if (text.trim()) {
    await doExplain(ed, text, doc.languageId, uri.scheme === 'file' ? uri.fsPath : uri.toString(), range, true);
  }
}

export async function deleteExplanation(uri: vscode.Uri, line: number): Promise<void> {
  const codelensProvider = getCodeLensProvider();
  if (!codelensProvider || !uri) return;
  // Read the line text to compute fingerprint, so only the matching explanation is removed
  let fingerprint: string | undefined;
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (line < doc.lineCount) {
      const lineText = doc.lineAt(line).text;
      // Compute fingerprint the same way as makeFP in codelens-provider
      fingerprint = lineText.split('\n')[0]?.trim().replace(/\s+/g, '').slice(0, 60).toLowerCase() || undefined;
    }
  } catch { /* fallback: no fingerprint = delete all for the file */ }
  await codelensProvider.removeExplanation(uri.fsPath, line, fingerprint);
  await vscode.commands.executeCommand('editor.action.hideHover');
}

export async function copyQA(q: string, a: string): Promise<void> {
  if (!q || !a) return;
  try { await vscode.env.clipboard.writeText('Q: ' + q + '\nA: ' + a); } catch { /* */ }
}

export async function deleteQA(uri: vscode.Uri, line: number, id: string): Promise<void> {
  const codelensProvider = getCodeLensProvider();
  if (!codelensProvider || !uri || !id) return;
  await codelensProvider.removeQAPair(uri, line, id);
  await vscode.commands.executeCommand('editor.action.hideHover');
  setTimeout(async () => { await vscode.commands.executeCommand('editor.action.showHover'); }, 200);
}

export async function toComment(uri: vscode.Uri, line: number): Promise<void> {
  const codelensProvider = getCodeLensProvider();
  if (!codelensProvider || !uri) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  const exp = codelensProvider.getExplanation(uri, line, doc.lineAt(Math.min(line, doc.lineCount - 1)).text);
  if (!exp) return;
  const cc = getCommentChar(doc.languageId);
  const cl = buildCommentBlock(exp.explanation, cc);
  if (cl.length === 0) return;
  // Check if comment already exists below
  const nextLines: string[] = [];
  for (let i = line + 1; i < Math.min(line + 1 + cl.length + 5, doc.lineCount); i++) {
    nextLines.push(doc.lineAt(i).text);
  }
  if (hasExistingComment(exp.explanation, nextLines)) { vscode.window.showWarningMessage(t("插入失败：已有相应注释", "Insert failed: comment already exists")); return; }
  const text = cl.join('\n') + '\n';
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(Math.min(line + 1, doc.lineCount), 0), text);
  await vscode.workspace.applyEdit(edit);
  await vscode.commands.executeCommand('editor.action.hideHover');
}

/**
 * Delete all AI explanations for the current file (right-click menu).
 */
export async function deleteAtCursor(): Promise<void> {
  const codelensProvider = getCodeLensProvider();
  const editor = vscode.window.activeTextEditor;
  if (!codelensProvider || !editor) return;

  const filePath = storageKey(editor.document.uri);
  const exps = codelensProvider.getExplanationsWithPositions(filePath);

  if (exps.length === 0) {
    vscode.window.showWarningMessage(t('没有 AI 解释可删除', 'No AI explanations to delete'));
    return;
  }

  // Remove all explanations for this file (removeExplanation handles paired paths too)
  await codelensProvider.removeExplanation(filePath, 0);
  vscode.window.showInformationMessage(
    t(`已删除 ${exps.length} 条 AI 解释`, `Deleted ${exps.length} AI explanations`)
  );
}

/**
 * Copy only the explanation text (no header, no buttons) to clipboard.
 */
export async function copyExplanation(uri: vscode.Uri, line: number): Promise<void> {
  const codelensProvider = getCodeLensProvider();
  if (!codelensProvider || !uri) return;
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const lineText = line < doc.lineCount ? doc.lineAt(line).text : '';
    const exp = codelensProvider.getExplanation(uri, line, lineText);
    if (exp?.explanation) {
      await vscode.env.clipboard.writeText(exp.explanation);
      vscode.window.showInformationMessage(t("复制成功", "Copied"));
    }
  } catch { /* silent */ }
}
