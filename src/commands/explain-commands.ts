/**
 * Commands for explaining code: doExplain, explainSelectedCode, explainNotebookCell, askQuestion.
 */

import * as vscode from 'vscode';
import { getAIServiceManager, getCodeLearnerSettings, getCodeLensProvider } from '../state';
import { checkFileSize } from '../utils/fs-utils';
import { formatTime, t, storageKey } from '../utils/helpers';
import { showError } from '../utils/error-utils';
import { makeCellContext } from '../utils/cell-factory';
import { ExplanationPanel } from '../ui/sidebar/explanation-panel';
import { CellType, CellMarker, CodeCell } from '../parser/cell';

export async function doExplain(editor: vscode.TextEditor, text: string, lang: string, filePath: string, range: vscode.Range, forceRefresh: boolean): Promise<void> {
  const aiServiceManager = getAIServiceManager();
  const codelensProvider = getCodeLensProvider();
  const codeLearnerSettings = getCodeLearnerSettings();
  if (!aiServiceManager || !codelensProvider) return;
  if (!text.trim()) { vscode.window.showWarningMessage(t('没有选中代码', 'No code selected')); return; }
  if (!checkFileSize(editor.document)) return;
  const config = vscode.workspace.getConfiguration('codeLearner');
  const apiKey = await codeLearnerSettings?.getApiKey(config.get<'openai' | 'claude'>('provider', 'openai'));
  if (!apiKey) { const c = await vscode.window.showWarningMessage(t('AI 未配置。现在配置？', 'AI not configured?'), 'Yes'); if (c === 'Yes') await vscode.commands.executeCommand('code-learner.configure'); return; }
  let explanation = '';
  const startTime = Date.now();
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('AI 解析中...', 'Analyzing...'), cancellable: false }, async (progress) => {
      progress.report({ message: t('正在请求 AI...', 'Requesting AI...') });
      for await (const chunk of aiServiceManager.explainCell(makeCellContext(range.start.line, text, lang), editor.document.uri, { getText: () => editor.document.getText(), languageId: lang, lineCount: editor.document.lineCount }, forceRefresh)) {
        explanation += chunk;
        if (explanation.length % 100 === 0) {
          const elapsed = formatTime(Date.now() - startTime);
          progress.report({ message: `${explanation.length} 字符 · ${elapsed}` });
        }
      }
    });
  } catch (e: unknown) { showError('AI 解析', e); return; }
  if (!explanation) { vscode.window.showWarningMessage(t('AI 返回为空', 'Empty response from AI')); return; }
  const elapsed = Date.now() - startTime;
  const lt = editor.document.lineAt(range.start.line).text;
  const bs = lt.slice(Math.max(0, range.start.character - 8), range.start.character);
  await codelensProvider.addExplanation(filePath, range, explanation, (bs + text.split('\n')[0]).trim(), lt + '\n' + text.split('\n').slice(0, 3).join('\n'), { elapsed, chars: explanation.length });
  editor.selection = new vscode.Selection(range.end, range.end); editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  setTimeout(async () => { await vscode.commands.executeCommand('editor.action.showHover'); }, 300);
}

export async function explainSelectedCode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) { vscode.window.showWarningMessage(t('请先选中一些代码', 'Select code first')); return; }
  await doExplain(editor, editor.document.getText(editor.selection), editor.document.languageId, storageKey(editor.document.uri), new vscode.Range(editor.selection.start, editor.selection.end), false);
}

