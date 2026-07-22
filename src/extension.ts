import * as vscode from 'vscode';
import * as path from 'path';
import { CodeLearnerSettings } from './config/settings';
import { AIServiceManager } from './ai/ai-service-manager';
import { ExplanationCache } from './ai/cache';
import { ExplanationPanel } from './ui/sidebar/explanation-panel';
import { generateNotebook } from './ai/nb-generator';
import { CodeLearnerCodeLensProvider, registerFilePair, setStoragePath, getPairedPaths } from './ui/codelens-provider';
import { AIHoverProvider } from './ui/hover-provider';
import { getCommentChar } from './utils/comment-map';

let aiServiceManager: AIServiceManager | undefined;
let codeLearnerSettings: CodeLearnerSettings | undefined;
let codelensProvider: CodeLearnerCodeLensProvider | undefined;
let aiHover: AIHoverProvider | undefined;

// ── Constants ──────────────────────────────────────────
const MAX_FILE_LINES = 5000;
const MAX_FILE_SIZE = 500 * 1024; // 500KB

function checkFileSize(doc: vscode.TextDocument): boolean {
  if (doc.lineCount > MAX_FILE_LINES) {
    vscode.window.showWarningMessage(`文件过大 (${doc.lineCount} 行)，已跳过处理。Code Learner 支持最大 ${MAX_FILE_LINES} 行`);
    return false;
  }
  return true;
}

function formatTime(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

// ── Operation lock ─────────────────────────────────────
let processing = false;
async function withLock<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (processing) {
    vscode.window.showWarningMessage('请等待当前操作完成');
    return undefined;
  }
  processing = true;
  try { return await fn(); }
  catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`[Code Learner] ${label}:`, msg);
    vscode.window.showErrorMessage(`操作失败: ${msg}`);
    return undefined;
  }
  finally { processing = false; }
}

