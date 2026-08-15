/**
 * Shared hover content builders, used by BOTH hover carriers:
 *  - the classic carrier: 💡 line-end decoration + HoverProvider (hover-provider.ts)
 *  - the inlay-hint carrier: 💡 InlayHint whose tooltip holds the explanation
 *    (inlay-hint-provider.ts) — this is the default, because the hint's own
 *    tooltip is rendered by VS Code's inlay-hint hover system, which does NOT
 *    merge with hover-provider content (unlike decoration/hover-provider
 *    hovers, which the editor merges with e.g. Pylance's hover).
 */

import * as vscode from 'vscode';
import { ExplanationTiming, QAPair } from './codelens-provider';
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

/** The parts of an explanation the hover/inlay-hint content needs. */
export interface ExplanationContent {
  explanation: string;
  timing?: ExplanationTiming;
  qas: QAPair[];
}

/**
 * Build the trusted markdown for one 💡 explanation: header with timing, the
 * sanitized AI text, any Q&A pairs, and the action buttons. Used by both the
 * hover provider (decoration carrier) and the inlay hint tooltip.
 */
export function buildExplanationMarkdown(
  document: vscode.TextDocument,
  line: number,
  info: ExplanationContent,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
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
    const delCmd = `command:code-learner.deleteQA?${encodeURIComponent(JSON.stringify([fileUri, line, qa.id]))}`;
    md.appendMarkdown(`[${t('复制', 'Copy')}](${copyCmd})  [🗑 ${t('删除', 'Delete')}](${delCmd})`);
  }

  md.appendMarkdown('\n\n---\n');
  const reCmd = `command:code-learner.reExplain?${encodeURIComponent(JSON.stringify([fileUri, line, 0]))}`;
  const delCmd = `command:code-learner.deleteExplanation?${encodeURIComponent(JSON.stringify([fileUri, line]))}`;
  const askCmd = `command:code-learner.askQuestion?${encodeURIComponent(JSON.stringify([fileUri, line, 0]))}`;
  const copyCmdExp = `command:code-learner.copyExplanation?${encodeURIComponent(JSON.stringify([fileUri, line]))}`;
  const cmtCmd = `command:code-learner.toComment?${encodeURIComponent(JSON.stringify([fileUri, line]))}`;
  md.appendMarkdown(
    `[📋 ${t('复制', 'Copy')}](${copyCmdExp})  [🔄 ${t('重新解释', 'Re-explain')}](${reCmd})  ` +
    `[🗑 ${t('删除', 'Delete')}](${delCmd})  ` +
    `[💬 ${t('提问', 'Ask')}](${askCmd})  ` +
    `[💭 ${t('转为注释', 'To Comment')}](${cmtCmd})`
  );

  return md;
}
