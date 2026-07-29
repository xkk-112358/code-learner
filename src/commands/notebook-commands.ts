/**
 * Command for opening a code file as a Jupyter notebook.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getAIServiceManager, getCodeLearnerSettings, getCodeLensProvider } from '../state';
import { checkFileSize } from '../utils/fs-utils';
import { formatTime, t } from '../utils/helpers';
import { generateNotebook } from '../ai/nb-generator';
import { registerFilePair } from '../ui/codelens-provider';

export async function openAsNotebook(context: vscode.ExtensionContext): Promise<void> {
  const aiServiceManager = getAIServiceManager();
  const codeLearnerSettings = getCodeLearnerSettings();
  const codelensProvider = getCodeLensProvider();
  if (!aiServiceManager || !codeLearnerSettings) return;

  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage(t('没有打开的文件', 'No active editor')); return; }
  const document = editor.document; if (document.uri.scheme !== 'file') { vscode.window.showWarningMessage(t('只支持文件', 'Only files')); return; }
  if (!checkFileSize(document)) return;
  const apiKey = await codeLearnerSettings.getApiKey(vscode.workspace.getConfiguration('codeLearner').get<'openai' | 'claude'>('provider', 'openai'));
  if (!apiKey) {
    const c = await vscode.window.showWarningMessage(t('AI 未配置。现在配置？', 'AI not configured?'), 'Yes', 'Cancel');
    if (c === 'Yes') { await codeLearnerSettings.runSetupWizard(); await openAsNotebook(context); }
    return;
  }
  const srcPath = document.uri.fsPath;
  const storedExps: { snippet: string; explanation: string }[] = codelensProvider?.getAllExplanations(srcPath) || [];
  let result: Awaited<ReturnType<typeof generateNotebook>>;
  const convertStart = Date.now();
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('转换中...', 'Converting...'), cancellable: false }, async (p) => {
      p.report({ message: t('AI 分析中...', 'Analyzing...') });
      result = await generateNotebook(document, codeLearnerSettings, storedExps);
      p.report({ message: t('完成 (' + formatTime(Date.now() - convertStart) + ')', 'Done (' + formatTime(Date.now() - convertStart) + ')') });
    });
  } catch (e: unknown) {
    vscode.window.showErrorMessage(t('转换失败', 'Failed') + ': ' + (e instanceof Error ? e.message : String(e)));
    return;
  }
  const enc = new TextEncoder();
  const nb = result!.content;
  // Save notebook in the same directory as source file
  const filePath = document.fileName;
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  let targetName = baseName + '.ipynb';
  let n = 1;
  for (let found = true; found; ) {
    const testPath = path.join(dir, targetName);
    try { await vscode.workspace.fs.stat(vscode.Uri.file(testPath)); n++; targetName = baseName + ' (' + n + ').ipynb'; }
    catch { found = false; }
  }
  const tf = vscode.Uri.file(path.join(dir, targetName));
  await vscode.workspace.fs.writeFile(tf, enc.encode(nb));
  await vscode.commands.executeCommand('vscode.open', tf);
  registerFilePair(srcPath, tf.fsPath);
  if (codelensProvider && storedExps.length > 0) await codelensProvider.copyExplanations(srcPath, tf.fsPath);
  const c = await vscode.window.showInformationMessage(
    t('已打开！另存为？', 'Opened! Save as?'),
    t('另存为...', 'Save As...'),
    t('暂时保留', 'Keep')
  );
  if (c === t('另存为...', 'Save As...')) {
    const p = document.fileName.replace(/\.[^.]+$/, '') + '.ipynb';
    const u = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(p),
      filters: { 'Jupyter Notebook': ['ipynb'] }
    });
    if (u) {
      await vscode.workspace.fs.writeFile(u, enc.encode(nb));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.commands.executeCommand('vscode.open', u);
      registerFilePair(srcPath, u.fsPath);
      if (codelensProvider && storedExps.length > 0) await codelensProvider.copyExplanations(tf.fsPath, u.fsPath);
    }
  }
}
