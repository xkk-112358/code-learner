import { describe, it, expect } from 'vitest';
import { autoSplit, mergeSmallSplits, StructuralPatterns } from '../../parser/auto-splitter';
import { CellMarker } from '../../parser/cell';

// ── autoSplit ─────────────────────────────────────────────

describe('autoSplit', () => {
  it('returns empty array for empty input', () => {
    const result = autoSplit([], { minLinesPerCell: 3 });
    expect(result).toEqual([]);
  });

  it('detects Python function defs', () => {
    const lines = ['def foo():', '    pass', '', '', 'def bar():', '    pass'];
    const patterns: StructuralPatterns = {
      functionDef: /^(async\s+)?def\s+\w+\s*\(/,
      classDef: /^class\s+\w+/,
      importDef: /^(import|from)\s/,
      isTopLevel: (line) => !line.startsWith(' ') && !line.startsWith('\t'),
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    // functionDef matches at lines 0 and 4 -> splits at 0, 4
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].marker).toBe(CellMarker.AUTO_FUNCTION);
  });

  it('detects async Python function defs', () => {
    const lines = ['async def fetch():', '    pass', '', '', 'def process():', '    pass'];
    const patterns: StructuralPatterns = {
      functionDef: /^(async\s+)?def\s+\w+\s*\(/,
      classDef: /^class\s+\w+/,
      importDef: /^(import|from)\s/,
      isTopLevel: (line) => !line.startsWith(' ') && !line.startsWith('\t'),
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].marker).toBe(CellMarker.AUTO_FUNCTION);
  });

  it('detects class defs', () => {
    const lines = ['class Foo:', '    pass', '', '', 'class Bar:', '    pass'];
    const patterns: StructuralPatterns = {
      functionDef: /^(async\s+)?def\s+\w+\s*\(/,
      classDef: /^class\s+\w+/,
      importDef: /^(import|from)\s/,
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].marker).toBe(CellMarker.AUTO_CLASS);
  });

  it('detects import blocks and merges consecutive', () => {
    const lines = ['import os', 'import sys', '', 'x = 1'];
    const patterns: StructuralPatterns = {
      functionDef: /^def\s/,
      classDef: /^class\s/,
      importDef: /^(import|from)\s/,
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    // import blocks: "import os" at 0, "import sys" at 1 -> merged into one split at 0
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].marker).toBe(CellMarker.AUTO_IMPORT);
  });

  it('falls back to blank-line splits when no structural patterns', () => {
    const lines = ['line1', '', '', 'line2', '', '', 'line3'];
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns: undefined });
    // 2+ blank lines separate -> splits at 1 and 4 (start of non-blank lines)
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].marker).toBe(CellMarker.AUTO_BLANK_LINE);
  });

  it('blank-line pass: single blank line is ignored', () => {
    const lines = ['line1', '', 'line2'];
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns: undefined });
    // Only 1 blank line -> no splits
    expect(result.length).toBe(0);
  });

  it('deduplicates consecutive splits', () => {
    const lines = ['import os', '', '', 'x = 1'];
    const patterns: StructuralPatterns = {
      functionDef: /^def\s/,
      classDef: /^class\s/,
      importDef: /^(import|from)\s/,
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    // import "os" at 0 gives split at 0, blank lines at 1 gives split at 1
    // After dedup they should be distinct
    const uniqueLines = new Set(result.map(r => r.line));
    expect(uniqueLines.size).toBe(result.length);
  });

  it('isTopLevel filtering: nested def is not split in Python', () => {
    const lines = ['class Foo:', '    def inner(self):', '        pass'];
    const patterns: StructuralPatterns = {
      functionDef: /^(async\s+)?def\s+\w+\s*\(/,
      classDef: /^class\s+\w+/,
      importDef: /^(import|from)\s/,
      isTopLevel: (line) => !line.startsWith(' ') && !line.startsWith('\t'),
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    // Only class at line 0 should be detected, not nested def at line 1
    const classSplits = result.filter(r => r.marker === CellMarker.AUTO_CLASS);
    const funcSplits = result.filter(r => r.marker === CellMarker.AUTO_FUNCTION);
    expect(classSplits.length).toBe(1);
    expect(funcSplits.length).toBe(0);
  });

  it('no false positives on regular code lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `x${i} = ${i}`);
    const patterns: StructuralPatterns = {
      functionDef: /^(async\s+)?def\s+\w+\s*\(/,
      classDef: /^class\s+\w+/,
      importDef: /^(import|from)\s/,
    };
    const result = autoSplit(lines, { minLinesPerCell: 3, patterns });
    // No function/class/import patterns match -> no structural splits
    const structural = result.filter(r => r.marker !== CellMarker.AUTO_BLANK_LINE);
    expect(structural.length).toBe(0);
  });
});

// ── mergeSmallSplits ──────────────────────────────────────

describe('mergeSmallSplits', () => {
  it('returns single split unchanged', () => {
    const splits = [{ line: 0, marker: CellMarker.AUTO_FUNCTION }];
    const lines = ['def foo():', '    pass', '', 'def bar():', '    pass'];
    const result = mergeSmallSplits(splits, lines, 3);
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(0);
  });

  it('merges cells under minLinesPerCell', () => {
    // Splits at 0 and 2: cells would be [0..1] = 2 lines, [2..] = 1 line (if total=3)
    // Both < 3, merge all
    const splits = [
      { line: 0, marker: CellMarker.AUTO_FUNCTION },
      { line: 2, marker: CellMarker.AUTO_FUNCTION },
    ];
    const lines = ['a', 'b', 'c'];
    const result = mergeSmallSplits(splits, lines, 3);
    // After merge, only one split remains
    expect(result.length).toBe(1);
    expect(result[0].line).toBe(0);
  });

  it('keeps cells above threshold', () => {
    // Split at 0: cell [0..4] = 5 lines >= 3
    // Split at 5: cell [5..] >= 3
    const splits = [
      { line: 0, marker: CellMarker.AUTO_FUNCTION },
      { line: 5, marker: CellMarker.AUTO_FUNCTION },
    ];
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const result = mergeSmallSplits(splits, lines, 3);
    expect(result.length).toBe(2);
  });

  it('multiple consecutive small cells: first skipped, second kept because merged cell >= min', () => {
    const splits = [
      { line: 0, marker: CellMarker.AUTO_FUNCTION },
      { line: 2, marker: CellMarker.AUTO_FUNCTION },
      { line: 4, marker: CellMarker.AUTO_FUNCTION },
    ];
    const lines = Array.from({ length: 6 }, (_, i) => `line${i}`);
    const result = mergeSmallSplits(splits, lines, 3);
    // split 0 kept; split 2: cell [0..1] = 2 < 3, skip; split 4: cell [0..3] = 4 >= 3, keep
    // Result: [0, 4] -> two cells: [0..3] and [4..5]
    expect(result.length).toBe(2);
    expect(result[0].line).toBe(0);
    expect(result[1].line).toBe(4);
  });

  it('mixed: small then large then small', () => {
    const splits = [
      { line: 0, marker: CellMarker.AUTO_FUNCTION },
      { line: 2, marker: CellMarker.AUTO_FUNCTION },  // cell [0..1] = 2 lines < 3 -> merge
      { line: 8, marker: CellMarker.AUTO_FUNCTION },  // cell [2..7] = 6 lines >= 3 -> keep
      { line: 10, marker: CellMarker.AUTO_FUNCTION }, // cell [8..9] = 2 lines < 3 -> merge with 8
    ];
    const lines = Array.from({ length: 12 }, (_, i) => `line${i}`);
    const result = mergeSmallSplits(splits, lines, 3);
    // After merging: [0 merge with 2] -> keep 0; 8 merge with 10 -> keep 8
    expect(result.length).toBe(2);
    expect(result[0].line).toBe(0);
    expect(result[1].line).toBe(8);
  });

  it('handles empty splits array', () => {
    const result = mergeSmallSplits([], ['a', 'b', 'c'], 3);
    expect(result).toEqual([]);
  });
});
