/**
 * Hover documentation translation — pure logic (detection, placeholder
 * protection) plus a non-streaming AI call mirroring nb-generator's pattern.
 *
 * "Don't translate what shouldn't be translated" is enforced deterministically:
 * fenced code blocks, inline code, and URLs are extracted into {C0}/{I0}/{U0}
 * placeholders BEFORE the text reaches the AI, and restored afterwards — the
 * model never sees the code itself.
 */

import { CodeLearnerSettings } from '../config/settings';
import { nodeRequestAndRead } from './streaming';
import { contentHash } from '../utils/hash';

export const MIN_TRANSLATABLE_CHARS = 40;
export const MAX_TRANSLATABLE_CHARS = 20_000;

/** CJK Unified Ideographs + Extension A — presence means "already Chinese". */
const CJK_RE = /[一-鿿㐀-䶿]/;
/** Hiragana + Katakana — presence means "already Japanese". */
const KANA_RE = /[぀-ヿ]/;
/** Hangul syllables — presence means "already Korean". */
const HANGUL_RE = /[가-힯]/;

/** Script-encoded targets (languages whose text can be detected by script). */
interface LangInfo {
  /** English name used in the AI prompt, e.g. 'Simplified Chinese' */
  name: string;
  /** Native button labels; falls back to English labels when absent */
  native?: { translate: string; show: string; hide: string; retranslate: string };
  /** Regex detecting text already written in this language's script */
  script?: RegExp;
}

const LANGS: Record<string, LangInfo> = {
  zh: { name: 'Simplified Chinese', native: { translate: '翻译为中文', show: '显示译文', hide: '隐藏翻译', retranslate: '重新翻译' }, script: CJK_RE },
  ja: { name: 'Japanese', native: { translate: '日本語に翻訳', show: '翻訳を表示', hide: '翻訳を隠す', retranslate: '再翻訳' }, script: KANA_RE },
  ko: { name: 'Korean', native: { translate: '한국어로 번역', show: '번역 표시', hide: '번역 숨기기', retranslate: '다시 번역' }, script: HANGUL_RE },
  fr: { name: 'French', native: { translate: 'Traduire en français', show: 'Afficher la traduction', hide: 'Masquer la traduction', retranslate: 'Retraduire' } },
  de: { name: 'German', native: { translate: 'Auf Deutsch übersetzen', show: 'Übersetzung anzeigen', hide: 'Übersetzung ausblenden', retranslate: 'Erneut übersetzen' } },
  es: { name: 'Spanish', native: { translate: 'Traducir al español', show: 'Mostrar traducción', hide: 'Ocultar traducción', retranslate: 'Volver a traducir' } },
  it: { name: 'Italian', native: { translate: 'Traduci in italiano', show: 'Mostra traduzione', hide: 'Nascondi traduzione', retranslate: 'Ritraduci' } },
  pt: { name: 'Portuguese', native: { translate: 'Traduzir para português', show: 'Mostrar tradução', hide: 'Ocultar tradução', retranslate: 'Retraduzir' } },
  ru: { name: 'Russian', native: { translate: 'Перевести на русский', show: 'Показать перевод', hide: 'Скрыть перевод', retranslate: 'Перевести заново' } },
  uk: { name: 'Ukrainian' },
  nl: { name: 'Dutch' },
  pl: { name: 'Polish' },
  tr: { name: 'Turkish' },
  vi: { name: 'Vietnamese' },
  th: { name: 'Thai' },
  ar: { name: 'Arabic' },
  hi: { name: 'Hindi' },
  id: { name: 'Indonesian' },
  cs: { name: 'Czech' },
  sv: { name: 'Swedish' },
  da: { name: 'Danish' },
  fi: { name: 'Finnish' },
  el: { name: 'Greek' },
  hu: { name: 'Hungarian' },
  ro: { name: 'Romanian' },
};

