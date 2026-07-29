/**
 * Auto-splitter: language-agnostic automatic code cell detection.
 *
 * Works in passes:
 * 1. Language-specific structural parsing (functions, classes, imports)
 * 2. Blank-line separation (fallback)
 * 3. Merge small orphans
 */

import { CellMarker, SplitPoint } from './cell';

export interface StructuralPatterns {
  /** RegExp to detect top-level function definitions */
  functionDef: RegExp;
  /** RegExp to detect top-level class definitions */
  classDef: RegExp;
  /** RegExp to detect import/include statements */
  importDef: RegExp;
  /** Function that determines if a line is at top-level indent (col 0) */
  isTopLevel?: (line: string) => boolean;
}

/**
 * Structural patterns per language
 */
export const STRUCTURAL_PATTERNS: Record<string, StructuralPatterns> = {
  python: {
    functionDef: /^(async\s+)?def\s+\w+\s*\(/,
    classDef: /^class\s+\w+/,
    importDef: /^(import|from)\s+\w+/,
    isTopLevel: (line: string) => line.length > 0 && line[0] !== ' ' && line[0] !== '\t',
  },
  javascript: {
    functionDef: /^(export\s+)?(async\s+)?function\s+\w+/,
    classDef: /^(export\s+)?class\s+\w+/,
    importDef: /^(import|export)\s/,
    isTopLevel: (line: string) => line.length > 0 && line[0] !== ' ' && line[0] !== '\t',
  },
  typescript: {
    functionDef: /^(export\s+)?(async\s+)?function\s+\w+/,
    classDef: /^(export\s+)?(abstract\s+)?class\s+\w+/,
    importDef: /^(import|export)\s/,
    isTopLevel: (line: string) => line.length > 0 && line[0] !== ' ' && line[0] !== '\t',
  },
  java: {
    functionDef: /\b(public|private|protected|static)\s+\w+\s+\w+\s*\(/,
    classDef: /^((public|abstract|final)\s+)?(class|interface|enum)\s+\w+/,
    importDef: /^import\s+\w+/,
  },
  cpp: {
    functionDef: /\w+\s+\w+\s*\([^)]*\)\s*(\{|$)/,  // simplified
    classDef: /^(class|struct)\s+\w+/,
    importDef: /^#(include|import)/,
  },
  go: {
    functionDef: /^func\s+\w+/,
    classDef: /^type\s+\w+\s+(struct|interface)\s*\{/,
    importDef: /^import\s+("|\(|$)/,
  },
  rust: {
    functionDef: /^(pub\s+)?(unsafe\s+)?fn\s+\w+/,
    classDef: /^(pub\s+)?(struct|enum|trait|impl)\s+\w+/,
    importDef: /^(use|pub\s+use)\s+\w+/,
  },
};

export interface AutoSplitOptions {
  /** Minimum lines per cell */
  minLinesPerCell: number;
  /** Structural patterns for the language (optional, for fallback) */
  patterns?: StructuralPatterns;
}

/**
 * Perform auto-splitting on code lines
 */
export function autoSplit(
  lines: string[],
  options: AutoSplitOptions
): SplitPoint[] {
  const { minLinesPerCell, patterns } = options;
  const splits: SplitPoint[] = [];
  const passes: SplitPoint[][] = [];

  // Pass 1: Structural parsing (if patterns provided)
  if (patterns) {
    const structuralSplits = structuralPass(lines, patterns);
    if (structuralSplits.length > 0) {
      passes.push(structuralSplits);
      splits.push(...structuralSplits);
    }
  }

  // Pass 2: Blank-line separation
  const blankLineSplits = blankLinePass(lines, minLinesPerCell);
  // Only use blank-line splits if no structural splits were found
  if (passes.length === 0) {
    passes.push(blankLineSplits);
    splits.push(...blankLineSplits);
  }

  return splits;
}

/**
 * Pass 1: Detect structural split points (functions, classes, imports)
 */
function structuralPass(lines: string[], patterns: StructuralPatterns): SplitPoint[] {
  const splits: SplitPoint[] = [];
  const { functionDef, classDef, importDef, isTopLevel } = patterns;

  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check if at top level (col 0) if we have a checker
    if (isTopLevel && !isTopLevel(line)) continue;

    // Detect function definition
    if (functionDef.test(trimmed)) {
      splits.push({ line: i, marker: CellMarker.AUTO_FUNCTION });
      inImportBlock = false;
      continue;
    }

    // Detect class definition
    if (classDef.test(trimmed)) {
      splits.push({ line: i, marker: CellMarker.AUTO_CLASS });
      inImportBlock = false;
      continue;
    }

    // Detect import blocks (contiguous)
    if (importDef.test(trimmed)) {
      if (!inImportBlock) {
        splits.push({ line: i, marker: CellMarker.AUTO_IMPORT });
        inImportBlock = true;
      }
    } else {
      inImportBlock = false;
    }
  }

  // Remove duplicate consecutive splits
  return deduplicateSplits(splits);
}

/**
 * Pass 2: Split by blank lines (2+ consecutive blank lines = cell boundary)
 */
function blankLinePass(lines: string[], minLinesPerCell: number): SplitPoint[] {
  const splits: SplitPoint[] = [];

  let consecutiveBlankLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '') {
      consecutiveBlankLines++;
    } else {
      if (consecutiveBlankLines >= 2 && i > 0) {
        // The split point is at the beginning of this non-blank line
        splits.push({ line: i, marker: CellMarker.AUTO_BLANK_LINE });
      }
      consecutiveBlankLines = 0;
    }
  }

  return deduplicateSplits(splits);
}

/**
 * Remove consecutive duplicate split points
 */
function deduplicateSplits(splits: SplitPoint[]): SplitPoint[] {
  return splits.filter((split, index) => {
    if (index === 0) return true;
    return split.line !== splits[index - 1].line;
  });
}

/**
 * Merge split points that are too close together
 */
export function mergeSmallSplits(
  splits: SplitPoint[],
  lines: string[],
  minLinesPerCell: number
): SplitPoint[] {
  if (splits.length <= 1) return splits;

  const result: SplitPoint[] = [splits[0]];

  for (let i = 1; i < splits.length; i++) {
    const prev = result[result.length - 1];
    const current = splits[i];
    const cellLength = current.line - prev.line;

    // If the cell between these splits is too small, merge by skipping this split
    if (cellLength < minLinesPerCell) {
      continue; // Skip this split, merging with the next cell
    }

    result.push(current);
  }

  return result;
}
