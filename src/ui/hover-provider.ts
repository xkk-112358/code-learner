/**
 * Hover provider - only shows when hovering directly on the 💡 character.
 * Handles both regular files and notebook cells via getStorageKey.
 */

import * as vscode from 'vscode';
import { CodeLearnerCodeLensProvider } from './codelens-provider';
import { t } from '../utils/helpers';

/**
 * The hover markdown is trusted (so our own command buttons work), which means
 * AI/user content must be sanitized: a `command:` URI inside a markdown link
 * would otherwise execute arbitrary extension commands, and `file:`/`vscode:`
 * links could open arbitrary local files. Escaping the colon breaks the URI
 * scheme while rendering as a plain colon. Plain http(s) links are kept — they
 * only open the browser.
 */
function sanitizeAiContent(text: string): string {
  return text.replace(/(command|file|vscode|vscode-insiders|javascript|data|vbscript):/gi, '$1\\:');
}

export class AIHoverProvider implements vscode.HoverProvider {
  private codelens: CodeLearnerCodeLensProvider;

  constructor(codelens: CodeLearnerCodeLensProvider) {
    this.codelens = codelens;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const lineText = document.lineAt(position.line).text;
    const info = this.codelens.getExplanation(document.uri, position.line, lineText);
    if (!info) return null;

    // Only show hover when the cursor is ON the 💡 character. The anchor can
    // be a long code fragment, so allow a small tolerance on the left, but
    // never show it for positions to the right of the 💡 — otherwise hovering
    // `plt.plot(x, y💡, 'bo', ...)` over `'bo'` would wrongly trigger.
    const anchorIdx = lineText.indexOf(info.anchorText);
    if (anchorIdx < 0) return null;
    const decoPos = anchorIdx + info.anchorText.length;
    if (position.character < decoPos - 2 || position.character > decoPos + 1) return null;

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

    return new vscode.Hover(md);
  }
}
