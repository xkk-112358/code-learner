/**
 * Rust parser - detects cells by fn/struct/enum/impl/trait/mod definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class RustParser extends BaseParser {
  readonly languageId = 'rust';
  readonly languageName = 'Rust';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(pub\s+)?(async\s+)?(unsafe\s+)?fn\s+\w+/,
      classDef: /^\s*(pub\s+)?(struct|enum|trait|impl|union)\s+\w+/,
      importDef: /^\s*(pub\s+)?use\s+\w+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(pub\s+)?(async\s+)?(unsafe\s+)?fn\s+\w+/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(pub\s+)?(struct|enum|trait|impl)\s+\w+/.test(line);
  }
}
