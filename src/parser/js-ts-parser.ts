/**
 * JavaScript/TypeScript parser - detects cells by function/class/interface definitions
 * with brace counting for boundary detection.
 */

import { BaseParser } from './base-parser';
import { StructuralPatterns, STRUCTURAL_PATTERNS } from './auto-splitter';

export class JsTsParser extends BaseParser {
  readonly languageId: string;

  constructor(languageId: string = 'javascript') {
    super();
    this.languageId = languageId;
  }

  get languageName(): string {
    const names: Record<string, string> = {
      'javascript': 'JavaScript',
      'typescript': 'TypeScript',
      'javascriptreact': 'JavaScript React',
      'typescriptreact': 'TypeScript React',
    };
    return names[this.languageId] || 'JavaScript/TypeScript';
  }

  protected get structuralPatterns(): StructuralPatterns | undefined {
    return STRUCTURAL_PATTERNS[this.languageId] || STRUCTURAL_PATTERNS.javascript;
  }

  protected isFunctionDef(line: string): boolean {
    return /^(export\s+)?(async\s+)?function\s+\w+/.test(line) ||
           /^(export\s+)?(async\s+)?(const|let|var)\s+\w+\s*=/.test(line) ||
           /^\w+\s*\([^)]*\)\s*=>/.test(line);
  }

  protected isClassDef(line: string): boolean {
    return /^(export\s+)?(abstract\s+)?class\s+\w+/.test(line) ||
           /^(export\s+)?interface\s+\w+/.test(line) ||
           /^(export\s+)?type\s+\w+\s*=/.test(line);
  }
}
