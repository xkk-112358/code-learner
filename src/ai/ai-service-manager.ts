/**
 * AI Service Manager - orchestrates providers, settings, cache, and project context.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { CodeLearnerSettings } from '../config/settings';
import { AIProvider, ExplanationRequest, ProjectFileInfo } from './provider';
import { OpenAIProvider } from './openai-provider';
import { ClaudeProvider } from './claude-provider';
import { ExplanationCache } from './cache';
import { CodeCell } from '../parser/cell';

/** FNV-1a fingerprint of the project context, used in the explanation cache key. */
function fingerprintProject(project: { fileTree: string; files: ProjectFileInfo[] }): string {
  let hash = 0x811c9dc5;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  feed(project.fileTree);
  for (const f of project.files) {
    feed(f.name);
    feed(f.snippet || '');
  }
  return (hash >>> 0).toString(36);
}

export class AIServiceManager {
  private openAIProvider: OpenAIProvider | null = null;
  private claudeProvider: ClaudeProvider | null = null;
  private cache: ExplanationCache;
  private settings: CodeLearnerSettings;

  // Project context cache — avoids re-scanning the workspace on every explainCell call
  private projectCache: { key: string; result: { fileTree: string; files: ProjectFileInfo[] }; timestamp: number } | null = null;
  private readonly PROJECT_CACHE_TTL = 30_000; // 30 seconds

  constructor(settings: CodeLearnerSettings, cache: ExplanationCache) {
    this.settings = settings;
    this.cache = cache;
  }

  private async getProvider(): Promise<AIProvider> {
    const config = this.settings.getConfig();
    const apiKey = await this.settings.getApiKey(config.provider);

    if (!apiKey) {
      throw new Error('API key not configured. Run "Code Learner: Configure AI Provider" first.');
    }

    if (config.provider === 'openai') {
      const cfg = { apiKey, endpoint: config.openaiEndpoint, model: config.openaiModel, maxTokens: config.maxTokens, temperature: config.temperature };
      if (!this.openAIProvider) {
        this.openAIProvider = new OpenAIProvider(cfg);
      } else {
        this.openAIProvider.updateConfig(cfg);
      }
      return this.openAIProvider;
    } else {
      const cfg = { apiKey, endpoint: config.claudeEndpoint, model: config.claudeModel, maxTokens: config.maxTokens, temperature: config.temperature };
      if (!this.claudeProvider) {
        this.claudeProvider = new ClaudeProvider(cfg);
      } else {
        this.claudeProvider.updateConfig(cfg);
      }
      return this.claudeProvider;
    }
  }

  /**
   * Build comprehensive project context: file tree + key file contents
   */
  private async getProjectContext(filePath: string): Promise<{ fileTree: string; files: ProjectFileInfo[] }> {
    // Check cache
    const now = Date.now();
    if (this.projectCache && this.projectCache.key === filePath && (now - this.projectCache.timestamp) < this.PROJECT_CACHE_TTL) {
      return this.projectCache.result;
    }

    let fileTree = '';
    const files: ProjectFileInfo[] = [];

    try {
      // Find workspace root
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this.projectCache = { key: filePath, result: { fileTree: '', files }, timestamp: now };
        return { fileTree: '', files };
      }

      const rootUri = workspaceFolders[0].uri;
      const rootPath = rootUri.fsPath;
      const relativePath = filePath.startsWith(rootPath) ? filePath.slice(rootPath.length + 1) : filePath.split(/[/\\]/).pop() || '';

      // Build file tree (ignore node_modules, .git, __pycache__, etc.)
      const ignored = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.vscode']);
      const treeLines: string[] = ['Project structure:'];

      const readDirTree = async (uri: vscode.Uri, prefix: string, depth: number) => {
        if (depth > 3) return; // max depth
        try {
          const entries = await vscode.workspace.fs.readDirectory(uri);
          for (const [name, type] of entries) {
            if (ignored.has(name) || name.startsWith('.')) continue;
            if (type === vscode.FileType.Directory) {
              treeLines.push(`${prefix}📁 ${name}/`);
              await readDirTree(vscode.Uri.joinPath(uri, name), prefix + '  ', depth + 1);
            } else {
              treeLines.push(`${prefix}📄 ${name}`);
              // Read content of source files (up to 8 total)
              if (files.length < 8) {
                const ext = name.split('.').pop()?.toLowerCase();
                if (ext && ['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'cpp', 'c', 'h', 'rb', 'php', 'swift', 'kt', 'cs', 'css', 'html', 'json'].includes(ext)) {
                  try {
                    const fileUri = vscode.Uri.joinPath(uri, name);
                    // Use workspace-relative paths so same-named files in
                    // different directories don't get mixed up in the prompt.
                    const relName = path.relative(rootPath, fileUri.fsPath) || name;
                    // The current file is already sent in full via fullSource —
                    // skip it here to avoid paying tokens twice.
                    if (relName === relativePath) continue;
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const text = new TextDecoder().decode(content);
                    const lines = text.split('\n');
                    const snippet = lines.slice(0, 30).join('\n');
                    files.push({ name: relName, snippet: snippet.length > 2000 ? snippet.slice(0, 2000) + '...' : snippet });
                  } catch { /* skip */ }
                }
              }
            }
          }
        } catch { /* skip */ }
      };

      await readDirTree(rootUri, '', 0);
      fileTree = treeLines.join('\n');
    } catch { /* no workspace */ }

    // Cache result for subsequent calls
    this.projectCache = { key: filePath, result: { fileTree, files }, timestamp: now };
    return { fileTree, files };
  }

