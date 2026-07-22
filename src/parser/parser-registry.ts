/**
 * Parser registry - maps language IDs to parser instances.
 * Central factory for all code parsers.
 */

import * as vscode from 'vscode';
import { BaseParser } from './base-parser';
import { PythonParser } from './python-parser';
import { JsTsParser } from './js-ts-parser';
import { JavaParser } from './java-parser';
import { CppParser } from './cpp-parser';
import { GoParser } from './go-parser';
import { RustParser } from './rust-parser';
import { RubyParser } from './ruby-parser';
import { PhpParser } from './php-parser';
import { CSharpParser } from './csharp-parser';
import { SwiftParser } from './swift-parser';
import { KotlinParser } from './kotlin-parser';
import { ShellParser } from './shell-parser';
import { GenericParser } from './generic-parser';

export class ParserRegistry {
  private parsers = new Map<string, BaseParser>();
  private genericParsers = new Map<string, GenericParser>();

  constructor() {
    this.registerBuiltinParsers();
  }

  private registerBuiltinParsers(): void {
    // Python
    this.register(new PythonParser());

    // JavaScript/TypeScript
    this.register(new JsTsParser('javascript'));
    this.register(new JsTsParser('typescript'));
    this.register(new JsTsParser('javascriptreact'));
    this.register(new JsTsParser('typescriptreact'));

    // Java
    this.register(new JavaParser());

    // C/C++
    this.register(new CppParser());

    // Go
    this.register(new GoParser());

    // Rust
    this.register(new RustParser());

    // Ruby
    this.register(new RubyParser());

    // PHP
    this.register(new PhpParser());

    // C#
    this.register(new CSharpParser());

    // Swift
    this.register(new SwiftParser());

    // Kotlin
    this.register(new KotlinParser());

    // Shell/Bash
    this.register(new ShellParser());
  }

  register(parser: BaseParser): void {
    this.parsers.set(parser.languageId, parser);
  }

  getParser(languageId: string): BaseParser {
    // Check for registered parser
    const existing = this.parsers.get(languageId);
    if (existing) return existing;

    // Check for cached generic parser
    const cached = this.genericParsers.get(languageId);
    if (cached) return cached;

    // Create new generic parser
    const generic = new GenericParser(languageId);
    this.genericParsers.set(languageId, generic);
    return generic;
  }

  /**
   * Parse a document into cells using the appropriate parser
   */
  parse(document: vscode.TextDocument, options?: Partial<import('./cell').ParseOptions>): import('./cell').CodeCell[] {
    const parser = this.getParser(document.languageId);
    return parser.parse(document, options);
  }

  /**
   * Get VS Code language selectors for all supported languages
   */
  getSupportedLanguageSelectors(): vscode.DocumentFilter[] {
    const selectors: vscode.DocumentFilter[] = [];

    // Built-in parsers
    for (const langId of this.parsers.keys()) {
      selectors.push({ language: langId, scheme: 'file' });
    }

    // Generic parsers cover everything else - but we don't register them as document selectors
    // since we handle them dynamically

    return selectors;
  }
}
