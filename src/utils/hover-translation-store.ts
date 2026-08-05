/**
 * Hover translation store — global, persisted translations of built-in
 * hover documentation, keyed by a stable content hash so the same document
 * anywhere (any file, any position, any VS Code window) hits the same entry.
 *
 * Deliberately free of `vscode` imports (pure Node fs) so it can be unit
 * tested without mocking.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface TranslationEntry {
  /** Content hash (FNV-1a base36) of the English text — the cache key */
  h: string;
  /** Chinese translation */
  zh: string;
  /** Unix timestamp of the last write */
  ts: number;
}

export class HoverTranslationStore {
  static readonly MAX_ENTRIES = 200;

  private readonly maxSize: number;
  private entries = new Map<string, TranslationEntry>(); // insertion order = LRU order
  /** Session-level "translation currently shown" set. Seeded from disk at init
   *  so restarts default to showing translations; markHidden only hides for
   *  the current session (the cached entry survives). */
  private shown = new Set<string>();
  /** Serialized writes — concurrent save() calls must not race (an older
   *  snapshot could overwrite a newer one). Same pattern as codelens-provider. */
  private saveQueue: Promise<void> = Promise.resolve();
  private storagePath = '';

  constructor(maxSize: number = HoverTranslationStore.MAX_ENTRIES) {
    this.maxSize = maxSize;
  }

  /**
   * Load persisted entries from disk. Missing/corrupt files are ignored.
   * All loaded keys are seeded into the `shown` set (restart → translations
   * show by default).
   */
  async init(filePath: string): Promise<void> {
    this.storagePath = filePath;
    this.entries.clear();
    this.shown.clear();
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(raw);
      const list: TranslationEntry[] = Array.isArray(saved?.entries) ? saved.entries : [];
      for (const e of list) {
        if (e && typeof e.h === 'string' && typeof e.zh === 'string') {
          this.entries.set(e.h, { h: e.h, zh: e.zh, ts: typeof e.ts === 'number' ? e.ts : 0 });
          this.shown.add(e.h);
        }
      }
    } catch {
      // No saved data or first run / corrupt file
    }
  }

  /** Get a translation by hash. Touches LRU order on hit. */
  get(hash: string): TranslationEntry | undefined {
    const entry = this.entries.get(hash);
    if (entry) {
      this.entries.delete(hash);
      this.entries.set(hash, entry);
    }
    return entry;
  }

  /** Insert or refresh a translation. Evicts the oldest entry past the cap
   *  (from both entries and shown), then schedules a disk write. */
  set(hash: string, zh: string): void {
    this.entries.delete(hash);
    this.entries.set(hash, { h: hash, zh, ts: Date.now() });
    this.shown.add(hash);

    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.shown.delete(oldest);
    }

    void this.save();
  }

  isShown(hash: string): boolean {
    return this.shown.has(hash);
  }

  markShown(hash: string): void {
    this.shown.add(hash);
  }

  /** Session-only hide — the cached entry stays for next sessions. */
  markHidden(hash: string): void {
    this.shown.delete(hash);
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Persist to disk. Writes are serialized through a promise chain so
   * concurrent fire-and-forget saves cannot overwrite each other out of order.
   * Public so tests can await the flush.
   */
  save(): Promise<void> {
    const next = this.saveQueue.then(() => this.writeToDisk());
    this.saveQueue = next.catch(() => { /* errors are reported in writeToDisk */ });
    return next;
  }

  private async writeToDisk(): Promise<void> {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      await fs.mkdir(dir, { recursive: true }).catch(() => { /* dir exists */ });
      await fs.writeFile(
        this.storagePath,
        JSON.stringify({ version: 1, entries: Array.from(this.entries.values()) }, null, 2),
        'utf-8'
      );
    } catch (e: unknown) {
      console.error('[Code Learner] Hover translation save failed:', e instanceof Error ? e.message : String(e));
    }
  }
}
