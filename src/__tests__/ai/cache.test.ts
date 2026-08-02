import { describe, it, expect } from 'vitest';
import { ExplanationCache } from '../../ai/cache';
import { CodeCell, CellType, CellMarker } from '../../parser/cell';

function makeCell(index: number, source: string): CodeCell {
  return {
    index,
    source,
    language: 'python',
    type: CellType.CODE,
    startLine: index,
    endLine: index,
    marker: CellMarker.AUTO_SECTION,
  };
}

describe('ExplanationCache', () => {
  it('stores and retrieves an explanation', () => {
    const cache = new ExplanationCache();
    const cell = makeCell(0, 'x = 1');
    cache.set(cell, '/a.py', 'zh-CN', 'explanation');
    expect(cache.get(cell, '/a.py', 'zh-CN')).toBe('explanation');
  });

  it('returns undefined for a missing key', () => {
    const cache = new ExplanationCache();
    expect(cache.get(makeCell(0, 'x = 1'), '/a.py', 'zh-CN')).toBeUndefined();
  });

  it('does not return stale explanations when cell content changes', () => {
    const cache = new ExplanationCache();
    cache.set(makeCell(5, 'x = 1'), '/a.py', 'zh-CN', 'old explanation');
    // Same index + file, but edited source — must NOT hit the old cache entry.
    expect(cache.get(makeCell(5, 'x = 2'), '/a.py', 'zh-CN')).toBeUndefined();
  });

  it('hits the cache when content is identical', () => {
    const cache = new ExplanationCache();
    cache.set(makeCell(3, 'def foo():\n    pass'), '/a.py', 'en-US', 'expl');
    expect(cache.get(makeCell(3, 'def foo():\n    pass'), '/a.py', 'en-US')).toBe('expl');
  });

  it('keeps language-specific entries separate', () => {
    const cache = new ExplanationCache();
    const cell = makeCell(0, 'x = 1');
    cache.set(cell, '/a.py', 'zh-CN', '中文');
    expect(cache.get(cell, '/a.py', 'en-US')).toBeUndefined();
    expect(cache.get(cell, '/a.py', 'zh-CN')).toBe('中文');
  });

  it('evicts the oldest entry when at capacity', () => {
    const cache = new ExplanationCache(2);
    cache.set(makeCell(0, 'a'), '/a.py', 'zh-CN', 'e0');
    cache.set(makeCell(1, 'b'), '/a.py', 'zh-CN', 'e1');
    cache.set(makeCell(2, 'c'), '/a.py', 'zh-CN', 'e2');
    expect(cache.get(makeCell(0, 'a'), '/a.py', 'zh-CN')).toBeUndefined();
    expect(cache.get(makeCell(1, 'b'), '/a.py', 'zh-CN')).toBe('e1');
  });

  it('moves accessed entries to the most-recent position', () => {
    const cache = new ExplanationCache(2);
    cache.set(makeCell(0, 'a'), '/a.py', 'zh-CN', 'e0');
    cache.set(makeCell(1, 'b'), '/a.py', 'zh-CN', 'e1');
    cache.get(makeCell(0, 'a'), '/a.py', 'zh-CN'); // refresh e0
    cache.set(makeCell(2, 'c'), '/a.py', 'zh-CN', 'e2');
    // e1 is now the oldest and should be evicted
    expect(cache.get(makeCell(1, 'b'), '/a.py', 'zh-CN')).toBeUndefined();
    expect(cache.get(makeCell(0, 'a'), '/a.py', 'zh-CN')).toBe('e0');
  });

  it('keeps entries for different files independent', () => {
    const cache = new ExplanationCache();
    cache.set(makeCell(0, 'a'), '/a.py', 'zh-CN', 'e0');
    cache.set(makeCell(0, 'b'), '/b.py', 'zh-CN', 'e1');
    expect(cache.get(makeCell(0, 'a'), '/a.py', 'zh-CN')).toBe('e0');
    expect(cache.get(makeCell(0, 'b'), '/b.py', 'zh-CN')).toBe('e1');
  });

  it('clears all entries', () => {
    const cache = new ExplanationCache();
    cache.set(makeCell(0, 'a'), '/a.py', 'zh-CN', 'e0');
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
