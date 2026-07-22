/**
 * Python parser - detects cells by function/class definitions and indentation
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns, STRUCTURAL_PATTERNS } from './auto-splitter';

export class PythonParser extends BaseParser {
  readonly languageId = 'python';
  readonly languageName = 'Python';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return STRUCTURAL_PATTERNS.python;
  }

  protected isFunctionDef(line: string): boolean {
    return /^(async\s+)?def\s+\w+\s*\(/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^class\s+\w+/.test(line);
  }
}