export interface TranslationTarget {
  /** Language code used in cache keys, e.g. 'zh', 'ja' */
  code: string;
  /** English name for the AI prompt, e.g. 'Simplified Chinese' */
  name: string;
  translate: string;
  show: string;
  hide: string;
  retranslate: string;
  /** True when the text already contains this language's script */
  isTargetScript(text: string): boolean;
}

/**
 * Resolve the translation target from the VS Code UI language.
 * Returns undefined for English UIs (nothing to translate into) and for
 * unknown locales (no button).
 */
export function resolveTranslationTarget(uiLang: string): TranslationTarget | undefined {
  const base = (uiLang || '').split('-')[0].toLowerCase();
  const info = LANGS[base];
  if (!info) return undefined;
  const native = info.native ?? {
    translate: `Translate to ${info.name}`,
    show: 'Show translation',
    hide: 'Hide translation',
    retranslate: 'Re-translate',
  };
  return {
    code: base,
    name: info.name,
    translate: native.translate,
    show: native.show,
    hide: native.hide,
    retranslate: native.retranslate,
    isTargetScript: info.script ? (text: string) => info.script!.test(text) : () => false,
  };
}

/**
 * Cache key for a translation: content hash of the target language + text,
 * so the same document translated into different languages never collides.
 */
export function makeTranslationKey(targetCode: string, text: string): string {
  return contentHash(`${targetCode}:${text}`);
}

/**
 * Whether hover text is worth translating: substantial length, not already
 * written in the target language's script, at least one Latin letter, and
 * not mostly code.
 */
