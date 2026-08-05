/**
 * Shared content hashing (FNV-1a 32-bit → base36).
 * Used by the explanation cache and the hover translation store so that
 * identical content produces identical keys anywhere in the extension.
 */

/** Stable content hash (FNV-1a) — keeps cache keys in sync with content. */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
