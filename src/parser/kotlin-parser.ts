/**
 * Kotlin parser - detects cells by fun/class/object definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class KotlinParser extends BaseParser {
  readonly languageId = 'kotlin';
  readonly languageName = 'Kotlin';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(public|private|protected|internal|open|override|suspend|inline|tailrec)?\s*fun\s+\w+/,
      classDef: /^\s*(public|private|protected|internal|open|abstract|data|sealed|value)?\s*(class|interface|object|enum class|data class|sealed class)\s+\w+/,
      importDef: /^import\s+\w+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(public|private|protected|internal|open|override|suspend)?\s*fun\s+\w+/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(public|private|protected|internal|open|abstract|data|sealed)?\s*(class|interface|object|enum class)\s+\w+/.test(line);
  }
}
