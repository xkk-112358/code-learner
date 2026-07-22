/**
 * AI Notebook Generator - Converts code files to Jupyter .ipynb using AI.
 * The AI splits code into meaningful cells with markdown explanations.
 */

import * as vscode from 'vscode';
import { CodeLearnerSettings } from '../config/settings';

export interface ConversionResult {
  /** The .ipynb JSON content as a string */
  content: string;
  /** The raw AI response text */
  rawResponse: string;
}

/**
 * Use AI to convert a code file into a well-structured Jupyter notebook.
 * The AI is prompted to split the code into logical cells and add explanatory markdown cells.
 */
export interface StoredExplanation {
  snippet: string;
  explanation: string;
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

  // Call AI and get the response
  const response = await callAiForNotebook(prompt, settings);

  // Parse the AI response into .ipynb JSON
  const notebookJson = parseResponseToNotebook(response, source, language, fileName, existingExplanations);

  return { content: notebookJson, rawResponse: response };
}

function buildNotebookPrompt(source: string, language: string, fileName: string): string {
  // Truncate very large files
  const maxChars = 15000;
  const truncatedSource = source.length > maxChars
    ? source.slice(0, maxChars) + '\n\n... (file truncated)'
    : source;

  return `Convert this ${language} code file into a Jupyter notebook (.ipynb).

The file is: ${fileName}

Code:
\`\`\`${language}
${truncatedSource}
\`\`\`

Please create a notebook where:
1. Split the code into LOGICAL cells - each function, class, or logical block gets its own code cell
2. Keep the code exactly as-is in code cells (preserve all comments and formatting)
3. Group related import statements together in a single cell
4. DO NOT add any extra markdown cells or commentary - only code cells
5. DO NOT add a title or intro cell

Respond ONLY with valid JSON in this exact format (no markdown, no \`\`\`json):
{"cells": [
  {"type": "code", "source": ["code line 1\\n", "code line 2\\n"]}
]}

Do not include any text before or after the JSON.`;
}

async function callAiForNotebook(prompt: string, settings: CodeLearnerSettings): Promise<string> {
  // We create a synthetic cell and context to reuse the existing AI infrastructure
  const cell = {
    index: 0,
    type: 'code' as const,
    startLine: 0,
    endLine: 0,
    source: '',
    marker: 'auto-section' as any,
    language: 'python',
  };

  // Build a request context
  const context = {
    filePath: 'notebook-conversion',
    language: 'python',
    fullSource: prompt,
  };

  const config = settings.getConfig();
  const apiKey = await settings.getApiKey(config.provider);

  if (!apiKey) {
    throw new Error('API key not configured. Run "Code Learner: Configure AI Provider" first.');
  }

  let accumulated = '';

  if (config.provider === 'openai') {
    accumulated = await callOpenAI(apiKey, config, prompt);
  } else {
    accumulated = await callClaude(apiKey, config, prompt);
  }

  return accumulated;
}

async function callOpenAI(apiKey: string, config: any, prompt: string): Promise<string> {
  const https = require('https');
  const urlObj = new URL(config.openaiEndpoint.replace(/\/$/, '') + '/chat/completions');

  const body = JSON.stringify({
    model: config.openaiModel,
    stream: false,
    temperature: 0.2,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: 'You are a code-to-notebook converter. Output ONLY valid JSON.' },
      { role: 'user', content: prompt },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      timeout: 120000,
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk.toString());
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content || '';
          resolve(content);
        } catch (e: any) {
          reject(new Error('Failed to parse OpenAI response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

async function callClaude(apiKey: string, config: any, prompt: string): Promise<string> {
  const https = require('https');
  const urlObj = new URL(config.claudeEndpoint.replace(/\/$/, '') + '/v1/messages');

  const body = JSON.stringify({
    model: config.claudeModel,
    stream: false,
    max_tokens: 4096,
    system: 'You are a code-to-notebook converter. Output ONLY valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 120000,
    }, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk.toString());
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.content?.[0]?.text || '';
          resolve(content);
        } catch (e: any) {
          reject(new Error('Failed to parse Claude response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

function parseResponseToNotebook(
  response: string,
  originalSource: string,
  language: string,
  fileName: string,
  existingExplanations?: StoredExplanation[]
): string {
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

  let cells: any[];
  try {
    const parsed = JSON.parse(jsonStr);
    cells = parsed.cells || [];
  } catch {
    // If AI response is not valid JSON, create a fallback notebook
    cells = createFallbackCells(originalSource, language, fileName);
  }

  // Validate and clean up cells
  const validatedCells = cells.map((cell: any, i: number) => {
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
        cell_type: 'code',
        metadata: { codeLearner: { index: i } },
        execution_count: null,
        source: source,
        outputs: [],
      };
    } else {
      return {
        cell_type: 'markdown',
        metadata: {},
        source: source,
      };
    }
  });

  // Build the notebook JSON
  const notebook = {
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
    cells: validatedCells,
  };

  return JSON.stringify(notebook, null, 2);
}

function createFallbackCells(source: string, language: string, fileName: string): any[] {
  // Simple fallback: split by double newlines
  const blocks = source.split(/\n\n+/);
  const cells: any[] = [];

  for (const block of blocks) {
    if (block.trim()) {
      cells.push({
        type: 'code',
        source: [block + '\n'],
      });
    }
  }

  return cells;
}

function getKernelSpec(language: string): any {
  const map: Record<string, any> = {
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

function getLanguageInfo(language: string): any {
  const map: Record<string, any> = {
    python: { name: 'python', version: '3.x', mimetype: 'text/x-python', file_extension: '.py' },
    javascript: { name: 'javascript', version: 'ES2022', mimetype: 'text/javascript', file_extension: '.js' },
    typescript: { name: 'typescript', version: '5.x', mimetype: 'text/typescript', file_extension: '.ts' },
    go: { name: 'go', version: '', mimetype: 'text/x-go', file_extension: '.go' },
    rust: { name: 'rust', version: '', mimetype: 'text/x-rust', file_extension: '.rs' },
  };
  return map[language] || { name: language, version: '', mimetype: 'text/plain', file_extension: '.' + language };
}