function showError(context: string, e: any): void {
  let msg = e?.message || String(e);
  // Mask API keys in error messages for security
  msg = msg.replace(/sk-([a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, 'sk-$1****');
  msg = msg.replace(/sk-ant-([a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, 'sk-ant-$1****');
  console.error(`[Code Learner] ${context}:`, msg);
  vscode.window.showErrorMessage(msg.length > 200 ? msg.slice(0, 200) + '...' : msg);
}

function storageKey(uri: vscode.Uri): string {
  if (uri.scheme === 'file') return uri.fsPath;
  const p = decodeURIComponent(uri.path).replace(/^\/([a-zA-Z]:\/)/, '$1');
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
}
function t(zh: string, en: string): string { return vscode.env.language.startsWith('zh') ? zh : en; }

export function activate(context: vscode.ExtensionContext) {
  const cache = new ExplanationCache();
  const settings = new CodeLearnerSettings(context.secrets);
  codeLearnerSettings = settings;
  aiServiceManager = new AIServiceManager(settings, cache);
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.openAsNotebook', () => withLock('Open as Notebook', () => openAsNotebook(context))));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.configure', () => settings.runSetupWizard()));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.explainCell', (c?: any) => withLock('Explain cell', () => explainNotebookCell(context, c, 'panel'))));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.explainCellBelow', (c?: any) => withLock('Explain below', () => explainNotebookCell(context, c, 'inline'))));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.explainSelected', () => withLock('Explain selected', () => explainSelectedCode())));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.convertAllToComments', () => withLock('Convert all', async () => { await convertAllToComments(); })));
  if (context.globalStorageUri) setStoragePath(context.globalStorageUri.fsPath);
  codelensProvider = new CodeLearnerCodeLensProvider();
  context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codelensProvider));
  for (const ed of vscode.window.visibleTextEditors) codelensProvider.applyAllDecorations(ed);
  aiHover = new AIHoverProvider(codelensProvider);
  context.subscriptions.push(vscode.languages.registerHoverProvider({ pattern: '**' }, aiHover));

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(ed => { if (ed && codelensProvider) codelensProvider.applyAllDecorations(ed); }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
    if (e.document.uri.scheme !== 'file' && e.document.uri.scheme !== 'vscode-notebook-cell') return;
    for (const ed of vscode.window.visibleTextEditors) { if (ed.document.uri.toString() === e.document.uri.toString()) { codelensProvider?.applyAllDecorations(ed); break; } }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.reExplain', async (uri, line, col) => {
    if (!aiServiceManager || !codelensProvider || !uri) return;
    const doc = await vscode.workspace.openTextDocument(uri); const ed = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(line, col); const range = new vscode.Range(pos, new vscode.Position(line, doc.lineAt(line).text.length));
    const text = doc.getText(range); if (text.trim()) await doExplain(ed, text, doc.languageId, storageKey(uri), range, true);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.deleteExplanation', async (uri, line) => {
    if (!codelensProvider || !uri) return; codelensProvider.removeExplanation(uri.fsPath, line); await vscode.commands.executeCommand('editor.action.hideHover');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.copyQA', async (q, a) => {
    if (!q || !a) return; try { await vscode.env.clipboard.writeText('Q: ' + q + '\nA: ' + a); } catch { /* */ }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.deleteQA', async (uri, line, id) => {
    if (!codelensProvider || !uri || !id) return; codelensProvider.removeQAPair(uri, line, id);
    await vscode.commands.executeCommand('editor.action.hideHover'); setTimeout(async () => { await vscode.commands.executeCommand('editor.action.showHover'); }, 200);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.askQuestion', async (uri, line, col) => {
    if (!aiServiceManager || !codelensProvider || !uri) return;
    const q = await vscode.window.showInputBox({ prompt: t('输入问题', 'Ask a question'), ignoreFocusOut: true }); if (!q) return;
    const doc = await vscode.workspace.openTextDocument(uri); const pos = new vscode.Position(line, col);
    const range = new vscode.Range(pos, new vscode.Position(line, doc.lineAt(line).text.length)); const text = doc.getText(range); if (!text.trim()) return;
    const ee = codelensProvider.getExplanation(uri, line);
    const ctx = ee ? 'Code:\n' + text + '\n\nPrevious:\n' + ee.explanation + '\n\nQ: ' + q : 'Code:\n' + text + '\n\nQ: ' + q;
    let a = ''; await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('AI 回答中...', 'Thinking...'), cancellable: false }, async () => {
      for await (const c of aiServiceManager!.explainCell({ index: line, source: ctx, language: doc.languageId } as any, uri, { getText: () => doc.getText(), languageId: doc.languageId } as any, true)) a += c;
    }); if (!a) return;
    if (ee) codelensProvider.appendQuestion(uri, line, q, a); else codelensProvider.addExplanation(uri.fsPath, range, a);
    await vscode.commands.executeCommand('editor.action.hideHover'); setTimeout(async () => { await vscode.commands.executeCommand('editor.action.showHover'); }, 200);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('code-learner.toComment', async (uri, line) => {
    if (!codelensProvider || !uri) return; const doc = await vscode.workspace.openTextDocument(uri);
    const exp = codelensProvider.getExplanation(uri, line, doc.lineAt(Math.min(line, doc.lineCount - 1)).text); if (!exp) return;
    const cc = getCommentChar(doc.languageId);
    const cl = exp.explanation.split('\n').map((l: string) => { const t = l.trim(); if (!t) return cc; const c = t.replace(/^###?\s*/gm, '').replace(/\*\*/g, '').replace(/^---.*$/gm, ''); return (c.startsWith('```') || c.startsWith('---') || c.startsWith('[')) ? cc : cc + c; }).filter((l: string) => l.trim() !== cc.trim());
    if (cl.length === 0) return; const text = cl.join('\n') + '\n';
    const edit = new vscode.WorkspaceEdit(); edit.insert(uri, new vscode.Position(Math.min(line + 1, doc.lineCount), 0), text);
    await vscode.workspace.applyEdit(edit); await vscode.commands.executeCommand('editor.action.hideHover');
  }));
  // Handle file renames: update stored explanations with new path
  context.subscriptions.push(vscode.workspace.onDidRenameFiles(async (e) => {
    if (!codelensProvider) return;
    for (const file of e.files) {
      const oldPath = file.oldUri.fsPath;
      const newPath = file.newUri.fsPath;
      // Move explanations from old path to new path
      const exps = codelensProvider.getExplanationsWithPositions(oldPath);
      if (exps.length > 0) {
        // Copy to new path
        for (const exp of exps) {
          const snippet = exp.snippet || '';
          codelensProvider.addExplanation(newPath, new vscode.Range(0, 0, 0, 0), exp.explanation, '', snippet);
        }
        // Remove old path
        codelensProvider.removeExplanation(oldPath, 0);
      }
    }
  }));

  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sb.text = 'Open as Jupyter Notebook'; sb.command = 'code-learner.openAsNotebook';
  context.subscriptions.push(sb);
  const updateSb = () => { const e = vscode.window.activeTextEditor; if (e && e.document.uri.scheme === 'file' && e.document.languageId !== 'ipynb') sb.show(); else sb.hide(); };
  updateSb(); context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateSb()));

  async function convertAllToComments(): Promise<void> {
    if (!codelensProvider) return;
    const nbEditors = vscode.window.visibleNotebookEditors;
    if (nbEditors.length > 0) {
      let total = 0;
      for (const nb of nbEditors) {
        // Get explanations for this notebook (by file path or paired files)
        const nbKey = storageKey(nb.notebook.uri);
        let allExps = codelensProvider.getExplanationsWithPositions(nbKey);
        if (allExps.length === 0) {
          for (const p of getPairedPaths(nbKey)) {
            allExps = codelensProvider.getExplanationsWithPositions(p);
            if (allExps.length > 0) break;
          }
        }
        if (allExps.length === 0) {
          // Fallback to global
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

        // Deduplicate by explanation content
        const seen = new Set<string>();
        const uniqueExps = allExps.filter(e => {
          if (!e.explanation || seen.has(e.explanation)) return false;
          seen.add(e.explanation); return true;
        });

        for (let ci = nb.notebook.cellCount - 1; ci >= 0; ci--) {
          const cell = nb.notebook.cellAt(ci);
          if (cell.kind !== vscode.NotebookCellKind.Code) continue;
          const cellText = cell.document.getText(); if (!cellText.trim()) continue;
          const cellLines = cellText.split('\n');
          let cellCnt = 0;

          // Collect (insertLine, commentBlock) pairs for this cell
          interface InsertOp { line: number; text: string }
          const ops: InsertOp[] = [];

          for (const exp of uniqueExps) {
            if (!exp.explanation) continue;
            const codeFP = (exp.snippet || '').split('\n')[0]?.trim().replace(/\s+/g, '').slice(0, 40).toLowerCase() || '';
            if (!codeFP) continue;

            // Find which line in the cell matches this explanation
            let matchLine = -1;
            for (let li = 0; li < cellLines.length; li++) {
              const lf = cellLines[li].trim().replace(/\s+/g, '').slice(0, 40).toLowerCase();
              if (lf && (lf.includes(codeFP) || codeFP.includes(lf))) { matchLine = li; break; }
            }
            if (matchLine < 0) continue;

            const commentLines = exp.explanation.split('\n').map((l: string) => {
              const t = l.trim(); if (!t) return ''; const cx = t.replace(/^###?\s*/g, '').replace(/\*\*/g, '').replace(/^---.*$/g, '');
              return cx.startsWith('```') ? '' : nbComment + cx;
            }).filter(Boolean);
            if (commentLines.length === 0) continue;

            ops.push({ line: matchLine + 1, text: nbComment + '--- AI 解析 ---\n' + commentLines.join('\n') + '\n' });
            cellCnt++;
          }

          if (cellCnt > 0) {
            // Apply inserts in reverse order so line numbers stay valid
            ops.sort((a, b) => b.line - a.line);
            let modified = cellText;
            for (const op of ops) {
              const lines = modified.split('\n');
              const before = lines.slice(0, op.line).join('\n');
              const after = lines.slice(op.line).join('\n');
              modified = before + '\n' + op.text + after;
            }
            const edit = new vscode.WorkspaceEdit(); edit.replace(cell.document.uri, new vscode.Range(0, 0, cell.document.lineCount, 0), modified);
            if (await vscode.workspace.applyEdit(edit)) total += cellCnt;
          }
        }
      }
      if (total > 0) vscode.window.showInformationMessage(t('已添加 ' + total + ' 条注释', 'Added ' + total + ' comments'));
      else vscode.window.showWarningMessage(t('未找到匹配的 AI 解释', 'No explanations matched'));
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage(t('没有打开的文件', 'No file open')); return; }
    const doc = editor.document; if (!checkFileSize(doc)) { vscode.window.showWarningMessage(t('文件过大，跳过处理', 'File too large')); return; }
    let exps = codelensProvider.getExplanationsWithPositions(storageKey(doc.uri));
    if (exps.length === 0) { for (const p of getPairedPaths(storageKey(doc.uri))) { exps = codelensProvider.getExplanationsWithPositions(p); if (exps.length > 0) break; } }
    if (exps.length === 0) {
      const g = codelensProvider.getAllExplanationsGlobal();
      exps = g.map(e => ({ explanation: e.explanation, snippet: e.snippet, posLine: 0 }));
    }
    if (exps.length === 0) { vscode.window.showInformationMessage(t('没有 AI 解释', 'No explanations')); return; }
    // Deduplicate
    const seen = new Set<string>();
    exps = exps.filter(e => { if (!e.explanation || seen.has(e.explanation)) return false; seen.add(e.explanation); return true; });
    const cc = getCommentChar(doc.languageId);
    const docLines = doc.getText().split('\n');
    let ac = 0;
    for (const exp of exps) {
      const lines = (exp.explanation || '').split('\n').map((l: string) => {
        const t = l.trim(); if (!t) return ''; const c = t.replace(/^###?\s*/g, '').replace(/\*\*/g, '').replace(/^---.*$/g, '');
        if (c.startsWith('```') || c.startsWith('---') || c.startsWith('[') || c.startsWith('![')) return ''; return cc + c;
      }).filter((l: string) => l.trim() !== cc.trim()); if (lines.length === 0) continue;

      // Find the right line: match code snippet to document lines
      const codeFP = (exp.snippet || '').split('\n')[0]?.trim().replace(/\s+/g, '').slice(0, 40).toLowerCase() || '';
      let insertLine = exp.posLine + 1; // default to stored position
      if (codeFP) {
        for (let l = 0; l < docLines.length; l++) {
          const lf = docLines[l].trim().replace(/\s+/g, '').slice(0, 40).toLowerCase();
          if (lf && (lf.includes(codeFP) || codeFP.includes(lf))) { insertLine = l + 1; break; }
        }
      }

      const text = cc + '--- AI 解析 ---\n' + lines.join('\n') + '\n';
      const edit = new vscode.WorkspaceEdit(); edit.insert(doc.uri, new vscode.Position(Math.min(insertLine, doc.lineCount), 0), text);
      if (await vscode.workspace.applyEdit(edit)) ac++;
    }
    if (ac > 0) vscode.window.showInformationMessage(t('已插入 ' + ac + ' 条注释', 'Inserted ' + ac + ' comments'));
    else vscode.window.showWarningMessage(t('插入失败', 'Failed'));
  }
}

export function deactivate() {}

// ── Core functions ──────────────────────────────────────

async function doExplain(editor: vscode.TextEditor, text: string, lang: string, filePath: string, range: vscode.Range, forceRefresh: boolean): Promise<void> {
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
      for await (const chunk of aiServiceManager!.explainCell({ index: range.start.line, source: text, language: lang } as any, editor.document.uri, { getText: () => editor.document.getText(), languageId: lang } as any, forceRefresh)) {
        explanation += chunk;
        if (explanation.length % 100 === 0) {
          const elapsed = formatTime(Date.now() - startTime);
          progress.report({ message: `${explanation.length} 字符 · ${elapsed}` });
        }
      }
    });
  } catch (e: any) { showError('AI 解析', e); return; }
  if (!explanation) { vscode.window.showWarningMessage(t('AI 返回为空', 'Empty response from AI')); return; }
  const lt = editor.document.lineAt(range.start.line).text;
  const bs = lt.slice(Math.max(0, range.start.character - 8), range.start.character);
  codelensProvider.addExplanation(filePath, range, explanation, (bs + text.split('\n')[0]).trim(), lt + '\n' + text.split('\n').slice(0, 3).join('\n'));
  editor.selection = new vscode.Selection(range.end, range.end); editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  setTimeout(async () => { await vscode.commands.executeCommand('editor.action.showHover'); }, 300);
}

