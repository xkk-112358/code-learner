/**
 * AI Notebook Generator - Converts code files to Jupyter .ipynb using AI.
 * The AI splits code into meaningful cells with markdown explanations.
 */

import * as vscode from 'vscode';
import { CodeLearnerSettings } from '../config/settings';
import { nodeRequestAndRead } from './streaming';

export interface ConversionResult {
  /** The .ipynb JSON content as a string */
  content: string;
  /** The raw AI response text */
  rawResponse: string;
  /** True when the AI response was invalid JSON and a blank-line fallback was used. */
  usedFallback: boolean;
}

/**
 * Max source chars sent to the AI for notebook conversion.
 * Code beyond this limit is NOT included in the resulting .ipynb,
 * so callers must warn the user before converting larger files.
 */
export const NOTEBOOK_SOURCE_CHAR_LIMIT = 15_000;

export interface StoredExplanation {
  snippet: string;
  explanation: string;
}

/** Minimal interface for cells parsed from AI JSON response. */
interface RawCell {
  type?: string;
  source?: string | string[];
}

interface KernelSpecInfo {
  display_name: string;
  language: string;
  name: string;
}

interface LanguageInfo {
  name: string;
  version?: string;
  mimetype?: string;
  file_extension?: string;
}

export async function generateNotebook(
  document: vscode.TextDocument,
  settings: CodeLearnerSettings,
  existingExplanations?: StoredExplanation[]
): Promise<ConversionResult> {
  const source = document.getText();
  const language = document.languageId;
  const fileName = document.fileName.split(/[/\\]/).pop() || 'untitled';

  // Build the AI prompt for notebook conversion
  const prompt = buildNotebookPrompt(source, language, fileName);

  // Scale the output budget with the input size: the JSON + escaped code of a
  // file near the char limit easily exceeds a fixed 4096-token budget, which
  // used to truncate the response and silently fall back to blank-line split.
  const truncatedSource = source.length > NOTEBOOK_SOURCE_CHAR_LIMIT
    ? source.slice(0, NOTEBOOK_SOURCE_CHAR_LIMIT)
    : source;
  const maxTokens = Math.min(16384, 4096 + Math.ceil(truncatedSource.length / 3));

  // Call AI and get the response
  const response = await callAiForNotebook(prompt, settings, maxTokens);

  // Parse the AI response into .ipynb JSON
  const { json: notebookJson, usedFallback } = parseResponseToNotebook(response, source, language, fileName, existingExplanations);

  return { content: notebookJson, rawResponse: response, usedFallback };
}

function buildNotebookPrompt(source: string, language: string, fileName: string): string {
  // Truncate very large files
  const truncatedSource = source.length > NOTEBOOK_SOURCE_CHAR_LIMIT
    ? source.slice(0, NOTEBOOK_SOURCE_CHAR_LIMIT) + '\n\n... (file truncated)'
    : source;

  return `Convert this ${language} code file into a code-only Jupyter notebook (.ipynb).
The result is a skeleton notebook that preserves the code structure — the user will
add explanations later. No markdown cells are needed.

The file is: ${fileName}

Code:
\`\`\`${language}
${truncatedSource}
\`\`\`

Rules:
1. Split the code into LOGICAL code cells — each function, class, or logical block gets its own cell
2. Keep the code exactly as-is (preserve all comments and formatting)
3. Group related import statements together in a single cell
4. Output ONLY code cells — no markdown cells, no title cell, no commentary

Respond ONLY with valid JSON in this exact format (no markdown, no \`\`\`json):
{"cells": [
  {"type": "code", "source": ["code line 1\\n", "code line 2\\n"]}
]}

Do not include any text before or after the JSON.`;
}

