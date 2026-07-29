/**
 * Commands for converting AI explanations to inline code comments.
 * Handles both notebook editors and regular file editors.
 */

import * as vscode from 'vscode';
import { getCodeLensProvider } from '../state';
import { checkFileSize } from '../utils/fs-utils';
import { t, storageKey } from '../utils/helpers';
import { getCommentChar } from '../utils/comment-map';
import { getPairedPaths } from '../ui/codelens-provider';
import { buildCommentBlock, deduplicateExplanations, makeCodeFingerprint, findMatchingLine, hasExistingComment } from './comment-helpers';

export async function convertAllToComments(): Promise<void> {
  const codelensProvider = getCodeLensProvider();
  if (!codelensProvider) return;

  const nbEditors = vscode.window.visibleNotebookEditors;
  if (nbEditors.length > 0) {
    await convertAllInNotebooks(codelensProvider, nbEditors);
    return;
  }

  await convertAllInFile(codelensProvider);
}

async function convertAllInNotebooks(
  codelensProvider: NonNullable<ReturnType<typeof getCodeLensProvider>>,
  nbEditors: readonly vscode.NotebookEditor[]
): Promise<void> {
  let total = 0;
  for (const nb of nbEditors) {
    const nbKey = storageKey(nb.notebook.uri);
    let allExps = codelensProvider.getExplanationsWithPositions(nbKey);
    if (allExps.length === 0) {
      for (const p of getPairedPaths(nbKey)) {
        allExps = codelensProvider.getExplanationsWithPositions(p);
        if (allExps.length > 0) break;
      }
    }
    if (allExps.length === 0) {
      const globalExps = codelensProvider.getAllExplanationsGlobal();
      allExps = globalExps.map(e => ({ explanation: e.explanation, snippet: e.snippet, posLine: 0 }));
    }
    if (allExps.length === 0) continue;

    // Get comment char from the first code cell's language
    let nbLang = 'python';
    for (let ci = 0; ci < nb.notebook.cellCount; ci++) {
      const c = nb.notebook.cellAt(ci);
      if (c.kind === vscode.NotebookCellKind.Code) { nbLang = c.document.languageId; break; }
    }
    const nbComment = getCommentChar(nbLang);
    const uniqueExps = deduplicateExplanations(allExps);

    for (let ci = nb.notebook.cellCount - 1; ci >= 0; ci--) {
      const cell = nb.notebook.cellAt(ci);
      if (cell.kind !== vscode.NotebookCellKind.Code) continue;
      const cellText = cell.document.getText();
      if (!cellText.trim()) continue;
      const cellLines = cellText.split('\n');
      let cellCnt = 0;

      interface InsertOp { line: number; text: string }
      const ops: InsertOp[] = [];

      for (const exp of uniqueExps) {
        if (!exp.explanation) continue;
        const codeFP = makeCodeFingerprint(exp.snippet);
        if (!codeFP) continue;

        const matchLine = findMatchingLine(codeFP, cellLines);
        if (matchLine < 0) continue;

        const commentLines = buildCommentBlock(exp.explanation, nbComment);
        if (commentLines.length === 0) continue;

        ops.push({ line: matchLine + 1, text: commentLines.join('\n') + '\n' });
        cellCnt++;
      }

      if (cellCnt > 0) {
        ops.sort((a, b) => b.line - a.line);
        let modified = cellText;
        for (const op of ops) {
          const lines = modified.split('\n');
          const before = lines.slice(0, op.line).join('\n');
          const after = lines.slice(op.line).join('\n');
          modified = before + '\n' + op.text + after;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(cell.document.uri, new vscode.Range(0, 0, cell.document.lineCount, 0), modified);
        if (await vscode.workspace.applyEdit(edit)) total += cellCnt;
      }
    }
  }

  if (total > 0) vscode.window.showInformationMessage(t('已添加 ' + total + ' 条注释', 'Added ' + total + ' comments'));
  else vscode.window.showWarningMessage(t('未找到匹配的 AI 解释', 'No explanations matched'));
}

async function convertAllInFile(
  codelensProvider: NonNullable<ReturnType<typeof getCodeLensProvider>>
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage(t('没有打开的文件', 'No file open')); return; }

  const doc = editor.document;
  if (!checkFileSize(doc)) { vscode.window.showWarningMessage(t('文件过大，跳过处理', 'File too large')); return; }

  let exps = codelensProvider.getExplanationsWithPositions(storageKey(doc.uri));
  if (exps.length === 0) {
    for (const p of getPairedPaths(storageKey(doc.uri))) {
      exps = codelensProvider.getExplanationsWithPositions(p);
      if (exps.length > 0) break;
    }
  }
  if (exps.length === 0) {
    const g = codelensProvider.getAllExplanationsGlobal();
    exps = g.map(e => ({ explanation: e.explanation, snippet: e.snippet, posLine: 0 }));
  }
  if (exps.length === 0) { vscode.window.showInformationMessage(t('没有 AI 解释', 'No explanations')); return; }

  exps = deduplicateExplanations(exps);
  const cc = getCommentChar(doc.languageId);
  const docLines = doc.getText().split('\n');
  let ac = 0;

  for (const exp of exps) {
    const lines = buildCommentBlock(exp.explanation || '', cc);
    if (lines.length === 0) continue;
    const codeFP = makeCodeFingerprint(exp.snippet);
    let insertLine = exp.posLine + 1;
    if (codeFP) {
      const match = findMatchingLine(codeFP, docLines);
      if (match >= 0) insertLine = match + 1;
    }

    // Skip if explanation already exists as comment below
    const belowCheck: string[] = [];
    for (let i = insertLine; i < Math.min(insertLine + lines.length + 5, docLines.length); i++) {
      belowCheck.push(docLines[i] || '');
    }
    if (hasExistingComment(exp.explanation || '', belowCheck)) continue;

    const text = lines.join('\n') + '\n';
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(Math.min(insertLine, doc.lineCount), 0), text);
    if (await vscode.workspace.applyEdit(edit)) ac++;
  }

  if (ac > 0) vscode.window.showInformationMessage(t('已插入 ' + ac + ' 条注释', 'Inserted ' + ac + ' comments'));
  else vscode.window.showWarningMessage(t('插入失败', 'Failed'));
}