async function explainSelectedCode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) { vscode.window.showWarningMessage(t('请先选中一些代码', 'Select code first')); return; }
  await doExplain(editor, editor.document.getText(editor.selection), editor.document.languageId, storageKey(editor.document.uri), new vscode.Range(editor.selection.start, editor.selection.end), false);
}

async function explainNotebookCell(context: vscode.ExtensionContext, cellContext: any, mode: 'panel' | 'inline'): Promise<void> {
  if (!aiServiceManager) return; let code = '', lang = 'python'; let nbEditor: vscode.NotebookEditor | undefined;
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
  } catch (e: any) { showError('读取单元格', e); return; }
  if (!code) { const e = vscode.window.activeTextEditor; if (e) { code = e.document.getText(); lang = e.document.languageId; } }
  if (!code) { vscode.window.showWarningMessage(t('未找到代码', 'No code')); return; }

  if (mode === 'inline' && nbEditor && cellIndex >= 0) {
    let exp = '';
    const cellUri = cellContext?.document?.uri || vscode.Uri.file('nb-cell-' + cellIndex);
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('AI 解析中...', 'Analyzing...'), cancellable: true }, async (_, token) => {
        if (token.isCancellationRequested) return;
        for await (const c of aiServiceManager!.explainCell({ index: cellIndex, source: code, language: lang } as any, cellUri, { getText: () => code, languageId: lang } as any, false)) { if (token.isCancellationRequested) return; exp += c; }
      });
    } catch (e: any) { showError('AI 解析', e); return; }
    if (!exp) { vscode.window.showWarningMessage(t('AI 返回为空', 'Empty response')); return; }
    const wrapped = `<div style="font-size:13px;font-family:Consolas,'Fira Code',monospace;line-height:1.5">\n\n**AI 解析**\n\n${exp}\n\n</div>`;
    const mdCell = new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, wrapped, 'markdown');
    const edit = new vscode.WorkspaceEdit(); edit.set(nbEditor.notebook.uri, [vscode.NotebookEdit.insertCells(cellIndex + 1, [mdCell])]);
    await vscode.workspace.applyEdit(edit);
  } else {
    // Panel mode
    const tc = { index: 0, type: 'code' as any, startLine: 0, endLine: code.split('\n').length - 1, source: code, marker: 'auto-section' as any, language: lang };
    const panel = ExplanationPanel.createOrShow(context.extensionUri); panel.showExplanation(tc, lang); panel.showLoading();
    const to = setTimeout(() => panel.streamError(t('超时', 'Timeout')), 60000);
    const cellUri = cellContext?.document?.uri || vscode.Uri.file('nb-cell'); try { for await (const c of aiServiceManager.explainCell({ ...tc, index: cellIndex >= 0 ? cellIndex : 0 } as any, cellUri, { getText: () => code, languageId: lang } as any, false)) { clearTimeout(to); panel.updateStream(c); } clearTimeout(to); panel.streamComplete(); }
	    catch (e: any) { clearTimeout(to); panel.streamError(e?.message || String(e)); showError('AI 解析', e); }
  }
}

