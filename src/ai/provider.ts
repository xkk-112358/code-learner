/**
 * Abstract AI provider interface for code explanation services.
 * Supports streaming responses for real-time UI updates.
 */

import { CodeCell } from '../parser/cell';

export interface ProjectFileInfo {
  /** File name (not full path) */
  name: string;
  /** First few lines as snippet */
  snippet?: string;
}

export interface FileContext {
  /** Full path of the file being explained */
  filePath: string;
  /** Language identifier */
  language: string;
  /** Full source code of the entire file (for context) */
  fullSource: string;
  /** Related files in the project (for cross-file context) */
  projectFiles?: ProjectFileInfo[];
}

export interface ExplanationRequest {
  /** The cell to explain */
  cell: CodeCell;
  /** Full file context */
  context: FileContext;
  /** Language for the explanation ('zh-CN', 'en-US') */
  explanationLanguage: string;
}

export interface AIProviderConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface AIProvider {
  /** Provider display name */
  readonly name: string;

  /**
   * Explain a code cell, returning a streaming async iterable of markdown text chunks.
   * @throws Error if API call fails or authentication fails
   */
  explainCell(request: ExplanationRequest): AsyncIterable<string>;

  /**
   * Cancel the current explanation request
   */
  abort(): void;
}
