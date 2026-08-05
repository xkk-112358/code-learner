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
      // The anchor can be a long code fragment, so allow a small tolerance on
      // the left, but never show it for positions to the right of the 💡 —
      // otherwise hovering `plt.plot(x, y💡, 'bo', ...)` over `'bo'` would
      // wrongly trigger.
      const anchorIdx = lineText.indexOf(info.anchorText);
      if (anchorIdx >= 0) {
        const decoPos = anchorIdx + info.anchorText.length;
        if (position.character >= decoPos - 2 && position.character <= decoPos + 1) {
          md = new vscode.MarkdownString('', true);
          md.isTrusted = true;

          md.appendMarkdown(`--- 💡 ${t('AI 解析', 'AI Analysis')} ---`);
          if (info.timing) {
            const sec = (info.timing.elapsed / 1000).toFixed(1);
            const tokens = Math.round(info.timing.chars / 4);
            md.appendMarkdown(`(⏱ ${sec}s ·${tokens} tokens)`);
          }
          md.appendMarkdown('\n\n');
          md.appendMarkdown(sanitizeAiContent(info.explanation) + '\n');

          const fileUri = document.uri;
          for (const qa of info.qas) {
            md.appendMarkdown('\n\n---\n');
            md.appendMarkdown(`**💬 Q:** ${sanitizeAiContent(qa.question)}\n\n`);
            md.appendMarkdown(`**🤖 A:** ${sanitizeAiContent(qa.answer)}\n\n`);
            const copyCmd = `command:code-learner.copyQA?${encodeURIComponent(JSON.stringify([qa.question, qa.answer]))}`;
            const delCmd = `command:code-learner.deleteQA?${encodeURIComponent(JSON.stringify([fileUri, position.line, qa.id]))}`;
            md.appendMarkdown(`[${t('复制', 'Copy')}](${copyCmd})  [🗑 ${t('删除', 'Delete')}](${delCmd})`);
          }

          md.appendMarkdown('\n\n---\n');
          const reCmd = `command:code-learner.reExplain?${encodeURIComponent(JSON.stringify([fileUri, position.line, 0]))}`;
          const delCmd = `command:code-learner.deleteExplanation?${encodeURIComponent(JSON.stringify([fileUri, position.line]))}`;
          const askCmd = `command:code-learner.askQuestion?${encodeURIComponent(JSON.stringify([fileUri, position.line, 0]))}`;
          const copyCmdExp = `command:code-learner.copyExplanation?${encodeURIComponent(JSON.stringify([fileUri, position.line]))}`;
          const cmtCmd = `command:code-learner.toComment?${encodeURIComponent(JSON.stringify([fileUri, position.line]))}`;
          md.appendMarkdown(
            `[📋 ${t('复制', 'Copy')}](${copyCmdExp})  [🔄 ${t('重新解释', 'Re-explain')}](${reCmd})  ` +
            `[🗑 ${t('删除', 'Delete')}](${delCmd})  ` +
            `[💬 ${t('提问', 'Ask')}](${askCmd})  ` +
            `[💭 ${t('转为注释', 'To Comment')}](${cmtCmd})`
          );
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
