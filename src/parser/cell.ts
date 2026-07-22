/**
 * CodeCell data model - represents a single code cell within a file
 */

export enum CellType {
  IMPORT = 'import',
  FUNCTION = 'function',
  CLASS = 'class',
  CODE = 'code',
  COMMENT = 'comment',
  BLANK = 'blank',
}

export enum CellMarker {
  MANUAL = 'manual',
  AUTO_FUNCTION = 'auto-function',
  AUTO_CLASS = 'auto-class',
  AUTO_IMPORT = 'auto-import',
  AUTO_BLANK_LINE = 'auto-blank-line',
  AUTO_SECTION = 'auto-section',
}

export interface CodeCell {
  /** 0-based index in the cell list */
  index: number;
  /** Type of cell content */
  type: CellType;
  /** 0-based start line in the document */
  startLine: number;
  /** 0-based end line (inclusive) */
  endLine: number;
  /** Full source code of the cell */
  source: string;
  /** How this cell was detected */
  marker: CellMarker;
  /** Language identifier (e.g. 'python', 'typescript') */
  language: string;
  /** Cached AI explanation (populated after explanation) */
  explanation?: string;
  /** Whether this cell is currently being explained */
  isExplaining?: boolean;
}

export interface SplitPoint {
  /** 0-based line number where split occurs */
  line: number;
  /** Reason for this split */
  marker: CellMarker;
  /** For manual markers, the matched marker text */
  markerText?: string;
}

export interface ParseOptions {
  /** How to split code into cells */
  mode: 'auto' | 'manual' | 'both';
  /** Minimum lines per cell (for auto mode, default 3) */
  minLinesPerCell: number;
  /** Maximum lines to parse (0 = unlimited) */
  maxLines: number;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  mode: 'both',
  minLinesPerCell: 3,
  maxLines: 5000,
};