export function isTranslatable(text: string, target?: TranslationTarget): boolean {
  const t = text.trim();
  if (t.length < MIN_TRANSLATABLE_CHARS || t.length > MAX_TRANSLATABLE_CHARS) return false;
  if (target && target.isTargetScript(t)) return false; // already in target language
  if (!/[a-zA-Z]/.test(t)) return false;
  const backticks = (t.match(/`/g) || []).length;
  if (backticks / t.length > 0.4) return false; // looks like pure code
  return true;
}

/**
 * Replace protected segments with {C0}/{I0}/{U0} placeholders.
 * Order matters: fenced blocks first (they may contain inline code and URLs),
 * then inline code, then bare URLs.
 */
export function extractPlaceholders(text: string): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  const counts = { C: 0, I: 0, U: 0 };

  let t = text.replace(/```[\s\S]*?```/g, (m) => {
    const ph = `{C${counts.C++}}`;
    map.set(ph, m);
    return ph;
  });
  t = t.replace(/`[^`\n]+`/g, (m) => {
    const ph = `{I${counts.I++}}`;
    map.set(ph, m);
    return ph;
  });
  t = t.replace(/https?:\/\/[^\s<>"'`)\]]+/g, (m) => {
    // Strip sentence-ending punctuation so "See https://x.com." leaves the
    // period in the prose instead of swallowing it into the placeholder.
    const cleaned = m.replace(/[.,;:]+$/, '');
    const ph = `{U${counts.U++}}`;
    map.set(ph, cleaned);
    return ph;
  });

  return { text: t, map };
}

/**
 * Restore placeholders from the AI translation. Unmatched placeholder tokens
 * (dropped or rewritten by the model) are kept as-is rather than crashing.
 */
export function restorePlaceholders(translated: string, map: Map<string, string>): string {
  return translated.replace(/\{([CIU])(\d+)\}/g, (m) => map.get(m) ?? m);
}

/**
 * Translate English API documentation into the target language (non-streaming).
 * @throws Error when no API key is configured or the API call fails.
 */
export async function translateHoverText(en: string, settings: CodeLearnerSettings, target: TranslationTarget): Promise<string> {
  const config = settings.getConfig();
  const apiKey = await settings.getApiKey(config.provider);
  if (!apiKey) {
    throw new Error('API key not configured. Run "Code Learner: Configure AI Provider" first.');
  }
  const system = [
    'You are a professional API documentation translator. Translate the given English',
    `API documentation into ${target.name}.`,
    'Rules:',
    '1. Keep all Markdown structure (headings, lists, bold, code fences as-is)',
    '2. Keep the placeholder tokens {C0}, {I0}, {U0}, ... exactly as they appear',
    '3. Do NOT translate code, identifiers, parameter names, type names, URLs, or file paths',
    '4. Technical terms may keep the English with the translation in parentheses',
    '5. Output ONLY the translation — no explanations, no preamble',
    '6. Keep each placeholder on its own line/paragraph as in the source — do NOT wrap placeholders in emphasis, italics, bold, or code markers, and do not merge them into other lines',
  ].join('\n');
  const user = `Translate this English API documentation to ${target.name}:\n\n${en}`;

  // Chinese output costs roughly 2-3 tokens per character — budget the answer
  // by source length * 2.5, or the configured maxTokens, whichever is larger.
  // (A /2 ratio truncated long docs like Keras's fit() docstring mid-section.)
  const baseTokens = Math.min(16_384, Math.max(config.maxTokens, Math.ceil(en.length * 2.5)));
  const call = (extra: Record<string, unknown>, maxTokens: number) =>
    config.provider === 'openai'
      ? callOpenAI(apiKey, config, system, user, maxTokens, extra)
      : callClaude(apiKey, config, system, user, maxTokens);

  // Reasoning models (e.g. DeepSeek) can burn the whole budget on
  // `reasoning_content` and return an empty `content` (their "thinking"
  // rewrites the whole document before answering). Attempts, in order:
  // 1. Try to disable thinking — some gateways honor `enable_thinking: false`
  //    (DeepSeek-style toggle); if the gateway rejects the unknown field we
  //    fall through to the next attempt.
  // 2. Full headroom budget without any extra params.
  let response = '';
  let lastError: unknown = null;
  for (const attempt of [
    { extra: { enable_thinking: false }, maxTokens: baseTokens },
    { extra: {}, maxTokens: 16_384 },
  ]) {
    try {
      response = await call(attempt.extra, attempt.maxTokens);
      if (response) break;
    } catch (e: unknown) {
      lastError = e;
    }
  }
  if (!response) {
    if (lastError) throw lastError;
    throw new Error(
      'AI returned an empty translation. Your model burns its token budget on reasoning; ' +
      'switch codeLearner.openaiModel to a non-reasoning model (e.g. deepseek-chat) or increase codeLearner.maxTokens.'
    );
  }
  return response;
}

/**
 * Normalize a chat-completions `message.content` field into plain text.
 * Handles plain strings (standard), arrays of text blocks (some OpenAI-
 * compatible gateways relay Anthropic-style responses), and empty values.
 */
function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return '';
}

async function callOpenAI(
  apiKey: string,
  config: import('../config/settings').CodeLearnerConfig,
  system: string,
  user: string,
  maxTokens: number,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const endpoint = config.openaiEndpoint.replace(/\/$/, '');
  const body = JSON.stringify({
    model: config.openaiModel,
    stream: false,
    temperature: 0.2,
    max_tokens: maxTokens,
    ...extra,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const response = await nodeRequestAndRead(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    let errorMessage = `OpenAI API error (${response.statusCode})`;
    try {
      const parsed = JSON.parse(response.body);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      errorMessage = response.body || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const parsed = JSON.parse(response.body);
  return normalizeContent(parsed.choices?.[0]?.message?.content);
}

async function callClaude(
  apiKey: string,
  config: import('../config/settings').CodeLearnerConfig,
  system: string,
  user: string,
  maxTokens: number
): Promise<string> {
  const endpoint = config.claudeEndpoint.replace(/\/$/, '');
  const body = JSON.stringify({
    model: config.claudeModel,
    stream: false,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const response = await nodeRequestAndRead(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    let errorMessage = `Claude API error (${response.statusCode})`;
    try {
      const parsed = JSON.parse(response.body);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      errorMessage = response.body || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const parsed = JSON.parse(response.body);
  return normalizeContent(parsed.content?.[0]?.text);
}
