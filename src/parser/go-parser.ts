/**
 * Go parser - detects cells by function/type/struct/interface definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class GoParser extends BaseParser {
  readonly languageId = 'go';
  readonly languageName = 'Go';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^func\s+(\w+\s*)?\(/,
      classDef: /^type\s+\w+\s+(struct|interface)\s*(\{|$)/,
      importDef: /^import\s+("|\(|\w+)/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^func\s+(\w+\s*)?\(/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^type\s+\w+\s+(struct|interface)\s*(\{|$)/.test(line);
  }
}
