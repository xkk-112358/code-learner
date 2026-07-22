/**
 * Notebook Converter - Converts code files to Jupyter .ipynb format.
 * Uses AI to generate markdown explanations between code cells.
 */

import * as vscode from 'vscode';
import { ParserRegistry } from '../parser/parser-registry';
import { CodeCell } from '../parser/cell';
import { AIServiceManager } from '../ai/ai-service-manager';

/**
 * Convert a parsed code file to .ipynb JSON.
 * Code cells are created from parsed cells.
 * Optionally uses AI to generate markdown explanations between code cells.
 */
export async function convertToNotebook(
  document: vscode.TextDocument,
  parserRegistry: ParserRegistry,
  aiService?: AIServiceManager
): Promise<string> {
  const cells = parserRegistry.parse(document);
  const language = document.languageId;
  const fileName = document.fileName;

  // Build notebook cells
  const notebookCells: NotebookCell[] = [];

  // First cell: markdown intro
  notebookCells.push({
    cell_type: 'markdown',
    metadata: {},
    source: [
      `# ${fileName.split(/[/\\]/).pop()}\n`,
      `\n`,
      `> Auto-converted by Code Learner\n`,
      `> Language: ${language}\n`,
      `> Total cells: ${cells.length}\n`,
    ],
  });

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    // Add code cell
    const sourceLines = cell.source.split('\n').map(line => line + '\n');
    // Remove trailing newline from last line
    if (sourceLines.length > 0) {
      const last = sourceLines[sourceLines.length - 1];
      sourceLines[sourceLines.length - 1] = last.endsWith('\n') ? last : last;
    }

    notebookCells.push({
      cell_type: 'code',
      metadata: {
        codeLearner: {
          cellIndex: i,
          type: cell.type,
          marker: cell.marker,
        },
      },
      execution_count: null,
      source: sourceLines,
      outputs: [],
    });

    // Add markdown explanation cell (if AI service available and configured)
    if (aiService && i < cells.length - 1) {
      // This is a placeholder - actual AI explanation would need async streaming
      // For now, add a simple markdown cell with cell type info
      notebookCells.push({
        cell_type: 'markdown',
        metadata: {},
        source: [
          `## Cell ${i + 1}: ${getCellTypeName(cell.type)}\n`,
          `\n`,
          `*Code cell ${i + 1} of ${cells.length}*\n`,
          `\n`,
          `> This cell contains a **${cell.type}** definition.\n`,
        ],
      });
    } else if (i < cells.length - 1) {
      // No AI - add empty markdown separator
      notebookCells.push({
        cell_type: 'markdown',
        metadata: {},
        source: [
          `---\n`,
        ],
      });
    }
  }

  // Build notebook JSON
  const notebook: IpynbNotebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: getKernelSpec(language),
      language_info: getLanguageInfo(language),
      codeLearner: {
        sourceFile: fileName,
        sourceLanguage: language,
        convertedAt: new Date().toISOString(),
      },
    },
    cells: notebookCells,
  };

  return JSON.stringify(notebook, null, 2);
}

function getCellTypeName(type: string): string {
  const names: Record<string, string> = {
    function: 'Function Definition',
    class: 'Class Definition',
    import: 'Import / Module',
    code: 'Code Block',
    comment: 'Documentation',
    blank: 'Empty',
  };
  return names[type] || type;
}

function getKernelSpec(language: string): KernelSpec {
  const kernels: Record<string, KernelSpec> = {
    python: {
      display_name: 'Python 3',
      language: 'python',
      name: 'python3',
    },
    javascript: {
      display_name: 'JavaScript (Node.js)',
      language: 'javascript',
      name: 'node',
    },
    typescript: {
      display_name: 'TypeScript',
      language: 'typescript',
      name: 'typescript',
    },
    go: {
      display_name: 'Go',
      language: 'go',
      name: 'go',
    },
    rust: {
      display_name: 'Rust',
      language: 'rust',
      name: 'rust',
    },
    java: {
      display_name: 'Java',
      language: 'java',
      name: 'java',
    },
  };
  return kernels[language] || {
    display_name: language,
    language: language,
    name: language,
  };
}

function getLanguageInfo(language: string): LanguageInfo {
  const infos: Record<string, LanguageInfo> = {
    python: {
      name: 'python',
      version: '3.x',
      mimetype: 'text/x-python',
      file_extension: '.py',
      codemirror_mode: { name: 'ipython', version: 3 },
      nbconvert_exporter: 'python',
    },
    javascript: {
      name: 'javascript',
      version: 'ES2022',
      mimetype: 'text/javascript',
      file_extension: '.js',
    },
    typescript: {
      name: 'typescript',
      version: '5.x',
      mimetype: 'text/typescript',
      file_extension: '.ts',
    },
  };
  return infos[language] || {
    name: language,
    version: '',
    mimetype: `text/${language}`,
    file_extension: `.${language}`,
  };
}

// ── Type Definitions ─────────────────────────────────────

interface IpynbNotebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: NotebookMetadata;
  cells: NotebookCell[];
}

interface NotebookMetadata {
  kernelspec?: KernelSpec;
  language_info?: LanguageInfo;
  [key: string]: any;
}

interface KernelSpec {
  display_name: string;
  language: string;
  name: string;
}

interface LanguageInfo {
  name: string;
  version?: string;
  mimetype?: string;
  file_extension?: string;
  codemirror_mode?: any;
  nbconvert_exporter?: string;
}

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  metadata: Record<string, any>;
  source: string[];
  execution_count?: number | null;
  outputs?: any[];
}
