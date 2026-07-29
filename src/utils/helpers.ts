/**
 * General-purpose helpers.
 */

import * as vscode from 'vscode';

export function formatTime(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

export function t(zh: string, en: string): string {
  return vscode.env.language.startsWith('zh') ? zh : en;
}

/**
 * Convert a URI to a platform-normalized file path string.
 * This is the canonical version — replaces both the old `storageKey`
 * in extension.ts and `getStorageKey` in codelens-provider.ts.
 */
export function storageKey(uri: vscode.Uri): string {
  if (uri.scheme === 'file') return uri.fsPath;
  const p = decodeURIComponent(uri.path).replace(/^\/([a-zA-Z]:\/)/, '$1');
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
}
