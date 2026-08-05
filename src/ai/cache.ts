/**
 * Explanation cache - in-memory LRU cache for AI explanations.
 * Avoids redundant API calls when re-viewing cells.
 */

import { CodeCell } from '../parser/cell';
import { contentHash } from '../utils/hash';

interface CacheEntry {
  explanation: string;
  timestamp: number;
}

export class ExplanationCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  /**
   * Build a cache key from cell and file information.
   * Includes a content hash so that editing the code invalidates the
   * cached explanation for the same cell index, and an optional project
   * fingerprint so explanations referencing stale project context are
   * not reused.
   */
  getKey(cell: CodeCell, filePath: string, lang: string, projectKey?: string): string {
    const base = `${filePath}::${cell.index}::${contentHash(cell.source || '')}::${lang}`;
    return projectKey ? `${base}::${projectKey}` : base;
  }

  /**
   * Get cached explanation
   */
  get(cell: CodeCell, filePath: string, lang: string, projectKey?: string): string | undefined {
    const key = this.getKey(cell, filePath, lang, projectKey);
    const entry = this.cache.get(key);

    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.explanation;
    }

    return undefined;
  }

  /**
   * Store explanation in cache
   */
  set(cell: CodeCell, filePath: string, lang: string, explanation: string, projectKey?: string): void {
    const key = this.getKey(cell, filePath, lang, projectKey);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      explanation,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate all cache entries for a specific file path.
   * Called when explanations are deleted so a re-explain actually re-queries
   * the AI instead of replaying the removed (cached) result.
   */
  invalidate(filePath: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(`${filePath}::`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached explanations
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }
}
