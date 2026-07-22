/**
 * PHP parser - detects cells by function/class definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class PhpParser extends BaseParser {
  readonly languageId = 'php';
  readonly languageName = 'PHP';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(public|private|protected|static|final|abstract)?\s*function\s+\w+/,
      classDef: /^\s*(abstract|final|readonly)?\s*class\s+\w+/,
      importDef: /^(use|include|require|include_once|require_once)\s+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(public|private|protected|static|abstract)?\s*function\s+\w+/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(abstract|final|readonly)?\s*class\s+\w+/.test(line) ||
           /^\s*interface\s+\w+/.test(line) ||
           /^\s*trait\s+\w+/.test(line);
  }
}