async function callAiForNotebook(prompt: string, settings: CodeLearnerSettings, maxTokens: number): Promise<string> {
  const config = settings.getConfig();
  const apiKey = await settings.getApiKey(config.provider);

  if (!apiKey) {
    throw new Error('API key not configured. Run "Code Learner: Configure AI Provider" first.');
  }

  if (config.provider === 'openai') {
    return callOpenAI(apiKey, config, prompt, maxTokens);
  } else {
    return callClaude(apiKey, config, prompt, maxTokens);
  }
}

async function callOpenAI(
  apiKey: string,
  config: import('../config/settings').CodeLearnerConfig,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const endpoint = config.openaiEndpoint.replace(/\/$/, '');
  const url = `${endpoint}/chat/completions`;

  const body = JSON.stringify({
    model: config.openaiModel,
    stream: false,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: 'You are a code-to-notebook converter. Output ONLY valid JSON.' },
      { role: 'user', content: prompt },
    ],
  });

  const response = await nodeRequestAndRead(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    let errorMessage = `OpenAI API error (${response.statusCode})`;
    try {
      const parsed = JSON.parse(response.body);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      errorMessage = response.body || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const parsed = JSON.parse(response.body);
  return parsed.choices?.[0]?.message?.content || '';
}

async function callClaude(
  apiKey: string,
  config: import('../config/settings').CodeLearnerConfig,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const endpoint = config.claudeEndpoint.replace(/\/$/, '');
  const url = `${endpoint}/v1/messages`;

  const body = JSON.stringify({
    model: config.claudeModel,
    stream: false,
    max_tokens: maxTokens,
    system: 'You are a code-to-notebook converter. Output ONLY valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  const response = await nodeRequestAndRead(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    let errorMessage = `Claude API error (${response.statusCode})`;
    try {
      const parsed = JSON.parse(response.body);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      errorMessage = response.body || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const parsed = JSON.parse(response.body);
  return parsed.content?.[0]?.text || '';
}

function parseResponseToNotebook(
  response: string,
  originalSource: string,
  language: string,
  fileName: string,
  existingExplanations?: StoredExplanation[]
): { json: string; usedFallback: boolean } {
  // Try to extract JSON from the response (handle backtick-wrapped JSON)
  let jsonStr = response.trim();

  // Remove markdown code fences if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Try to find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  let cells: RawCell[];
  let usedFallback = false;
  try {
    const parsed = JSON.parse(jsonStr);
    // Valid JSON with no cells (or a non-array "cells") must not produce an
    // empty notebook — fall back like an invalid response.
    if (Array.isArray(parsed.cells) && parsed.cells.length > 0) {
      cells = parsed.cells;
    } else {
      usedFallback = true;
      cells = createFallbackCells(originalSource, language, fileName);
    }
  } catch {
    // If AI response is not valid JSON, create a fallback notebook
    usedFallback = true;
    cells = createFallbackCells(originalSource, language, fileName);
  }

  // Validate and clean up cells
  const validatedCells = cells.map((cell: RawCell, i: number) => {
    let rawSource = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
    // Trim leading/trailing blank lines from each cell
    rawSource = rawSource.replace(/^\n+|\n+$/g, '');
    const source = rawSource.split('\n').map((line: string) => line + '\n');
    // Remove trailing newline from last line (standard .ipynb format)
    if (source.length > 0) {
      source[source.length - 1] = source[source.length - 1].replace(/\n$/, '');
    }
    const cellType = cell.type === 'code' ? 'code' : 'markdown';

    if (cellType === 'code') {
      return {
        cell_type: 'code' as const,
        metadata: { codeLearner: { index: i } },
        execution_count: null,
        source: source,
        outputs: [],
      };
    } else {
      return {
        cell_type: 'markdown' as const,
        metadata: {},
        source: source,
      };
    }
  });

  // Pre-existing explanations become VISIBLE markdown cells placed right
  // after the code cell they match — previously they were only written into
  // metadata.codeLearner.explanations and never shown anywhere.
  const notebookCells: typeof validatedCells = [...validatedCells];
  {
    const explained = new Set<number>();
    for (const exp of existingExplanations || []) {
      const sig = (exp.snippet || '').split('\n')[0]?.trim() || '';
      if (!sig) continue;
      const idx = notebookCells.findIndex(c => c.cell_type === 'code' && c.source.join('').includes(sig));
      if (idx < 0 || explained.has(idx)) continue;
      explained.add(idx);
      const mdSource = (exp.explanation || '').split('\n')
        .map((line, li, arr) => li === arr.length - 1 ? line : line + '\n');
      const mdCell = {
        cell_type: 'markdown' as const,
        metadata: { codeLearner: { explanationOf: idx } } as { [key: string]: unknown },
        source: mdSource,
      } as (typeof notebookCells)[number];
      notebookCells.splice(idx + 1, 0, mdCell);
    }
  }

  // Build the notebook JSON
  const notebook: Record<string, unknown> = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: getKernelSpec(language),
      language_info: getLanguageInfo(language),
      codeLearner: {
        sourceFile: fileName,
        sourceLanguage: language,
        convertedAt: new Date().toISOString(),
        explanations: existingExplanations || [],
        cellMapping: [],
      },
    },
    cells: notebookCells,
  };

  return { json: JSON.stringify(notebook, null, 2), usedFallback };
}

function createFallbackCells(source: string, _language: string, _fileName: string): RawCell[] {
  // Simple fallback: split on 2+ consecutive blank lines, but KEEP the blank
  // lines at the end of each block so the notebook preserves the original
  // file's spacing (plain split() would discard them).
  const cells: RawCell[] = [];
  const re = /\n\n+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const chunk = source.slice(last, m.index + m[0].length);
    last = m.index + m[0].length;
    if (chunk.trim()) {
      cells.push({ type: 'code', source: [chunk] });
    }
  }
  const tail = source.slice(last);
  if (tail.trim()) {
    cells.push({ type: 'code', source: [tail] });
  }

  return cells;
}

function getKernelSpec(language: string): KernelSpecInfo {
  const map: Record<string, KernelSpecInfo> = {
    python: { display_name: 'Python 3', language: 'python', name: 'python3' },
    javascript: { display_name: 'Node.js', language: 'javascript', name: 'nodejs' },
    typescript: { display_name: 'TypeScript', language: 'typescript', name: 'typescript' },
    go: { display_name: 'Go', language: 'go', name: 'go' },
    rust: { display_name: 'Rust', language: 'rust', name: 'rust' },
    java: { display_name: 'Java', language: 'java', name: 'java' },
    ruby: { display_name: 'Ruby', language: 'ruby', name: 'ruby' },
    php: { display_name: 'PHP', language: 'php', name: 'php' },
    csharp: { display_name: 'C#', language: 'csharp', name: 'csharp' },
    swift: { display_name: 'Swift', language: 'swift', name: 'swift' },
    kotlin: { display_name: 'Kotlin', language: 'kotlin', name: 'kotlin' },
    shellscript: { display_name: 'Bash', language: 'bash', name: 'bash' },
  };
  return map[language] || { display_name: language, language, name: language };
}

function getLanguageInfo(language: string): LanguageInfo {
  const map: Record<string, LanguageInfo> = {
    python: { name: 'python', version: '3.x', mimetype: 'text/x-python', file_extension: '.py' },
    javascript: { name: 'javascript', version: 'ES2022', mimetype: 'text/javascript', file_extension: '.js' },
    typescript: { name: 'typescript', version: '5.x', mimetype: 'text/typescript', file_extension: '.ts' },
    go: { name: 'go', version: '', mimetype: 'text/x-go', file_extension: '.go' },
    rust: { name: 'rust', version: '', mimetype: 'text/x-rust', file_extension: '.rs' },
  };
  return map[language] || { name: language, version: '', mimetype: 'text/plain', file_extension: '.' + language };
}
