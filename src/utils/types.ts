/**
 * Shared type definitions used across the extension.
 */

import * as vscode from 'vscode';

/** Context object VS Code passes for notebook cell title commands.
 *  The first argument is the NotebookCell itself. */
export type NotebookCellCommandArg = vscode.NotebookCell | undefined;

/** Partial document shape needed for explanation calls. */
export interface DocumentInfo {
  getText(): string;
  languageId: string;
  lineCount?: number;
}

/** Safely cast an unknown thrown value to Error. */
export function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