export async function explainNotebookCell(context: vscode.ExtensionContext, cellContext: vscode.NotebookCell | undefined, mode: 'panel' | 'inline'): Promise<void> {
  const aiServiceManager = getAIServiceManager();
  const codelensProvider = getCodeLensProvider();
  if (!aiServiceManager) return;
  let code = '', lang = 'python';
  let nbEditor: vscode.NotebookEditor | undefined;
  let cellIndex = -1;
  try {
    if (cellContext?.document) {
      code = cellContext.document.getText(); lang = cellContext.document.languageId;
      for (const nb of vscode.window.visibleNotebookEditors) {
        const cells = nb.notebook.getCells();
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].document.uri.toString() === cellContext.document.uri.toString()) { cellIndex = i; nbEditor = nb; break; }
        }
        if (nbEditor) break;
      }
    }
  } catch (e: unknown) { showError('读取单元格', e); return; }
  if (!code) { const e = vscode.window.activeTextEditor; if (e) { code = e.document.getText(); lang = e.document.languageId; } }
  if (!code) { vscode.window.showWarningMessage(t('未找到代码', 'No code')); return; }

  if (mode === 'inline' && nbEditor && cellIndex >= 0) {
    let exp = '';
    const cellUri = cellContext?.document?.uri || vscode.Uri.file('nb-cell-' + cellIndex);
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('AI 解析中...', 'Analyzing...'), cancellable: true }, async (_, token) => {
        if (token.isCancellationRequested) return;
        for await (const c of aiServiceManager.explainCell(makeCellContext(cellIndex, code, lang), cellUri, { getText: () => code, languageId: lang }, false)) { if (token.isCancellationRequested) return; exp += c; }
      });
    } catch (e: unknown) { showError('AI 解析', e); return; }
    if (!exp) { vscode.window.showWarningMessage(t('AI 返回为空', 'Empty response')); return; }
    const wrapped = `<div style="font-size:13px;font-family:Consolas,'Fira Code',monospace;line-height:1.5">\n\n**AI 解析**\n\n${exp}\n\n</div>`;
    const mdCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, wrapped, 'markdown');
    const edit = new vscode.WorkspaceEdit(); edit.set(nbEditor.notebook.uri, [vscode.NotebookEdit.insertCells(cellIndex + 1, [mdCell])]);
    await vscode.workspace.applyEdit(edit);
  } else {
    // Panel mode
    const tc: CodeCell = { index: 0, type: CellType.CODE, startLine: 0, endLine: code.split('\n').length - 1, source: code, marker: CellMarker.AUTO_SECTION, language: lang };
    const panel = ExplanationPanel.createOrShow(context.extensionUri); panel.showExplanation(tc, lang); panel.showLoading();
  const pStartTime = Date.now();
    const to = setTimeout(() => panel.streamError(t('超时', 'Timeout')), 60000);
    const cellUri = cellContext?.document?.uri || vscode.Uri.file('nb-cell');
    try {
      for await (const c of aiServiceManager.explainCell({ ...tc, index: cellIndex >= 0 ? cellIndex : 0 } as CodeCell, cellUri, { getText: () => code, languageId: lang }, false)) { clearTimeout(to); panel.updateStream(c); }
      clearTimeout(to); panel.streamComplete(Date.now() - pStartTime, code.length);
    } catch (e: unknown) { clearTimeout(to); panel.streamError(e instanceof Error ? e.message : String(e)); showError('AI 解析', e); }
  }
}

export async function askQuestion(uri: vscode.Uri, line: number, col: number): Promise<void> {
  const aiServiceManager = getAIServiceManager();
  const codelensProvider = getCodeLensProvider();
  if (!aiServiceManager || !codelensProvider || !uri) return;
  const q = await vscode.window.showInputBox({ prompt: t('输入问题', 'Ask a question'), ignoreFocusOut: true }); if (!q) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  const pos = new vscode.Position(line, col);
  const range = new vscode.Range(pos, new vscode.Position(line, doc.lineAt(line).text.length));
  const text = doc.getText(range); if (!text.trim()) return;
  const ee = codelensProvider.getExplanation(uri, line);
  const ctx = ee ? 'Code:\n' + text + '\n\nPrevious:\n' + ee.explanation + '\n\nQ: ' + q : 'Code:\n' + text + '\n\nQ: ' + q;
  let a = '';
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('AI 回答中...', 'Thinking...'), cancellable: false }, async () => {
    for await (const c of aiServiceManager.explainCell(makeCellContext(line, ctx, doc.languageId), uri, { getText: () => doc.getText(), languageId: doc.languageId, lineCount: doc.lineCount }, true)) a += c;
  });
  if (!a) return;
  if (ee) await codelensProvider.appendQuestion(uri, line, q, a);
  else await codelensProvider.addExplanation(uri.fsPath, range, a);
  await vscode.commands.executeCommand('editor.action.hideHover');
  setTimeout(async () => { await vscode.commands.executeCommand('editor.action.showHover'); }, 200);
}
