/**
 * Command for opening a code file as a Jupyter notebook.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getAIServiceManager, getCodeLearnerSettings, getCodeLensProvider } from '../state';
import { checkFileSize } from '../utils/fs-utils';
import { formatTime, t } from '../utils/helpers';
import { showError } from '../utils/error-utils';
import { generateNotebook, NOTEBOOK_SOURCE_CHAR_LIMIT } from '../ai/nb-generator';
import { registerFilePair, unregisterFilePair } from '../ui/codelens-provider';

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

  // Warn before converting files too large for the AI: code beyond the
  // character limit would be silently dropped from the notebook.
  const sourceLength = document.getText().length;
  if (sourceLength > NOTEBOOK_SOURCE_CHAR_LIMIT) {
    const sizeKB = (sourceLength / 1024).toFixed(1);
    const c = await vscode.window.showWarningMessage(
      t(
        `文件较大（${sizeKB}KB）。转换只包含前 ${NOTEBOOK_SOURCE_CHAR_LIMIT} 个字符，之后的代码将丢失。继续？`,
        `Large file (${sizeKB}KB). Only the first ${NOTEBOOK_SOURCE_CHAR_LIMIT} chars will be converted; code after that will be lost. Continue?`
      ),
      t('继续', 'Continue'),
      t('取消', 'Cancel')
    );
    if (c !== t('继续', 'Continue')) return;
  }

  const storedExps: { snippet: string; explanation: string }[] = codelensProvider?.getAllExplanations(srcPath) || [];
  let result: Awaited<ReturnType<typeof generateNotebook>>;
  const convertStart = Date.now();
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('转换中...', 'Converting...'), cancellable: false }, async (p) => {
      p.report({ message: t('AI 分析中...', 'Analyzing...') });
      result = await generateNotebook(document, codeLearnerSettings, storedExps, aiServiceManager.notebookSignal());
      p.report({ message: t('完成 (' + formatTime(Date.now() - convertStart) + ')', 'Done (' + formatTime(Date.now() - convertStart) + ')') });
    });
  } catch (e: unknown) {
    // showError masks API keys that may appear in gateway error messages.
    showError(t('转换失败', 'Failed'), e);
    return;
  }
  const enc = new TextEncoder();
  const nb = result!.content;
  if (result!.usedFallback) {
    vscode.window.showWarningMessage(
      t('AI 响应无效，已按空行分割生成 notebook（单元格划分可能不准确）', 'AI response was invalid; fell back to blank-line splitting (cell boundaries may be inaccurate)')
    );
  }
  // Save notebook in the same directory as source file
  const filePath = document.fileName;
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  // Strip an existing " (n)" suffix so "file (1).py" produces
  // "file (2).ipynb" instead of "file (1) (2).ipynb".
  const stem = baseName.replace(/\s+\(\d+\)$/, '');
  let targetName = stem + '.ipynb';
  let n = 1;
  for (let found = true; found; ) {
    const testPath = path.join(dir, targetName);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(testPath));
      // First collision appends (1), then (2), (3), ... — the suffix must be
      // set BEFORE n increments so "foo (2).ipynb" is not skipped.
      targetName = stem + ' (' + n + ').ipynb';
      n++;
    }
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
    // Default to the file actually shown (the generated temp name), so
    // "Save As" doesn't silently offer to overwrite an existing stem.ipynb.
    const u = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(tf.fsPath),
      filters: { 'Jupyter Notebook': ['ipynb'] }
    });
    if (u) {
      await vscode.workspace.fs.writeFile(u, enc.encode(nb));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.commands.executeCommand('vscode.open', u);
      // Drop the pairing with the temp file — keeping it would duplicate
      // explanations into both .ipynb paths.
      unregisterFilePair(srcPath, tf.fsPath);
      registerFilePair(srcPath, u.fsPath);
      if (codelensProvider && storedExps.length > 0) await codelensProvider.copyExplanations(tf.fsPath, u.fsPath);
      // Remove the temp file — unless the user saved onto it.
      if (u.fsPath !== tf.fsPath) {
        try { await vscode.workspace.fs.delete(tf); } catch { /* already gone */ }
      }
    }
  }
}
