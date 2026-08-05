import { describe, it, expect } from 'vitest';
import { contentHash } from '../../utils/hash';

describe('contentHash (FNV-1a)', () => {
  it('is deterministic for identical input', () => {
    const text = 'Adjust the padding between and around subplots.';
    expect(contentHash(text)).toBe(contentHash(text));
  });

  it('produces a stable base36 string', () => {
    const hash = contentHash('some docstring text');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    expect(/^[0-9a-z]+$/.test(hash)).toBe(true);
  });

  it('differs for different input', () => {
    expect(contentHash('padding')).not.toBe(contentHash('padding '));
  });
});
