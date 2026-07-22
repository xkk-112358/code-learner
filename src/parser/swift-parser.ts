/**
 * Swift parser - detects cells by func/class/struct/enum definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class SwiftParser extends BaseParser {
  readonly languageId = 'swift';
  readonly languageName = 'Swift';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(public|private|internal|fileprivate|static|class|override|mutating|async)?\s*func\s+\w+/,
      classDef: /^\s*(public|private|internal|fileprivate|open|final|abstract)?\s*(class|struct|enum|protocol|extension)\s+\w+/,
      importDef: /^import\s+\w+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(public|private|internal|fileprivate|static|class|override|mutating|async)?\s*func\s+\w+/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(public|private|internal|fileprivate|open|final)?\s*(class|struct|enum|protocol|extension)\s+\w+/.test(line);
  }
}
