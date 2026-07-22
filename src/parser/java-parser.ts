/**
 * Java parser - detects cells by class/interface/method definitions
 * with brace counting for boundary detection.
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class JavaParser extends BaseParser {
  readonly languageId = 'java';
  readonly languageName = 'Java';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(public|private|protected|static|final|abstract|synchronized|native)\s.*\w+\s*\(/,
      classDef: /^\s*(public|abstract|final|sealed|non-sealed|static)?\s*(class|interface|enum|record|annotation|@interface)\s+\w+/,
      importDef: /^import\s+(static\s+)?\w+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(public|private|protected|static|final|abstract|synchronized)\s.*\w+\s*\(/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(public|abstract|final|sealed|static)?\s*(class|interface|enum|record)\s+\w+/.test(line);
  }
}
