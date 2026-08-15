/**
 * Global extension state — module-level singletons with getter/setter functions.
 * All command modules import state from here instead of relying on module-level
 * variables in extension.ts.
 */

import * as vscode from 'vscode';
import { AIServiceManager } from './ai/ai-service-manager';
import { CodeLearnerSettings } from './config/settings';
import { CodeLearnerCodeLensProvider } from './ui/codelens-provider';
import { AIHoverProvider } from './ui/hover-provider';
import { ExplanationCache } from './ai/cache';
import { HoverTranslationStore } from './utils/hover-translation-store';

// ── Singletons ──────────────────────────────────────────

let _aiServiceManager: AIServiceManager | undefined;
let _codeLearnerSettings: CodeLearnerSettings | undefined;
let _codelensProvider: CodeLearnerCodeLensProvider | undefined;
let _aiHover: AIHoverProvider | undefined;
let _cache: ExplanationCache | undefined;
let _hoverTranslationStore: HoverTranslationStore | undefined;

// ── Operation lock ──────────────────────────────────────

let _processing = false;
let _processingTimer: ReturnType<typeof setTimeout> | undefined;
/** Generation counter: a timed-out operation must NOT release the lock while
 *  a NEWER operation owns it. Without this, op A's `finally` would reset
 *  `_processing` after op B had already acquired the lock (A timed out at 60s,
 *  B started, then A finished and cleared B's lock) — letting two requests
 *  run concurrently and abort each other. */
let _processingGeneration = 0;
const LOCK_TIMEOUT_MS = 60_000;

export async function withLock<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (_processing) {
    vscode.window.showWarningMessage(
      vscode.env.language.startsWith('zh')
        ? `请等待当前操作完成（正在执行：${label}）`
        : `Please wait — "${label}" is still running`
    );
    return undefined;
  }
  const gen = ++_processingGeneration;
  _processing = true;

  // Safety timeout: auto-release lock if operation hangs, and abort the
  // underlying request so it stops running (and stops writing cache/UI) in
  // the background.
  _processingTimer = setTimeout(() => {
    if (gen !== _processingGeneration) return; // superseded by a newer operation
    _processing = false;
    _processingTimer = undefined;
    getAIServiceManager()?.abort();
    console.error(`[Code Learner] Lock auto-released: "${label}" exceeded ${LOCK_TIMEOUT_MS / 1000}s`);
  }, LOCK_TIMEOUT_MS);

  try { return await fn(); }
  catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    let msg = err.message;
    // A lock-timeout or user-cancel abort is not an error the user needs to
    // see — the operation was interrupted on purpose.
    if (/aborted|cancelled/i.test(msg)) return undefined;
    msg = msg.replace(/sk-([a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, 'sk-$1****');
    msg = msg.replace(/sk-ant-([a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, 'sk-ant-$1****');
    console.error(`[Code Learner] ${label}:`, msg);
    vscode.window.showErrorMessage(msg.length > 200 ? msg.slice(0, 200) + '...' : msg);
    return undefined;
  }
  finally {
    if (gen !== _processingGeneration) return; // a newer operation owns the lock
    if (_processingTimer) { clearTimeout(_processingTimer); _processingTimer = undefined; }
    _processing = false;
  }
}

// ── Getters ─────────────────────────────────────────────

export function getAIServiceManager(): AIServiceManager | undefined { return _aiServiceManager; }
export function getCodeLearnerSettings(): CodeLearnerSettings | undefined { return _codeLearnerSettings; }
export function getCodeLensProvider(): CodeLearnerCodeLensProvider | undefined { return _codelensProvider; }
export function getAIHover(): AIHoverProvider | undefined { return _aiHover; }
export function getHoverTranslationStore(): HoverTranslationStore | undefined { return _hoverTranslationStore; }

// ── Setters ─────────────────────────────────────────────

export function initState(context: vscode.ExtensionContext): void {
  _cache = new ExplanationCache();
  _codeLearnerSettings = new CodeLearnerSettings(context.secrets);
  _aiServiceManager = new AIServiceManager(_codeLearnerSettings, _cache);
  _hoverTranslationStore = new HoverTranslationStore();
}

export function setCodeLensProvider(p: CodeLearnerCodeLensProvider): void { _codelensProvider = p; }
export function setAIHover(p: AIHoverProvider): void { _aiHover = p; }