  /**
   * Determine explanation language based on VS Code locale
   */
  private resolveExplanationLanguage(): string {
    const vscodeLang = vscode.env.language;
    if (vscodeLang.startsWith('zh')) return 'zh-CN';
    return 'en-US';
  }

  async *explainCell(
    cell: CodeCell,
    fileUri: vscode.Uri,
    document: { getText: () => string; languageId: string; lineCount?: number },
    forceRefresh: boolean = false,
    cacheable: boolean = true
  ): AsyncIterable<string> {
    const config = this.settings.getConfig();
    const explanationLang = this.resolveExplanationLanguage();
    // For notebook-cell URIs fsPath is not a meaningful cache key — use the
    // full URI string so cells in the same notebook map consistently.
    const cachePath = fileUri.scheme === 'file' ? fileUri.fsPath : fileUri.toString();

    // Project context is computed BEFORE the cache check so its fingerprint
    // can be part of the cache key: explanations go stale when other files
    // in the project change.
    const project = await this.getProjectContext(cachePath);
    const projectKey = fingerprintProject(project);

    // Check cache
    if (!forceRefresh && config.cacheEnabled) {
      const cached = this.cache.get(cell, cachePath, explanationLang, projectKey);
      if (cached) { yield cached; return; }
    }

    // Get provider and build request
    const provider = await this.getProvider();
    const fullSource = typeof document.getText === 'function' ? document.getText() : '';
    const projectFiles = [
      { name: '📁 Project Structure', snippet: project.fileTree },
      ...project.files,
    ];

    const request: ExplanationRequest = {
      cell,
      context: {
        filePath: cachePath,
        language: document.languageId,
        fullSource,
        projectFiles,
      },
      explanationLanguage: explanationLang,
    };

    let accumulated = '';
    for await (const chunk of provider.explainCell(request)) {
      accumulated += chunk;
      yield chunk;
    }

    // Q&A prompts (cacheable=false) must not pollute the explanation cache.
    if (cacheable && config.cacheEnabled && accumulated) {
      this.cache.set(cell, cachePath, explanationLang, accumulated, projectKey);
    }
  }

  /** Abort controller for the notebook-conversion request (non-streaming,
   *  so it can't ride the providers' SSE abort paths). Created on demand,
   *  reset on every abort. */
  private notebookAbortController: AbortController | null = null;

  /** Get (and create) the abort signal for a notebook conversion request. */
  notebookSignal(): AbortSignal {
    if (!this.notebookAbortController) this.notebookAbortController = new AbortController();
    return this.notebookAbortController.signal;
  }

  abort(): void {
    this.openAIProvider?.abort();
    this.claudeProvider?.abort();
    this.notebookAbortController?.abort();
    this.notebookAbortController = null;
  }

  /** Drop cached explanations for a file (used when explanations are deleted). */
  invalidateCache(filePath: string): void {
    this.cache.invalidate(filePath);
  }
}
