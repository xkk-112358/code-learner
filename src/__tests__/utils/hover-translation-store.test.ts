import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { HoverTranslationStore } from '../../utils/hover-translation-store';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cl-store-'));
  filePath = path.join(dir, 'hover-translations.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('HoverTranslationStore', () => {
  it('stores and retrieves a translation', () => {
    const store = new HoverTranslationStore();
    store.set('abc', '中文译文');
    expect(store.get('abc')?.zh).toBe('中文译文');
    expect(store.size).toBe(1);
  });

  it('returns undefined for a missing hash', () => {
    const store = new HoverTranslationStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('updates an existing entry in place', () => {
    const store = new HoverTranslationStore();
    store.set('abc', 'v1');
    store.set('abc', 'v2');
    expect(store.size).toBe(1);
    expect(store.get('abc')?.zh).toBe('v2');
  });

  it('evicts the oldest entry at capacity', () => {
    const store = new HoverTranslationStore(2);
    store.set('a', '1');
    store.set('b', '2');
    store.set('c', '3');
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')?.zh).toBe('2');
    expect(store.get('c')?.zh).toBe('3');
  });

  it('moves accessed entries to the most-recent position', () => {
    const store = new HoverTranslationStore(2);
    store.set('a', '1');
    store.set('b', '2');
    store.get('a'); // refresh a
    store.set('c', '3');
    expect(store.get('b')).toBeUndefined(); // b is now oldest
    expect(store.get('a')?.zh).toBe('1');
  });

  it('removes evicted entries from the shown set too', () => {
    const store = new HoverTranslationStore(1);
    store.set('a', '1');
    store.markShown('a');
    store.set('b', '2'); // evicts a
    expect(store.isShown('a')).toBe(false);
    expect(store.isShown('b')).toBe(true);
  });

  it('tracks show/hide per session without touching the entry', () => {
    const store = new HoverTranslationStore();
    store.set('abc', '中文');
    expect(store.isShown('abc')).toBe(true); // set implies shown
    store.markHidden('abc');
    expect(store.isShown('abc')).toBe(false);
    // Hiding does not remove the cached entry.
    expect(store.get('abc')?.zh).toBe('中文');
  });

  it('persists to disk and restores on a fresh instance (shown seeded)', async () => {
    const store = new HoverTranslationStore();
    await store.init(filePath);
    store.set('abc', '中文');
    store.markHidden('abc');
    await store.save();

    const reloaded = new HoverTranslationStore();
    await reloaded.init(filePath);
    expect(reloaded.get('abc')?.zh).toBe('中文');
    // Restart semantics: persisted keys are seeded into `shown`.
    expect(reloaded.isShown('abc')).toBe(true);
  });

  it('ignores a missing file', async () => {
    const store = new HoverTranslationStore();
    await store.init(path.join(dir, 'does-not-exist.json'));
    expect(store.size).toBe(0);
  });

  it('ignores a corrupt file', async () => {
    await fs.writeFile(filePath, '{not valid json', 'utf-8');
    const store = new HoverTranslationStore();
    await store.init(filePath);
    expect(store.size).toBe(0);
  });
});
