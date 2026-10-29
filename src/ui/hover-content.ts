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

/**
 * Convert common LaTeX math ($...$ / $$...$$) to Unicode so it renders inside
 * hover widgets — VS Code hovers only support MarkdownString, which has no
 * LaTeX renderer. This covers the math that shows up in code explanations
 * (x², √(n), α+β, O(n log n), ∑, …); anything it can't map degrades to plain
 * text rather than garbage.
 *
 * ponytail: naive heuristics — single-level braces only, no matrices/align;
 * upgrade to MathJax SVG pre-rendering (extension host side) if full LaTeX
 * is needed.
 */
export function latexToUnicode(text: string): string {
  // Protect code blocks / inline code: math delimiters inside code
  // (e.g. `$PATH` in a shell sample) must never be converted.
  const stash: string[] = [];
  const noFences = text.replace(/```[\s\S]*?```/g, (m) => `\u0000${stash.push(m) - 1}\u0000`);
  // RST math roles (:math:`...`) from Sphinx/numpy docstrings — convert the
  // content and drop the wrapper. Must run before the inline-code stash,
  // which would otherwise hide the span from every pass below.
  const mathRoles = noFences.replace(/:math:`([^`\n]+)`/g, (_, m: string) => latexBlock(m));
  // Backtick spans are normally protected as inline code, but spans restored
  // from translation placeholders can be RST math (`\text{out}_i`) with the
  // `:math:` label translated away — convert those instead of protecting.
  const protectedText = mathRoles.replace(/`[^`\n]+`/g, (m) => {
    const inner = m.slice(1, -1);
    if (inner.includes('\\') && BARE_CMD_RE.test(inner)) return latexBlock(inner);
    return `\u0000${stash.push(m) - 1}\u0000`;
  });
  const converted = protectedText
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => latexBlock(m))
    // Inline math: no space right after $ and no space right before the
    // closing $ — this rejects prose like "cost $5 and $10" (currency).
    .replace(/\$([^$\s](?:[^$\n]*[^$\s])?)\$/g, (_, m: string) => latexBlock(m))
    .replace(/\\\(([^)\n]*)\\\)/g, (_, m: string) => latexBlock(m));
  // Bare LaTeX (no delimiters): models often emit \text{...}, \mathcal{...}
  // etc. raw. Convert only whitespace-delimited tokens that contain a KNOWN
  // LaTeX command — this leaves Windows paths (C:\Users\foo) and unknown
  // escapes alone.
  const bareConverted = converted
    .split(/(\s+)/)
    .map((tok) => (tok.includes('\\') && BARE_CMD_RE.test(tok) ? latexBlock(tok) : tok))
    .join('');
  return bareConverted.replace(/\u0000(\d+)\u0000/g, (_, i: string) => stash[Number(i)]);
}

/** LaTeX commands → Unicode, longest first so `\notin` wins over `\in`. */
const SYMBOLS: Array<[string, string]> = [
  ['\\varepsilon', 'ε'], ['\\leftrightarrow', '↔'], ['\\Rightarrow', '⇒'], ['\\Leftarrow', '⇐'],
  ['\\rightarrow', '→'], ['\\leftarrow', '←'], ['\\uparrow', '↑'], ['\\downarrow', '↓'],
  ['\\approx', '≈'], ['\\infty', '∞'], ['\\cdots', '⋯'], ['\\ldots', '…'], ['\\dots', '…'],
  ['\\notin', '∉'], ['\\times', '×'], ['\\cdots', '⋯'], ['\\alpha', 'α'], ['\\beta', 'β'],
  ['\\gamma', 'γ'], ['\\delta', 'δ'], ['\\Delta', 'Δ'], ['\\theta', 'θ'], ['\\Theta', 'Θ'],
  ['\\lambda', 'λ'], ['\\Lambda', 'Λ'], ['\\sigma', 'σ'], ['\\Sigma', 'Σ'], ['\\varphi', 'φ'],
  ['\\omega', 'ω'], ['\\Omega', 'Ω'], ['\\partial', '∂'], ['\\nabla', '∇'], ['\\emptyset', '∅'],
  ['\\forall', '∀'], ['\\exists', '∃'], ['\\propto', '∝'], ['\\equiv', '≡'], ['\\simeq', '≃'],
  ['\\cong', '≅'], ['\\bigcup', '⋃'], ['\\bigcap', '⋂'], ['\\otimes', '⊗'], ['\\oplus', '⊕'],
  ['\\lfloor', '⌊'], ['\\rfloor', '⌋'], ['\\lceil', '⌈'], ['\\rceil', '⌉'], ['\\langle', '⟨'],
  ['\\rangle', '⟩'], ['\\setminus', '∖'], ['\\therefore', '∴'], ['\\because', '∵'],
  ['\\geq', '≥'], ['\\leq', '≤'], ['\\neq', '≠'], ['\\phi', 'φ'], ['\\Phi', 'Φ'],
  ['\\psi', 'ψ'], ['\\Psi', 'Ψ'], ['\\tau', 'τ'], ['\\rho', 'ρ'], ['\\eta', 'η'],
  ['\\xi', 'ξ'], ['\\Xi', 'Ξ'], ['\\zeta', 'ζ'], ['\\kappa', 'κ'], ['\\chi', 'χ'],
  ['\\mu', 'μ'], ['\\pi', 'π'], ['\\Pi', 'Π'], ['\\sum', '∑'], ['\\prod', '∏'],
  ['\\int', '∫'], ['\\cup', '∪'], ['\\cap', '∩'], ['\\pm', '±'], ['\\mp', '∓'],
  ['\\div', '÷'], ['\\cdot', '·'], ['\\land', '∧'], ['\\lor', '∨'], ['\\neg', '¬'],
  ['\\sim', '∼'], ['\\top', '⊤'], ['\\bot', '⊥'], ['\\in', '∈'], ['\\le', '≤'],
  ['\\ge', '≥'], ['\\ne', '≠'], ['\\to', '→'], ['\\mid', '|'], ['\\vert', '|'],
  ['\\Vert', '‖'], ['\\|', '‖'], ['\\%', '%'], ['\\#', '#'], ['\\_', '_'],
];
SYMBOLS.sort((a, b) => b[0].length - a[0].length);

