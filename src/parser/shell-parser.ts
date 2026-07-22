/**
 * Shell/Bash parser - detects cells by function definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class ShellParser extends BaseParser {
  readonly languageId = 'shellscript';
  readonly languageName = 'Shell';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(function\s+)?\w+\s*\(\s*\)\s*\{?$/,
      classDef: /.^/, // never matches - no class in shell
      importDef: /^\s*(source|\.)\s+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(function\s+)?\w+\s*\(\s*\)\s*\{?$/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return false;
  }
}
