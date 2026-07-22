/**
 * Generic fallback parser for unsupported languages.
 * Uses manual markers + blank-line separation only.
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class GenericParser extends BaseParser {
  readonly languageId: string;
  readonly languageName: string;

  constructor(languageId: string) {
    super();
    this.languageId = languageId;
    this.languageName = languageId;
  }

  /** No structural patterns - falls back to blank-line split */
  protected get structuralPatterns(): StructuralPatterns | undefined {
    return undefined;
  }

  protected isFunctionDef(line: string): boolean {
    // Generic heuristic: word + ( pattern
    return /^\w+\s+[\w.]+\s*\(/.test(line);
  }

  protected isClassDef(line: string): boolean {
    // Generic heuristic
    return /^class\s+\w+/i.test(line) || /^struct\s+\w+/i.test(line);
  }
}
