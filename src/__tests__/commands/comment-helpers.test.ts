import { describe, it, expect } from 'vitest';
import {
  wrapText,
  hasExistingComment,
  buildCommentBlock,
  deduplicateExplanations,
  makeCodeFingerprint,
  findMatchingLine,
} from '../../commands/comment-helpers';

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('short line')).toEqual(['short line']);
  });

  it('wraps long text at word boundaries', () => {
    const lines = wrapText('aaa bbb ccc ddd', 7);
    expect(lines.join(' ')).toBe('aaa bbb ccc ddd');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(7);
  });

  it('hard-breaks words longer than maxWidth', () => {
    const lines = wrapText('abcdefghijk', 5);
    expect(lines.join('')).toBe('abcdefghijk');
  });
});

describe('buildCommentBlock', () => {
  it('prefixes every line with the comment char', () => {
    const out = buildCommentBlock('line one\nline two', '# ');
    expect(out).toEqual(['# line one', '# line two']);
  });

  it('strips markdown headings and bold markers', () => {
    const out = buildCommentBlock('## Heading\n**bold** text', '// ');
    expect(out).toEqual(['// Heading', '// bold text']);
  });

  it('skips code fences and links', () => {
    const out = buildCommentBlock('```\ncode\n```\n[link](http://x)', '# ');
    expect(out).toEqual(['# code']);
  });
});

describe('hasExistingComment', () => {
  it('detects an existing explanation below', () => {
    expect(hasExistingComment('This function computes the total.', ['# this function computes the total.'])).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(hasExistingComment('This function computes the total.', ['# unrelated comment'])).toBe(false);
  });
});

describe('deduplicateExplanations', () => {
  it('keeps only the first occurrence of duplicate explanations', () => {
    const out = deduplicateExplanations([
      { explanation: 'a', snippet: 'x' },
      { explanation: 'b', snippet: 'y' },
      { explanation: 'a', snippet: 'z' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map(e => e.explanation)).toEqual(['a', 'b']);
  });
});

describe('makeCodeFingerprint', () => {
  it('normalizes whitespace and case of the first line', () => {
    expect(makeCodeFingerprint('  def   Foo( )  ')).toBe(makeCodeFingerprint('def foo()'));
  });

  it('returns empty for empty input', () => {
    expect(makeCodeFingerprint('')).toBe('');
  });
});

describe('findMatchingLine', () => {
  const docLines = [
    'def foo():',
    '    return 1',
    '',
    'def bar():',
    '    return 2',
    'def foo():', // duplicate of line 0
    '    return 3',
  ];

  it('finds the first match from the top without a hint', () => {
    expect(findMatchingLine('deffoo():', docLines)).toBe(0);
  });

  it('prefers the match at/after the hint line (duplicate lines)', () => {
    // Explanation recorded at line 5 — must match line 5, not line 0.
    expect(findMatchingLine('deffoo():', docLines, 5)).toBe(5);
  });

  it('falls back to a full scan when the hint does not match', () => {
    expect(findMatchingLine('return1', docLines, 2)).toBe(1);
  });

  it('returns -1 when nothing matches', () => {
    expect(findMatchingLine('no such code', docLines)).toBe(-1);
  });
});
