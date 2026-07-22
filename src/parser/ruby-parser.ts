/**
 * Ruby parser - detects cells by def/class/module definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class RubyParser extends BaseParser {
  readonly languageId = 'ruby';
  readonly languageName = 'Ruby';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^def\s+\w+/,
      classDef: /^class\s+\w+/,
      importDef: /^(require|include|extend|import|load)\s+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^def\s+\w+/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^class\s+\w+/.test(line) || /^module\s+\w+/.test(line);
  }
}
