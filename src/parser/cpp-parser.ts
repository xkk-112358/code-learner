/**
 * C/C++ parser - detects cells by function/class/struct definitions
 * with brace counting and preprocessor awareness.
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class CppParser extends BaseParser {
  readonly languageId = 'cpp';
  readonly languageName = 'C++';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*\w[\w<>*&]+\s+\w+\s*\([^)]*\)\s*(\{|;|$)/,
      classDef: /^\s*(class|struct|union)\s+\w+/,
      importDef: /^#\s*(include|import|define|pragma|if|ifdef|ifndef)/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    // Matches: return_type function_name(params) {
    // Or: type* function_name(params)
    return /^\s*\w[\w<>*&]+\s+\w+\s*\(/.test(line) ||
           /^\s*(virtual|static|inline|constexpr|template)\s/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(class|struct|union)\s+\w+/.test(line);
  }
}
