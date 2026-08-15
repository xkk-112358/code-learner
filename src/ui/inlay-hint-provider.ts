/**
 * Inlay-hint carrier for 💡 AI explanations (default).
 *
 * Why this exists: hovering the old line-end 💡 decoration made the editor
 * merge the AI hover with the language server's hover (Pylance returns content
 * even at the end of a line / token boundary, and VS Code merges all hover
 * providers at the same position into one popup — extensions cannot prevent
 * that). An inlay hint sidesteps the hover system entirely: the hint's own
 * `tooltip` is shown by VS Code's inlay-hint hover handling in a separate
 * HoverWidget, which does NOT merge with hover-provider content. So hovering
 * the 💡 shows ONLY the AI explanation, and hovering the code shows only the
 * language server's hover.
 */

import * as vscode from 'vscode';
import { CodeLearnerCodeLensProvider } from './codelens-provider';
import { buildExplanationMarkdown } from './hover-content';

export function registerInlayHintsProvider(codelens: CodeLearnerCodeLensProvider): vscode.Disposable {
  // The editor re-requests hints when this fires. Explanations and hints both
  // derive from the same store, so every CodeLens change (add / delete /
  // re-explain / Q&A) must invalidate the hints too.
  const onDidChange = new vscode.EventEmitter<void>();
  codelens.onDidChangeCodeLenses(() => onDidChange.fire());

  const provider: vscode.InlayHintsProvider = {
    onDidChangeInlayHints: onDidChange.event,

    provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
      // Notebook cell documents use the vscode-notebook-cell scheme — their
      // storageKey maps back to the .ipynb path where explanations live, so
      // the 💡 survives the code → notebook conversion.
      if (document.uri.scheme !== 'file' && document.uri.scheme !== 'vscode-notebook-cell') return [];
      if (!codelens.isInlayHintCarrier()) return []; // decoration carrier renders the 💡
      const hints: vscode.InlayHint[] = [];
      const start = range.start.line;
      const end = Math.min(range.end.line, document.lineCount - 1);
      for (let line = start; line <= end; line++) {
        const lineText = document.lineAt(line).text;
        const info = codelens.getExplanation(document.uri, line, lineText);
        if (!info) continue;
        // Same anchor math as the decoration carrier: 💡 sits right after the
        // anchor text (typically the end of the explained selection).
        const anchorIdx = lineText.indexOf(info.anchorText);
        if (anchorIdx < 0) continue; // code changed; sync handles removal
        const pos = new vscode.Position(line, anchorIdx + info.anchorText.length);
        const hint = new vscode.InlayHint(pos, '💡');
        hint.tooltip = buildExplanationMarkdown(document, line, info);
        hints.push(hint);
      }
      return hints;
    },
  };

  return vscode.languages.registerInlayHintsProvider({ pattern: '**' }, provider);
}
