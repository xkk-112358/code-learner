import { describe, it, expect } from 'vitest';
import {
  isTranslatable,
  extractPlaceholders,
  restorePlaceholders,
  makeTranslationKey,
  resolveTranslationTarget,
  MIN_TRANSLATABLE_CHARS,
  MAX_TRANSLATABLE_CHARS,
} from '../../ai/hover-translator';

describe('isTranslatable', () => {
  it('rejects empty and whitespace-only text', () => {
    expect(isTranslatable('')).toBe(false);
    expect(isTranslatable('   \n  ')).toBe(false);
  });

  it('rejects text shorter than the minimum', () => {
    expect(isTranslatable('x'.repeat(MIN_TRANSLATABLE_CHARS - 1))).toBe(false);
  });

  it('accepts text at or above the minimum length', () => {
    expect(isTranslatable('Adjust the padding between and around subplots.')).toBe(true);
  });

  it('rejects text longer than the maximum', () => {
    expect(isTranslatable('x'.repeat(MAX_TRANSLATABLE_CHARS + 1))).toBe(false);
  });

  it('rejects text that already contains Chinese (zh target)', () => {
    const zh = resolveTranslationTarget('zh-cn')!;
    expect(isTranslatable('调整子图之间的填充距离。 '.repeat(5), zh)).toBe(false);
  });

  it('rejects text already written in the target script (ja / ko)', () => {
    const ja = resolveTranslationTarget('ja')!;
    expect(isTranslatable('これは日本語のテキストです。 '.repeat(4), ja)).toBe(false);
    expect(isTranslatable('This is English text. '.repeat(3), ja)).toBe(true);
    const ko = resolveTranslationTarget('ko')!;
    expect(isTranslatable('이것은 한국어 텍스트입니다. '.repeat(4), ko)).toBe(false);
  });

  it('rejects text without Latin letters', () => {
    expect(isTranslatable('12345 67890 '.repeat(8))).toBe(false);
  });

  it('rejects mostly-code text (high backtick ratio)', () => {
    const code = '`a` `.b` `c` `d` `e` `f` `g` `h` `i` `j` `k` `l` `m` `n`';
    expect(isTranslatable(code)).toBe(false);
  });
});

describe('extractPlaceholders', () => {
  it('extracts fenced code blocks', () => {
    const { text, map } = extractPlaceholders('See:\n```python\nx = 1\n```\nDone.');
    expect(text).toBe('See:\n{C0}\nDone.');
    expect(map.get('{C0}')).toBe('```python\nx = 1\n```');
  });

  it('does not re-extract code inside fenced blocks', () => {
    const src = 'Before ```go to https://x.com now`} end``` after';
    const { text, map } = extractPlaceholders(src);
    // The whole fence is one placeholder — its inner URL/backticks are untouched.
    expect(text).toBe('Before {C0} after');
    expect(map.get('{C0}')).toBe('```go to https://x.com now`} end```');
  });

  it('extracts inline code', () => {
    const { text, map } = extractPlaceholders('Call `tight_layout` with pad.');
    expect(text).toBe('Call {I0} with pad.');
    expect(map.get('{I0}')).toBe('`tight_layout`');
  });

  it('extracts URLs', () => {
    const { text, map } = extractPlaceholders('See https://example.com/a?b=1 for details.');
    expect(text).toBe('See {U0} for details.');
    expect(map.get('{U0}')).toBe('https://example.com/a?b=1');
  });

  it('stops URL extraction at closing parentheses', () => {
    const { text, map } = extractPlaceholders('See [here](https://example.com/x).');
    expect(map.get('{U0}')).toBe('https://example.com/x');
    expect(text).toBe('See [here]({U0}).');
  });

  it('numbers placeholders continuously per type', () => {
    const src = '```a``` then `b` then https://u.com then ```c```';
    const { text } = extractPlaceholders(src);
    expect(text).toBe('{C0} then {I0} then {U0} then {C1}');
  });

  it('returns the original text unchanged when nothing matches', () => {
    const src = 'Just plain prose, nothing to protect.';
    const { text, map } = extractPlaceholders(src);
    expect(text).toBe(src);
    expect(map.size).toBe(0);
  });
});

describe('resolveTranslationTarget', () => {
  it('maps zh-cn to the Chinese target with native labels', () => {
    const t = resolveTranslationTarget('zh-cn')!;
    expect(t.code).toBe('zh');
    expect(t.name).toBe('Simplified Chinese');
    expect(t.translate).toBe('翻译为中文');
    expect(t.show).toBe('显示译文');
    expect(t.hide).toBe('隐藏翻译');
    expect(t.retranslate).toBe('重新翻译');
  });

  it('maps ja and fr with native labels', () => {
    const ja = resolveTranslationTarget('ja')!;
    expect(ja.name).toBe('Japanese');
    expect(ja.translate).toBe('日本語に翻訳');
    const fr = resolveTranslationTarget('fr-FR')!;
    expect(fr.name).toBe('French');
    expect(fr.translate).toBe('Traduire en français');
  });

  it('falls back to English labels for languages without native labels', () => {
    const t = resolveTranslationTarget('id')!;
    expect(t.name).toBe('Indonesian');
    expect(t.translate).toBe('Translate to Indonesian');
    expect(t.hide).toBe('Hide translation');
  });

  it('returns undefined for English UIs and unknown locales', () => {
    expect(resolveTranslationTarget('en')).toBeUndefined();
    expect(resolveTranslationTarget('en-US')).toBeUndefined();
    expect(resolveTranslationTarget('xx')).toBeUndefined();
  });
});

describe('makeTranslationKey', () => {
  it('differs per target language for the same text', () => {
    expect(makeTranslationKey('zh', 'doc text')).not.toBe(makeTranslationKey('ja', 'doc text'));
  });

  it('is stable for the same language and text', () => {
    expect(makeTranslationKey('zh', 'doc text')).toBe(makeTranslationKey('zh', 'doc text'));
  });
});

describe('restorePlaceholders', () => {
  it('round-trips extracted segments', () => {
    const src = '```python\nx = 1\n```\nCall `foo()` at https://example.com.';
    const { map } = extractPlaceholders(src);
    // Simulate a translation that moved the placeholders around.
    const translated = `调用 {I0}，示例见：{C0}（{U0}）。`;
    expect(restorePlaceholders(translated, map)).toBe(
      '调用 `foo()`，示例见：```python\nx = 1\n```（https://example.com）。'
    );
  });

  it('keeps unmatched placeholder tokens instead of crashing', () => {
    const { map } = extractPlaceholders('`code`');
    // {C5} matches the placeholder pattern but is not in the map (model
    // invented it) — it must survive untouched, not throw.
    expect(restorePlaceholders('模型把 {C5} 弄丢了。', map)).toBe('模型把 {C5} 弄丢了。');
  });
});
