/**
 * Error handling helpers.
 */

import * as vscode from 'vscode';
import { asError } from './types';

/**
 * Show an error message, masking API keys for security.
 */
export function showError(context: string, e: unknown): void {
  const err = asError(e);
  let msg = err.message || String(err);
  // Mask API keys
  msg = msg.replace(/sk-([a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, 'sk-$1****');
  msg = msg.replace(/sk-ant-([a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, 'sk-ant-$1****');
  console.error(`[Code Learner] ${context}:`, msg);
  const display = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
  vscode.window.showErrorMessage(display);
}
