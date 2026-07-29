/**
 * Factory helpers for creating CodeCell objects safely.
 */

import { CodeCell, CellType, CellMarker } from '../parser/cell';

/**
 * Create a minimal CodeCell for explanation requests.
 * Used in place of inline `{ ... } as any` casts.
 */
export function makeCellContext(
  index: number,
  source: string,
  language: string
): CodeCell {
  return {
    index,
    source,
    language,
    type: CellType.CODE,
    startLine: index,
    endLine: index,
    marker: CellMarker.AUTO_SECTION,
  };
}
