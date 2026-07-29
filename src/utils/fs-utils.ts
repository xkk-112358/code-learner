/**
 * File system helpers.
 */

import * as vscode from 'vscode';

export const MAX_FILE_LINES = 5000;
export const MAX_FILE_SIZE = 500 * 1024; // 500KB

export function checkFileSize(doc: vscode.TextDocument): boolean {
  const isZh = vscode.env.language.startsWith('zh');

  // Check line count
  if (doc.lineCount > MAX_FILE_LINES) {
    const msg = isZh
      ? `文件过大 (${doc.lineCount} 行)，已跳过处理。Code Learner 支持最大 ${MAX_FILE_LINES} 行`
      : `File too large (${doc.lineCount} lines). Code Learner supports up to ${MAX_FILE_LINES} lines`;
    vscode.window.showWarningMessage(msg);
    return false;
  }

  // Check total text size (approximate)
  const textSize = doc.getText().length;
  if (textSize > MAX_FILE_SIZE) {
    const sizeKB = Math.round(textSize / 1024);
    const maxKB = Math.round(MAX_FILE_SIZE / 1024);
    const msg = isZh
      ? `文件过大 (${sizeKB}KB)，已跳过处理。Code Learner 支持最大 ${maxKB}KB`
      : `File too large (${sizeKB}KB). Code Learner supports up to ${maxKB}KB`;
    vscode.window.showWarningMessage(msg);
    return false;
  }

  return true;
}
