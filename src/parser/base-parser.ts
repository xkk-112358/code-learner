/**
 * Abstract base class for all language parsers.
 * Each language parser extends this and provides language-specific rules.
 */

import * as vscode from 'vscode';
import { CodeCell, CellType, CellMarker, ParseOptions, SplitPoint, DEFAULT_PARSE_OPTIONS } from './cell';
import { detectManualMarkers, getManualMarkerConfig } from './manual-marker';
import { autoSplit, mergeSmallSplits, StructuralPatterns } from './auto-splitter';

export abstract class BaseParser {
  abstract readonly languageId: string;
  abstract readonly languageName: string;

  /** Optional structural patterns for auto-splitting */
  protected abstract get structuralPatterns(): StructuralPatterns | undefined;

  /**
   * Parse a VS Code TextDocument into CodeCells
   */
  parse(document: vscode.TextDocument, options?: Partial<ParseOptions>): CodeCell[] {
    const lines = this.getLines(document, options?.maxLines ?? DEFAULT_PARSE_OPTIONS.maxLines);
    return this.parseLines(lines, document.languageId, options);
  }

  /**
   * Pure-function entry point for parsing lines into CodeCells.
   * Takes raw string lines instead of a TextDocument, making it testable
   * without VS Code mocking. Used by the parse() method above and by unit tests.
   */
  parseLines(lines: string[], language: string, options?: Partial<ParseOptions>): CodeCell[] {
    const opts: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options };
    const splitPoints = this.computeSplitPoints(lines, opts);
    const cells = this.buildCells(lines, splitPoints, language);
    this.classifyCells(cells);
    return cells;
  }

  /**
   * Get the lines of text to parse, respecting maxLines limit
   */
  private getLines(document: vscode.TextDocument, maxLines: number): string[] {
    const totalLines = document.lineCount;
    const lines: string[] = [];

    const limit = maxLines > 0 ? Math.min(totalLines, maxLines) : totalLines;
    for (let i = 0; i < limit; i++) {
      lines.push(document.lineAt(i).text);
    }

    return lines;
  }

  /**
   * Compute split points from manual markers and/or auto-detection
   */
  private computeSplitPoints(lines: string[], options: ParseOptions): SplitPoint[] {
    const allSplits: SplitPoint[] = [];

    // Manual markers
    if (options.mode === 'manual' || options.mode === 'both') {
      const markerConfig = getManualMarkerConfig(this.languageId);
      const manualSplits = detectManualMarkers(lines, markerConfig);
      allSplits.push(...manualSplits);
    }

    // Auto-detection
    if (options.mode === 'auto' || (options.mode === 'both' && allSplits.length === 0)) {
      const patterns = this.structuralPatterns;
      const autoSplits = autoSplit(lines, {
        minLinesPerCell: options.minLinesPerCell,
        patterns,
      });

      if (autoSplits.length > 0) {
        const merged = mergeSmallSplits(autoSplits, lines, options.minLinesPerCell);
        allSplits.push(...merged);
      }
    }

    // Sort by line number and deduplicate
    const sorted = allSplits.sort((a, b) => a.line - b.line);
    return sorted.filter((s, i) => i === 0 || s.line !== sorted[i - 1].line);
  }

  /**
   * Build CodeCell array from split points
   */
  private buildCells(lines: string[], splits: SplitPoint[], language: string): CodeCell[] {
    if (splits.length === 0) {
      // No splits - entire file is one cell
      return [{
        index: 0,
        type: CellType.CODE,
        startLine: 0,
        endLine: lines.length - 1,
        source: lines.join('\n'),
        marker: CellMarker.AUTO_SECTION,
        language,
      }];
    }

    const cells: CodeCell[] = [];
    let currentStart = 0;

    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      const endLine = split.line - 1;

      // Only create cell if it has content
      if (endLine >= currentStart) {
        const cellLines = lines.slice(currentStart, endLine + 1);
        if (cellLines.some(l => l.trim().length > 0)) {
          cells.push({
            index: cells.length,
            type: CellType.CODE,
            startLine: currentStart,
            endLine,
            source: cellLines.join('\n'),
            marker: split.marker,
            language,
          });
        }
      }

      currentStart = split.line;
    }

    // Last cell (from last split to end of file)
    if (currentStart < lines.length) {
      const cellLines = lines.slice(currentStart);
      if (cellLines.some(l => l.trim().length > 0)) {
        cells.push({
          index: cells.length,
          type: CellType.CODE,
          startLine: currentStart,
          endLine: lines.length - 1,
          source: cellLines.join('\n'),
          marker: CellMarker.AUTO_SECTION,
          language,
        });
      }
    }

    // If no cells were created (all blank?), make one
    if (cells.length === 0) {
      cells.push({
        index: 0,
        type: CellType.BLANK,
        startLine: 0,
        endLine: lines.length - 1,
        source: lines.join('\n'),
        marker: CellMarker.AUTO_SECTION,
        language,
      });
    }

    return cells;
  }

  /**
   * Classify each cell's type based on content
   */
  private classifyCells(cells: CodeCell[]): void {
    for (const cell of cells) {
      const firstLine = cell.source.split('\n')[0]?.trim() || '';

      if (cell.source.trim() === '') {
        cell.type = CellType.BLANK;
      } else if (/^(import|from|using|#include|#import|use|pub\s+use)\b/.test(firstLine)) {
        cell.type = CellType.IMPORT;
      } else if (this.isFunctionDef(firstLine)) {
        cell.type = CellType.FUNCTION;
      } else if (this.isClassDef(firstLine)) {
        cell.type = CellType.CLASS;
      } else if (/^#|^\/\/|^\/\*/.test(firstLine)) {
        cell.type = CellType.COMMENT;
      } else {
        cell.type = CellType.CODE;
      }
    }
  }

  protected abstract isFunctionDef(line: string): boolean;
  protected abstract isClassDef(line: string): boolean;
}
