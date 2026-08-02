/**
 * Commands for converting AI explanations to inline code comments.
 * Handles both notebook editors and regular file editors.
 */

import * as vscode from 'vscode';
import { getCodeLensProvider } from '../state';
import { checkFileSize } from '../utils/fs-utils';
import { t, storageKey } from '../utils/helpers';
import { getCommentChar } from '../utils/comment-map';
import { getLanguageFromExtension } from '../utils/language-map';
import { getPairedPaths } from '../ui/codelens-provider';
import { buildCommentBlock, deduplicateExplanations, makeCodeFingerprint, findMatchingLine, hasExistingComment } from './comment-helpers';

/**
 * Restrict the global fallback (explanations from other files) to entries that
 * plausibly belong to the target language — otherwise same-first-line code in
 * unrelated files gets the wrong explanation inserted.
 */
function filterExplanationsByLanguage(
  exps: { explanation: string; snippet: string; filePath: string }[],
  targetLanguageId: string,
  targetPath: string
): { explanation: string; snippet: string; filePath: string }[] {
  const targetExt = targetPath.split('.').pop()?.toLowerCase() || '';
  return exps.filter(e => {
    if (!e.filePath) return true;
    const srcExt = e.filePath.split('.').pop()?.toLowerCase() || '';
    if (targetExt === 'ipynb') {
      // Notebook cells may have been explained from the source file or the notebook.
      return srcExt === 'ipynb' || srcExt === 'py';
    }
    if (srcExt === targetExt) return true;
    return getLanguageFromExtension('.' + srcExt) === targetLanguageId;
  });
}

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
    // Language of the first code cell (used for comment syntax and for
    // filtering the global fallback below).
    let nbLang = 'python';
    for (let ci = 0; ci < nb.notebook.cellCount; ci++) {
      const c = nb.notebook.cellAt(ci);
      if (c.kind === vscode.NotebookCellKind.Code) { nbLang = c.document.languageId; break; }
    }
    let allExps = codelensProvider.getExplanationsWithPositions(nbKey);
    if (allExps.length === 0) {
      for (const p of getPairedPaths(nbKey)) {
        allExps = codelensProvider.getExplanationsWithPositions(p);
        if (allExps.length > 0) break;
      }
    }
    if (allExps.length === 0) {
      const globalExps = filterExplanationsByLanguage(codelensProvider.getAllExplanationsGlobal(), nbLang, nbKey);
      allExps = globalExps.map(e => ({ explanation: e.explanation, snippet: e.snippet, posLine: 0 }));
    }
    if (allExps.length === 0) continue;

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
      // One comment per line — multiple explanations whose snippet matches
      // the same line would otherwise stack.
      const usedLines = new Set<number>();

      for (const exp of uniqueExps) {
        if (!exp.explanation) continue;
        const codeFP = makeCodeFingerprint(exp.snippet);
        if (!codeFP) continue;

        const matchLine = findMatchingLine(codeFP, cellLines);
        if (matchLine < 0) continue;
        const insertLine = matchLine + 1;
        if (usedLines.has(insertLine)) continue;
        usedLines.add(insertLine);

        const commentLines = buildCommentBlock(exp.explanation, nbComment);
        if (commentLines.length === 0) continue;

        ops.push({ line: insertLine, text: commentLines.join('\n') + '\n' });
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
    const g = filterExplanationsByLanguage(codelensProvider.getAllExplanationsGlobal(), doc.languageId, doc.fileName);
    exps = g.map(e => ({ explanation: e.explanation, snippet: e.snippet, posLine: 0 }));
  }
  if (exps.length === 0) { vscode.window.showInformationMessage(t('没有 AI 解释', 'No explanations')); return; }

  exps = deduplicateExplanations(exps);
  const cc = getCommentChar(doc.languageId);
  const docLines = doc.getText().split('\n');

  // Collect all insertions, then apply them in ONE WorkspaceEdit in
  // descending line order. Applying edits one-by-one against a stale
  // snapshot would shift later insertion points into the wrong lines.
  const inserts: { line: number; text: string }[] = [];
  const usedLines = new Set<number>();

  for (const exp of exps) {
    const lines = buildCommentBlock(exp.explanation || '', cc);
    if (lines.length === 0) continue;
    // Same guard as the notebook path: without a matching code line the
    // explanation is skipped — a global-fallback explanation whose code no
    // longer matches must not land at the top of the file.
    const codeFP = makeCodeFingerprint(exp.snippet);
    if (!codeFP) continue;
    const match = findMatchingLine(codeFP, docLines, exp.posLine);
    if (match < 0) continue;
    const insertLine = Math.min(match + 1, doc.lineCount);

    // Skip if explanation already exists as comment below
    const belowCheck: string[] = [];
    for (let i = insertLine; i < Math.min(insertLine + lines.length + 5, docLines.length); i++) {
      belowCheck.push(docLines[i] || '');
    }
    if (hasExistingComment(exp.explanation || '', belowCheck)) continue;

    // One comment per line — multiple explanations matching the same line
    // would otherwise stack at the same position.
    if (usedLines.has(insertLine)) continue;
    usedLines.add(insertLine);

    inserts.push({ line: insertLine, text: lines.join('\n') + '\n' });
  }

  const edit = new vscode.WorkspaceEdit();
  inserts.sort((a, b) => b.line - a.line);
  for (const ins of inserts) {
    edit.insert(doc.uri, new vscode.Position(ins.line, 0), ins.text);
  }
  const applied = inserts.length > 0 && await vscode.workspace.applyEdit(edit);

  if (applied) vscode.window.showInformationMessage(t('已插入 ' + inserts.length + ' 条注释', 'Inserted ' + inserts.length + ' comments'));
  else vscode.window.showWarningMessage(t('插入失败', 'Failed'));
}
