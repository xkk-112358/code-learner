/**
 * Commands behind the hover translation buttons:
 * - translateHover: translate the built-in hover doc at a position (or reveal
 *   a cached translation) and re-show the hover
 * - showOriginalHover: hide the translation for this session and re-show
 *
 * Deliberately NOT wrapped in withLock — translation is a small side action
 * and the global lock (60s hard kill, blocks all other features) would be
 * harmful. Concurrency is handled by per-hash in-flight dedup instead.
 */

import * as vscode from 'vscode';
import { getCodeLearnerSettings, getHoverTranslationStore } from '../state';
import { fetchBuiltinHoverText } from '../ui/hover-provider';
import { contentHash } from '../utils/hash';
import { extractPlaceholders, isTranslatable, translateHoverText } from '../ai/hover-translator';
import { showError } from '../utils/error-utils';
import { t } from '../utils/helpers';

/** In-flight translation requests keyed by content hash — double-clicks (or
 *  two buttons for the same doc) only fire one AI call. */
const inflight = new Map<string, Promise<string>>();

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findEditor(uri: vscode.Uri): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.toString() === uri.toString()) return active;
  return vscode.window.visibleTextEditors.find(ed => ed.document.uri.toString() === uri.toString());
}

/**
 * Re-open the hover at a position after a button click. Clicking a command
 * link closes the hover widget asynchronously; calling showHover while the
 * old widget is still tearing down is silently swallowed ("already visible →
 * just focus, no refresh"), which is why the user sometimes had to hover
 * again. So: hide explicitly (best effort), wait for teardown, then call
 * showHover twice — the retry covers versions that drop the first request
 * while the mouse is still parked on the symbol.
 */
async function showHoverAt(editor: vscode.TextEditor, pos: vscode.Position): Promise<void> {
  editor.selection = new vscode.Selection(pos, pos);
  await Promise.resolve(vscode.commands.executeCommand('editor.action.hideHover')).catch(() => { /* older versions */ });
  await delay(200);
  const [maj, min] = vscode.version.split('.').map(Number);
  // 1.89+: the focus option keeps the editor focused instead of stealing focus.
  const show = () => {
    const args = maj > 1 || (maj === 1 && min >= 89) ? { focus: 'noAutoFocus' } : undefined;
    return Promise.resolve(vscode.commands.executeCommand('editor.action.showHover', args)).catch(() => { /* retry below */ });
  };
  await show();
  await delay(60);
  await show();
}

/**
 * Translate the built-in hover documentation at (line, char) and re-show the
 * hover. The button passes only a hash hint — the actual text is re-fetched
 * here so a stale/forged hash never translates the wrong content.
 * forceRefresh (the "重新翻译" button) bypasses the cached translation and
 * re-calls the AI.
 */
export async function translateHover(uri: vscode.Uri, line: number, char: number, _hash: string, forceRefresh: boolean = false): Promise<void> {
  const store = getHoverTranslationStore();
  if (!store) return;
  const editor = findEditor(uri);
  if (!editor) return;

  const pos = new vscode.Position(line, char);
  try {
    const builtin = await fetchBuiltinHoverText(uri, pos);
    if (!builtin) {
      vscode.window.showInformationMessage(t('此处没有可翻译的文档', 'No translatable documentation here'));
      return;
    }
    const { text } = extractPlaceholders(builtin);
    if (!isTranslatable(text)) {
      vscode.window.showInformationMessage(t('此处没有可翻译的文档', 'No translatable documentation here'));
      return;
    }

    const hash = contentHash(text);
    let zh = store.get(hash)?.zh;
    if (forceRefresh || !zh) {
      const settings = getCodeLearnerSettings();
      if (!settings) return;
      // Key in-flight requests by hash + freshness so a "重新翻译" click never
      // reuses a regular translate that is still running (and vice versa).
      const inflightKey = `${hash}:${forceRefresh ? 'f' : ''}`;
      let pending = inflight.get(inflightKey);
      if (!pending) {
        // Bottom-right progress toast (same pattern as the explain flow).
        pending = Promise.resolve(
          vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: t('正在翻译…', 'Translating…') },
            () => translateHoverText(text, settings)
          )
        ).finally(() => inflight.delete(inflightKey));
        inflight.set(inflightKey, pending);
      }
      zh = await pending;
    }

    store.set(hash, zh);
    store.markShown(hash);
    await showHoverAt(editor, pos);
  } catch (e: unknown) {
    showError('Translate hover', e);
  }
}

/** Hide the translation for this session (the cached entry survives) and
 *  re-show the hover so the button flips back to 翻译. */
export async function showOriginalHover(uri: vscode.Uri, line: number, char: number, hash: string): Promise<void> {
  const store = getHoverTranslationStore();
  if (!store) return;
  const editor = findEditor(uri);
  if (!editor) return;
  try {
    store.markHidden(hash);
    await showHoverAt(editor, new vscode.Position(line, char));
  } catch (e: unknown) {
    showError('Show original hover', e);
  }
}
