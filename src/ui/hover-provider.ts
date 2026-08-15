/**
 * Hover provider - shows the 💡 AI explanation (when hovering on the 💡
 * character) plus, in Chinese locales, a translation block for the built-in
 * hover documentation of the hovered symbol.
 */

import * as vscode from 'vscode';
import { CodeLearnerCodeLensProvider } from './codelens-provider';
import { HoverTranslationStore } from '../utils/hover-translation-store';
import {
  extractPlaceholders,
  isTranslatable,
  makeTranslationKey,
  resolveTranslationTarget,
  restorePlaceholders,
} from '../ai/hover-translator';
import { buildExplanationMarkdown } from './hover-content';
import { t } from '../utils/helpers';

/**
 * The hover markdown is trusted (so our own command buttons work), which means
 * AI/user content must be sanitized: a `command:` URI inside a markdown link
 * would otherwise execute arbitrary extension commands, and `file:`/`vscode:`
 * links could open arbitrary local files. Escaping the colon breaks the URI
 * scheme while rendering as a plain colon. Plain http(s) links are kept — they
 * only open the browser.
 */
export function sanitizeAiContent(text: string): string {
  // Word boundary is required: `data:` alone is a scheme, but the `data:` in
  // `validation_data:` is not — escaping that corrupts code like
  // `validation_data\: Any | None`.
  return text.replace(/\b(command|file|vscode|vscode-insiders|javascript|data|vbscript)\s*:/gi, '$1\\:');
}

/**
 * Reentrancy guard for fetchBuiltinHoverText: `vscode.executeHoverProvider`
 * re-invokes THIS provider (pattern `**`), and the nested invocation must
 * return nothing — otherwise our own content would be mixed into the
 * "builtin" text we want to translate.
 */
let resolvingHover = false;

/**
 * Get the merged hover content contributed by ALL OTHER providers at a
 * position (the built-in documentation, e.g. Pylance's docstrings).
 * Returns undefined when there is nothing, when re-entered, or on error.
 */
export async function fetchBuiltinHoverText(uri: vscode.Uri, position: vscode.Position): Promise<string | undefined> {
  if (resolvingHover) return undefined;
  resolvingHover = true;
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
    const parts: string[] = [];
    for (const h of hovers || []) {
      for (const c of h.contents) {
        const v = typeof c === 'string' ? c : c.value;
        if (v) parts.push(v);
      }
    }
    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
  } catch {
    return undefined;
  } finally {
    resolvingHover = false;
  }
}

export class AIHoverProvider implements vscode.HoverProvider {
  private codelens: CodeLearnerCodeLensProvider;
  private store: HoverTranslationStore | undefined;

  constructor(codelens: CodeLearnerCodeLensProvider, store?: HoverTranslationStore) {
    this.codelens = codelens;
    this.store = store;
  }

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    // Guard must be the FIRST statement — a nested executeHoverProvider call
    // must never return any of our content (see fetchBuiltinHoverText).
    if (resolvingHover) return null;

    // ── Block A: 💡 AI explanation (only when hovering on the 💡) ──
    const lineText = document.lineAt(position.line).text;
    const info = this.codelens.getExplanation(document.uri, position.line, lineText);
    let md: vscode.MarkdownString | null = null;
    if (info) {
      // Only respond to the 💡 decoration character itself (decoPos = end of
      // line). The old window tolerated 2 characters to the left, which meant
      // the mouse resting on trailing code characters (e.g. `)` or an
      // identifier) also triggered the AI explanation — at those positions the
      // native language service (Pylance/TS) returns its own content too, and
      // VS Code merges both into one hover popup. The line-end position is
      // outside every symbol's token range, so native providers return
      // nothing there and the popup shows only the AI explanation.
      const anchorIdx = lineText.indexOf(info.anchorText);
      if (anchorIdx >= 0) {
        const decoPos = anchorIdx + info.anchorText.length;
        if (position.character >= decoPos && position.character <= decoPos + 1) {
          md = buildExplanationMarkdown(document, position.line, info);
        }
      }
    }

    // ── Block B: hover documentation translation (follows the UI language) ──
    let translationBlock: string | null = null;
    const target = resolveTranslationTarget(vscode.env.language);
    if (target && this.store) {
      const builtin = await fetchBuiltinHoverText(document.uri, position);
      if (builtin) {
        const { text, map } = extractPlaceholders(builtin);
        if (isTranslatable(text, target)) {
          const hash = makeTranslationKey(target.code, text);
          if (this.store.isShown(hash)) {
            const entry = this.store.get(hash);
            if (entry) {
              // Sanitize FIRST, then restore: the AI translation contains only
              // prose + placeholders, so sanitizing it neutralizes any
              // `[x](command:...)` the model echoed (CVE-2026-50178 pattern).
              // Restored code blocks/inline code render verbatim (never as
              // links) and must NOT be sanitized — escaping a colon inside
              // code would show as a literal `\:` (e.g. validation_data\:).
              const zh = restorePlaceholders(sanitizeAiContent(entry.zh), map);
              const hideCmd = `command:code-learner.showOriginalHover?${encodeURIComponent(JSON.stringify([document.uri, position.line, position.character, hash]))}`;
              const retransCmd = `command:code-learner.translateHover?${encodeURIComponent(JSON.stringify([document.uri, position.line, position.character, hash, true]))}`;
              translationBlock = `\n\n---\n\n${zh}\n\n[🔙 ${target.hide}](${hideCmd})  [🔄 ${target.retranslate}](${retransCmd})`;
            }
          }
          if (!translationBlock) {
            // A translation exists but is hidden (点了"隐藏翻译") — clicking
            // just reveals the cached text, so label it "show". First-time
            // translations keep the "translate" label.
            const cached = this.store.get(hash);
            const label = cached ? target.show : target.translate;
            const cmd = `command:code-learner.translateHover?${encodeURIComponent(JSON.stringify([document.uri, position.line, position.character, hash]))}`;
            translationBlock = `\n\n---\n\n[🌐 ${label}](${cmd})`;
          }
        }
      }
    }

    if (md) {
      if (translationBlock) md.appendMarkdown(translationBlock);
      return new vscode.Hover(md);
    }
    if (translationBlock) {
      const md2 = new vscode.MarkdownString('', true);
      md2.isTrusted = true;
      md2.appendMarkdown(translationBlock.trimStart());
      return new vscode.Hover(md2);
    }
    return null;
  } catch (e: unknown) {
    // A hover provider must never throw — an exception here would drop ALL
    // hover content for the document (including other providers' merged text).
    console.error('[Code Learner] provideHover error:', e instanceof Error ? e.stack || e.message : String(e));
    return null;
  }
}
