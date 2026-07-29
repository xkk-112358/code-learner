/**
 * Manual marker detection for code cells.
 * Supports language-specific comment markers like # %%, // %%, /asterisk cell asterisk/
 */

import { CellMarker, SplitPoint } from './cell';

export interface ManualMarkerConfig {
  /** Display name */
  name: string;
  /** Array of regex patterns for manual markers */
  patterns: RegExp[];
  /** Array of comment characters used in the language */
  commentChars: string[];
}

/**
 * Manual marker configurations per language family
 */
export const MANUAL_MARKER_CONFIGS: Record<string, ManualMarkerConfig> = {
  python: {
    name: 'Python',
    patterns: [/^#\s*%%\s*$/, /^#\s*---\s*$/, /^#\s*<region>\s*$/i, /^#\s*cell\s*$/i],
    commentChars: ['#'],
  },
  javascript: {
    name: 'JavaScript',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i, /^\/\/\s*cell\s*$/i],
    commentChars: ['//'],
  },
  typescript: {
    name: 'TypeScript',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i, /^\/\/\s*cell\s*$/i],
    commentChars: ['//'],
  },
  typescriptreact: {
    name: 'TypeScript React',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i, /^\/\/\s*cell\s*$/i],
    commentChars: ['//'],
  },
  javascriptreact: {
    name: 'JavaScript React',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i, /^\/\/\s*cell\s*$/i],
    commentChars: ['//'],
  },
  java: {
    name: 'Java',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i, /^\/\/\s*cell\s*$/i, /^\/\*\s*cell\s*\*\/\s*$/i],
    commentChars: ['//', '/*'],
  },
  c: {
    name: 'C',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i],
    commentChars: ['//'],
  },
  cpp: {
    name: 'C++',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i],
    commentChars: ['//'],
  },
  go: {
    name: 'Go',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i],
    commentChars: ['//'],
  },
  rust: {
    name: 'Rust',
    patterns: [/^\/\/\s*%%\s*$/, /^\/\/\s*---\s*$/, /^\/\/\s*<region>\s*$/i],
    commentChars: ['//'],
  },
  ruby: {
    name: 'Ruby',
    patterns: [/^#\s*%%\s*$/, /^#\s*---\s*$/, /^#\s*<region>\s*$/i],
    commentChars: ['#'],
  },
  shellscript: {
    name: 'Shell',
    patterns: [/^#\s*%%\s*$/, /^#\s*---\s*$/, /^#\s*<region>\s*$/i],
    commentChars: ['#'],
  },
};

/**
 * Fallback config for unknown languages - tries to detect comment style from first comment line
 */
export const FALLBACK_MARKER_CONFIG: ManualMarkerConfig = {
  name: 'Generic',
  patterns: [/^[#/]\s*%%\s*$/, /^[#/]\s*---\s*$/, /^[#/]\s*<region>\s*$/i],
  commentChars: ['#', '//'],
};

/**
 * Detect manual split points in code lines
 */
export function detectManualMarkers(
  lines: string[],
  config: ManualMarkerConfig
): SplitPoint[] {
  const splits: SplitPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of config.patterns) {
      const match = line.match(pattern);
      if (match) {
        splits.push({
          line: i,
          marker: CellMarker.MANUAL,
          markerText: match[0].trim(),
        });
        break;
      }
    }
  }

  return splits;
}

/**
 * Get manual marker config for a language, with fallback
 */
export function getManualMarkerConfig(languageId: string): ManualMarkerConfig {
  return MANUAL_MARKER_CONFIGS[languageId] || FALLBACK_MARKER_CONFIG;
}
