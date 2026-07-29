/**
 * Central command registration — replaces inline registrations in extension.ts.
 */

import * as vscode from 'vscode';
import { withLock, getCodeLearnerSettings } from '../state';
import { openAsNotebook } from './notebook-commands';
import { explainSelectedCode, explainNotebookCell, askQuestion } from './explain-commands';
import { reExplain, deleteExplanation, copyQA, deleteQA, toComment, deleteAtCursor,copyExplanation } from './manage-commands';
import { convertAllToComments } from './comment-commands';
import { CodeLearnerCodeLensProvider } from '../ui/codelens-provider';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  codelensProvider: CodeLearnerCodeLensProvider
): void {
  // ── Primary commands ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.openAsNotebook',
      () => withLock('Open as Notebook', () => openAsNotebook(context))
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.configure',
      () => { getCodeLearnerSettings()?.runSetupWizard(); }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.explainCell',
      (cell?: vscode.NotebookCell) => withLock('Explain cell', () => explainNotebookCell(context, cell, 'panel'))
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.explainCellBelow',
      (cell?: vscode.NotebookCell) => withLock('Explain below', () => explainNotebookCell(context, cell, 'inline'))
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.explainSelected',
      () => withLock('Explain selected', () => explainSelectedCode())
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.convertAllToComments',
      () => withLock('Convert all', () => convertAllToComments())
    )
  );

  // ── Inline action commands ────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.reExplain',
      (uri: vscode.Uri, line: number, col: number) => reExplain(uri, line, col)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.deleteExplanation',
      (uri: vscode.Uri, line: number) => deleteExplanation(uri, line)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.deleteAtCursor',
      () => deleteAtCursor()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.copyQA',
      (q: string, a: string) => copyQA(q, a)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.deleteQA',
      (uri: vscode.Uri, line: number, id: string) => deleteQA(uri, line, id)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.askQuestion',
      (uri: vscode.Uri, line: number, col: number) => askQuestion(uri, line, col)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.toComment',
      (uri: vscode.Uri, line: number) => toComment(uri, line)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-learner.copyExplanation',
      (uri: vscode.Uri, line: number) => copyExplanation(uri, line)
    )
  );

  // ── Event handlers ────────────────────────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(ed => {
      if (ed && codelensProvider) codelensProvider.applyAllDecorations(ed);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.scheme !== 'file' && e.document.uri.scheme !== 'vscode-notebook-cell') return;
      // Sync explanations: auto-hide if code deleted, restore if undone
      codelensProvider?.syncExplanationsWithDocument(e.document);
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.toString() === e.document.uri.toString()) {
          codelensProvider?.applyAllDecorations(ed);
          break;
        }
      }
    })
  );

  // Handle file renames: update stored explanations with new path
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (e) => {
      if (!codelensProvider) return;
      for (const file of e.files) {
        const oldPath = file.oldUri.fsPath;
        const newPath = file.newUri.fsPath;
        const exps = codelensProvider.getExplanationsWithPositions(oldPath);
        if (exps.length > 0) {
          for (const exp of exps) {
            const snippet = exp.snippet || '';
            await codelensProvider.addExplanation(newPath, new vscode.Range(0, 0, 0, 0), exp.explanation, '', snippet);
          }
          await codelensProvider.removeExplanation(oldPath, 0);
        }
      }
    })
  );

  // ── Status bar ────────────────────────────────────────
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sb.text = 'Open as Jupyter Notebook';
  sb.command = 'code-learner.openAsNotebook';
  context.subscriptions.push(sb);

  const updateSb = () => {
    const e = vscode.window.activeTextEditor;
    if (e && e.document.uri.scheme === 'file' && e.document.languageId !== 'ipynb') sb.show();
    else sb.hide();
  };
  updateSb();
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateSb()));
}
