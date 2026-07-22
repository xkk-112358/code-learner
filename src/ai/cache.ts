/**
 * Explanation cache - in-memory LRU cache for AI explanations.
 * Avoids redundant API calls when re-viewing cells.
 */

import { CodeCell } from '../parser/cell';

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
   * Build a cache key from cell and file information
   */
  getKey(cell: CodeCell, filePath: string, lang: string): string {
    return `${filePath}::${cell.index}::${lang}`;
  }

  /**
   * Get cached explanation
   */
  get(cell: CodeCell, filePath: string, lang: string): string | undefined {
    const key = this.getKey(cell, filePath, lang);
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
  set(cell: CodeCell, filePath: string, lang: string, explanation: string): void {
    const key = this.getKey(cell, filePath, lang);

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
   * Invalidate all cache entries for a specific file path
   */
  invalidate(filePath: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(`${filePath}::`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Check if a cell has a cached explanation
   */
  has(cell: CodeCell, filePath: string, lang: string): boolean {
    return this.cache.has(this.getKey(cell, filePath, lang));
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
