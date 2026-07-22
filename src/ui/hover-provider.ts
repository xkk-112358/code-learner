/**
 * Hover provider - only shows when hovering directly on the 💡 character.
 * Handles both regular files and notebook cells via getStorageKey.
 */

import * as vscode from 'vscode';
import { CodeLearnerCodeLensProvider } from './codelens-provider';

export class AIHoverProvider implements vscode.HoverProvider {
  private codelens: CodeLearnerCodeLensProvider;

  constructor(codelens: CodeLearnerCodeLensProvider) {
    this.codelens = codelens;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const lineText = document.lineAt(position.line).text;
    const info = this.codelens.getExplanation(document.uri, position.line, lineText);
    if (!info) return null;

    // Only show hover when cursor is ON the 💡 character
    const anchorIdx = lineText.indexOf(info.anchorText);
    if (anchorIdx < 0) return null;
    const decoPos = anchorIdx + info.anchorText.length;
    if (position.character < decoPos) return null;

    const isZh = vscode.env.language.startsWith('zh');
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    md.appendMarkdown(`--- 💡 ${isZh ? 'AI 解析' : 'AI Analysis'} ---\n\n`);
    md.appendMarkdown(info.explanation + '\n');

    const fileUri = document.uri;
    for (const qa of info.qas) {
      md.appendMarkdown('\n\n---\n');
      md.appendMarkdown(`**💬 ${isZh ? 'Q' : 'Q'}:** ${qa.question}\n\n`);
      md.appendMarkdown(`**🤖 ${isZh ? 'A' : 'A'}:** ${qa.answer}\n\n`);
      const copyCmd = `command:code-learner.copyQA?${encodeURIComponent(JSON.stringify([qa.question, qa.answer]))}`;
      const delCmd = `command:code-learner.deleteQA?${encodeURIComponent(JSON.stringify([fileUri, position.line, qa.id]))}`;
      md.appendMarkdown(`[${isZh ? '复制' : 'Copy'}](${copyCmd})　[🗑 ${isZh ? '删除' : 'Delete'}](${delCmd})`);
    }

    md.appendMarkdown('\n\n---\n');
    const reCmd = `command:code-learner.reExplain?${encodeURIComponent(JSON.stringify([fileUri, position.line, 0]))}`;
    const delCmd = `command:code-learner.deleteExplanation?${encodeURIComponent(JSON.stringify([fileUri, position.line]))}`;
    const askCmd = `command:code-learner.askQuestion?${encodeURIComponent(JSON.stringify([fileUri, position.line, 0]))}`;
    const cmtCmd = `command:code-learner.toComment?${encodeURIComponent(JSON.stringify([fileUri, position.line]))}`;
    md.appendMarkdown(
      `[🔄 ${isZh ? '重新解释' : 'Re-explain'}](${reCmd})　` +
      `[🗑 ${isZh ? '删除全部' : 'Delete All'}](${delCmd})　` +
      `[💬 ${isZh ? '提问' : 'Ask'}](${askCmd})　` +
      `[💭 ${isZh ? '转为注释' : 'To Comment'}](${cmtCmd})`
    );

    return new vscode.Hover(md);
  }
}