async function openAsNotebook(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage(t('没有打开的文件', 'No active editor')); return; }
  const document = editor.document; if (document.uri.scheme !== 'file') { vscode.window.showWarningMessage(t('只支持文件', 'Only files')); return; }
  if (!checkFileSize(document)) return;
  const apiKey = await codeLearnerSettings?.getApiKey(vscode.workspace.getConfiguration('codeLearner').get<'openai' | 'claude'>('provider', 'openai'));
  if (!apiKey) { const c = await vscode.window.showWarningMessage(t('AI 未配置。现在配置？', 'AI not configured?'), 'Yes', 'Cancel'); if (c === 'Yes') { await codeLearnerSettings?.runSetupWizard(); await openAsNotebook(context); } return; }
  const srcPath = document.uri.fsPath;
  const storedExps: { snippet: string; explanation: string }[] = codelensProvider?.getAllExplanations(srcPath) || [];
  let result: Awaited<ReturnType<typeof generateNotebook>>;
  const convertStart = Date.now();
  try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('转换中...', 'Converting...'), cancellable: false }, async (p) => { p.report({ message: t('AI 分析中...', 'Analyzing...') }); result = await generateNotebook(document, codeLearnerSettings!, storedExps); p.report({ message: t('完成 (' + formatTime(Date.now() - convertStart) + ')', 'Done (' + formatTime(Date.now() - convertStart) + ')') }); }); }
  catch (e: any) { vscode.window.showErrorMessage(t('转换失败', 'Failed') + ': ' + (e?.message || String(e))); return; }
  const enc = new TextEncoder(); const nb = result!.content;
  // Save notebook in the same directory as source file
  const filePath = document.fileName;
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  let targetName = baseName + '.ipynb';
  let n = 1;
  while (true) {
    const testPath = path.join(dir, targetName);
    try { await vscode.workspace.fs.stat(vscode.Uri.file(testPath)); n++; targetName = baseName + ' (' + n + ').ipynb'; }
    catch { break; }
  }
  const tf = vscode.Uri.file(path.join(dir, targetName));
  await vscode.workspace.fs.writeFile(tf, enc.encode(nb)); await vscode.commands.executeCommand('vscode.open', tf);
  registerFilePair(srcPath, tf.fsPath); if (codelensProvider && storedExps.length > 0) codelensProvider.copyExplanations(srcPath, tf.fsPath);
  const c = await vscode.window.showInformationMessage(t('已打开！另存为？', 'Opened! Save as?'), t('另存为...', 'Save As...'), t('暂时保留', 'Keep'));
  if (c === t('另存为...', 'Save As...')) {
    const p = document.fileName.replace(/\.[^.]+$/, '') + '.ipynb'; const u = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(p), filters: { 'Jupyter Notebook': ['ipynb'] } });
    if (u) { await vscode.workspace.fs.writeFile(u, enc.encode(nb)); await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); await vscode.commands.executeCommand('vscode.open', u); registerFilePair(srcPath, u.fsPath); if (codelensProvider && storedExps.length > 0) codelensProvider.copyExplanations(tf.fsPath, u.fsPath); }
  }
}