/** Known command names (no backslash) for the bare-LaTeX token test. */
const BARE_CMD_RE = new RegExp(
  '\\\\(' +
    [
      ...new Set([
        ...SYMBOLS.map(([c]) => c.slice(1)),
        'dfrac', 'frac', 'sqrt', 'left', 'right', 'quad', 'qquad',
        'mathrm', 'mathcal', 'mathbb', 'mathbf', 'mathit', 'mathsf', 'operatorname', 'text', 'textrm', 'textbf', 'emph',
        'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'min', 'max', 'lim', 'mod',
      ]),
    ]
      .filter((c) => /^[a-zA-Z]+$/.test(c))
      .join('|') +
    ')(?![a-zA-Z])'
);

const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'k': 'ᵏ', 'T': 'ᵀ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'n': 'ₙ',
  'x': 'ₓ', 'a': 'ₐ', 'e': 'ₑ', 'o': 'ₒ', 't': 'ₜ',
};

function toSuper(e: string): string {
  const mapped = [...e].map((c) => SUPER[c]);
  return mapped.every((c) => c !== undefined) ? mapped.join('') : '^' + e;
}

function toSub(e: string): string {
  const mapped = [...e].map((c) => SUB[c]);
  return mapped.every((c) => c !== undefined) ? mapped.join('') : '_' + e;
}

function latexBlock(m: string): string {
  let s = m;
  // Wrapping commands: keep inner content.
  s = s.replace(/\\(?:mathrm|mathcal|mathbb|mathbf|mathit|mathsf|operatorname|text|textrm|textbf|emph)\{([^{}]*)\}/g, '$1');
  // Function names: strip the backslash (\log → log).
  s = s.replace(/\\(log|ln|exp|sin|cos|tan|min|max|lim|mod)\b/g, '$1');
  s = s.replace(/\\dfrac/g, '\\frac');
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  // Superscripts / subscripts → Unicode (all chars mappable, else keep raw).
  s = s.replace(/\^\{([^}]*)\}/g, (_, e: string) => toSuper(e));
  s = s.replace(/\^(\S)/g, (_, e: string) => toSuper(e));
  s = s.replace(/_\{([^}]*)\}/g, (_, e: string) => toSub(e));
  s = s.replace(/_(\S)/g, (_, e: string) => toSub(e));
  for (const [cmd, uni] of SYMBOLS) s = s.split(cmd).join(uni);
  s = s.replace(/\\(left|right)/g, '');
  s = s.replace(/\\(qquad|quad)/g, ' '); // spacing commands
  s = s.replace(/\\[;,]/g, '');
  s = s.replace(/\\([a-zA-Z]+)/g, '$1'); // unknown commands: drop the backslash
  s = s.replace(/[{}]/g, ''); // remaining braces are pure grouping
  return s;
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
  md.appendMarkdown(latexToUnicode(sanitizeAiContent(info.explanation)) + '\n');

  const fileUri = document.uri;
  for (const qa of info.qas) {
    md.appendMarkdown('\n\n---\n');
    md.appendMarkdown(`**💬 Q:** ${latexToUnicode(sanitizeAiContent(qa.question))}\n\n`);
    md.appendMarkdown(`**🤖 A:** ${latexToUnicode(sanitizeAiContent(qa.answer))}\n\n`);
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
