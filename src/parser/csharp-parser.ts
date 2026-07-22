/**
 * C# parser - detects cells by class/method/property definitions
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns } from './auto-splitter';

export class CSharpParser extends BaseParser {
  readonly languageId = 'csharp';
  readonly languageName = 'C#';

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return {
      functionDef: /^\s*(public|private|protected|internal|static|virtual|override|async|unsafe)?\s*\w[\w<>]*\s+\w+\s*\(/,
      classDef: /^\s*(public|private|protected|internal|abstract|sealed|static|partial|record)?\s*(class|struct|interface|enum|record)\s+\w+/,
      importDef: /^using\s+\w+/,
    };
  }

  protected isFunctionDef(line: string): boolean {
    return /^\s*(public|private|protected|internal|static|virtual|override|async)?\s*\w[\w<>]*\s+\w+\s*\(/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^\s*(public|private|protected|internal|abstract|sealed|static|partial|record)?\s*(class|struct|interface|enum|record)\s+\w+/.test(line);
  }
}
