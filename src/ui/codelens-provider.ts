/**
 * AI explanations with persistent storage (survives VS Code restarts).
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { storageKey } from '../utils/helpers';

export interface QAPair { id: string; question: string; answer: string }

export interface ExplanationTiming {
  elapsed: number;  // milliseconds
  chars: number;    // character count of explanation
}

interface AIExplanation {
  fingerprint: string;
  codeSnippet: string;
  explanation: string;
  tagKey: string;
  anchorText: string;
  qas: QAPair[];
  // Original position for 💡 placement (persisted)
  posLine: number;
  posCol: number;
  timing?: ExplanationTiming;
}

interface PersistedExp {
  fingerprint: string; codeSnippet: string; explanation: string;
  anchorText: string; qas: QAPair[]; posLine: number; posCol: number;
  timing?: ExplanationTiming;
}

let pairIdCounter = 0;
// Timestamp prefix keeps ids unique across extension restarts (the counter
// resets to 0 on reload, which previously collided with persisted Q&A ids).
function genPairId(): string { return 'qa_' + Date.now().toString(36) + '_' + (++pairIdCounter); }

function makeFP(text: string): string {
  return text.split('\n')[0]?.trim().replace(/\s+/g, '').slice(0, 60).toLowerCase() || '';
}

// ── Persisted file pairings ──────────────────────────────
const filePairs = new Map<string, Set<string>>();
let pairsChanged = false;

export function registerFilePair(fileA: string, fileB: string): void {
  const add = (from: string, to: string) => {
    if (!filePairs.has(from)) filePairs.set(from, new Set());
    filePairs.get(from)!.add(to);
  };
  add(fileA, fileB); add(fileB, fileA);
  pairsChanged = true;
}

export function unregisterFilePair(fileA: string, fileB: string): void {
  filePairs.get(fileA)?.delete(fileB);
  filePairs.get(fileB)?.delete(fileA);
  pairsChanged = true;
}

/**
 * Get files paired with the given path (e.g., .py ↔ .ipynb).
 * No longer uses fs.accessSync — paired paths are returned as-is;
 * callers gracefully handle lookups for non-existent files.
 */
export function getPairedPaths(filePath: string): string[] {
  const result = new Set<string>();
  if (filePath.endsWith('.py')) {
    result.add(filePath.replace(/\.py$/, '.ipynb'));
  }
  if (filePath.endsWith('.ipynb')) {
    result.add(filePath.replace(/\.ipynb$/, '.py'));
  }
  const explicit = filePairs.get(filePath);
  if (explicit) explicit.forEach(p => result.add(p));
  return Array.from(result);
}

// ── Persistence ──────────────────────────────────────────
let _storagePath = '';

export function setStoragePath(p: string): void { _storagePath = p; }

function getSavePath(): string {
  if (!_storagePath) return '';
  return path.join(_storagePath, 'code-learner-data.json');
}

async function loadPersistedDataAsync(): Promise<{
  data: Map<string, AIExplanation[]>;
  pairs: Map<string, Set<string>>;
}> {
  const dataMap = new Map<string, AIExplanation[]>();
  const pairMap = new Map<string, Set<string>>();
  const savePath = getSavePath();
  if (!savePath) return { data: dataMap, pairs: pairMap };
  try {
    const raw = await fs.readFile(savePath, 'utf-8');
    const saved = JSON.parse(raw);
    for (const entry of saved.explanations || []) {
      const exps: AIExplanation[] = (entry.exps || []).map((e: PersistedExp) => ({
        ...e,
        tagKey: `${entry.filePath}::${e.fingerprint}`,
        qas: e.qas || [],
      }));
      dataMap.set(entry.filePath, exps);
    }
    for (const [a, b] of saved.pairs || []) {
      const add = (from: string, to: string) => {
        if (!pairMap.has(from)) pairMap.set(from, new Set());
        pairMap.get(from)!.add(to);
      };
      add(a, b); add(b, a);
    }
  } catch {
    // No saved data or first run
  }
  return { data: dataMap, pairs: pairMap };
}

export class CodeLearnerCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  private data = new Map<string, AIExplanation[]>();
  private decoMap = new Map<string, { deco: vscode.TextEditorDecorationType; anchor: string; posLine: number; posCol: number }>();
  /**
   * Soft-deleted explanations whose code lines have been removed.
   * Kept here so they can be restored if the user undoes the deletion.
   * Keyed by filePath.
   */
  private deletedExplanations = new Map<string, AIExplanation[]>();
  /** In inlay-hint carrier mode the 💡 decorations are not rendered — the
   * InlayHint provider (inlay-hint-provider.ts) shows the 💡 instead, so each
   * explanation has exactly one visible 💡. */
  private useInlayHintCarrier = false;

  /**
   * Lightweight constructor — does no I/O.
   * Call await init() after construction to load persisted data.
   */
  constructor() {
    // Empty data/decoMap initialized above; data loaded asynchronously in init()
  }

  /**
   * Load persisted explanations and rebuild decoration state.
   * Must be called once after construction, before the provider is registered.
   */
  async init(): Promise<void> {
    const saved = await loadPersistedDataAsync();
    if (saved.data.size > 0 || saved.pairs.size > 0) {
      this.data = saved.data;

      // Restore filePairs
      for (const [from, toSet] of saved.pairs) {
        for (const to of toSet) {
          const add = (a: string, b: string) => {
            if (!filePairs.has(a)) filePairs.set(a, new Set());
            filePairs.get(a)!.add(b);
          };
          add(from, to); add(to, from);
        }
      }

      // Rebuild decoration types from loaded data
      for (const [filePath, exps] of this.data) {
        for (const exp of exps) {
          this.addDeco(filePath, exp.posLine, exp.posCol, exp.tagKey, exp.anchorText);
        }
      }
    }
  }

  private saveQueue: Promise<void> = Promise.resolve();

  /**
   * Persist data. Writes are serialized through a promise chain: concurrent
   * fs.writeFile calls (e.g. a fire-and-forget sync save racing a command-path
   * save) have no completion-order guarantee, so an older snapshot could
   * otherwise overwrite a newer one.
   */
  private save(): Promise<void> {
    const next = this.saveQueue.then(() => this.writeToDisk());
    this.saveQueue = next.catch(() => { /* errors are reported in writeToDisk */ });
    return next;
  }

  private async writeToDisk(): Promise<void> {
    const savePath = getSavePath();
    if (!savePath) return;
    try {
      const dir = path.dirname(savePath);
      await fs.mkdir(dir, { recursive: true }).catch(() => { /* dir exists */ });
      const entries: { filePath: string; exps: PersistedExp[] }[] = [];
      for (const [filePath, exps] of this.data) {
        entries.push({
          filePath,
          exps: exps.map(e => ({
            fingerprint: e.fingerprint, codeSnippet: e.codeSnippet,
            explanation: e.explanation, anchorText: e.anchorText,
            qas: e.qas, posLine: e.posLine, posCol: e.posCol,
            timing: e.timing,
          })),
        });
      }
      const pairs: [string, string][] = [];
      const seen = new Set<string>();
      for (const [from, toSet] of filePairs) {
        for (const to of toSet) {
          const key = [from, to].sort().join('||');
          if (!seen.has(key)) { seen.add(key); pairs.push([from, to]); }
        }
      }
      await fs.writeFile(savePath, JSON.stringify({ version: 1, explanations: entries, pairs }, null, 2), 'utf-8');
    } catch (e: unknown) { console.error('[Code Learner] Save failed:', e instanceof Error ? e.message : String(e)); }
  }

  refresh(): void { this._onDidChange.fire(); }

  async addExplanation(filePath: string, range: vscode.Range, explanation: string, anchorText?: string, codeSnippet?: string, timing?: ExplanationTiming): Promise<void> {
    this._store(filePath, range, explanation, anchorText, codeSnippet, timing);
    for (const paired of getPairedPaths(filePath)) {
      if (paired !== filePath) this._store(paired, range, explanation, anchorText, codeSnippet, timing);
    }
    await this.save();
    if (pairsChanged) { pairsChanged = false; await this.save(); }
  }

  private _store(filePath: string, range: vscode.Range, explanation: string, anchorText?: string, codeSnippet?: string, timing?: ExplanationTiming): void {
    if (!this.data.has(filePath)) this.data.set(filePath, []);
    const list = this.data.get(filePath)!;
    // Fall back to the anchor text so entries without a code snippet (e.g. Q&A
    // answers) still get a fingerprint and remain reachable/removable.
    const fp = makeFP(codeSnippet || '') || makeFP(anchorText || '');
    const old = list.find(e => e.fingerprint === fp);
    const toKeep = list.filter(e => e.fingerprint !== fp);
    for (const e of list) { if (!toKeep.includes(e)) this.removeDeco(e.tagKey); }

    const anchor: string = anchorText || (codeSnippet || '').split('\n')[0]?.trim() || '';
    const tagKey = `${filePath}::${fp}`;
    toKeep.push({
      fingerprint: fp, codeSnippet: codeSnippet || '', explanation,
      tagKey, anchorText: anchor,
      // Preserve existing Q&A when re-explaining the same code.
      qas: old?.qas || [],
      posLine: range.end.line, posCol: range.end.character,
      timing,
    });
    this.data.set(filePath, toKeep);
    this.addDeco(filePath, range.end.line, range.end.character, tagKey, anchor);
    this.refresh();
  }

  /** Whether the 💡 is currently rendered by the inlay-hint provider. */
  isInlayHintCarrier(): boolean {
    return this.useInlayHintCarrier;
  }

  /**
   * Switch the 💡 carrier. In `inlay-hint` mode the 💡 decorations are
   * dropped (the InlayHint provider renders the 💡 instead); switching back
   * re-creates them from the store. `data` is untouched either way, so no
   * explanation is lost on a switch.
   */
  setUseInlayHintCarrier(enabled: boolean): void {
    if (this.useInlayHintCarrier === enabled) return;
    this.useInlayHintCarrier = enabled;
    if (enabled) {
      for (const { deco } of this.decoMap.values()) deco.dispose();
      this.decoMap.clear();
    } else {
      for (const [filePath, exps] of this.data) {
        for (const exp of exps) {
          this.addDeco(filePath, exp.posLine, exp.posCol, exp.tagKey, exp.anchorText);
        }
      }
    }
    this.refresh();
  }

  private addDeco(filePath: string, line: number, col: number, tagKey: string, anchor: string): void {
    if (this.useInlayHintCarrier) return; // 💡 is rendered by the inlay-hint provider
    if (this.decoMap.has(tagKey)) {
      const entry = this.decoMap.get(tagKey)!;
      for (const ed of vscode.window.visibleTextEditors) {
        if (storageKey(ed.document.uri) === filePath) {
          this.applyDecoAt(ed, entry.deco, anchor, line, col);
        }
      }
      return;
    }
    const deco = vscode.window.createTextEditorDecorationType({
      after: { contentText: '💡', color: '#007acc' },
    });
    this.decoMap.set(tagKey, { deco, anchor, posLine: line, posCol: col });
    for (const ed of vscode.window.visibleTextEditors) {
      if (storageKey(ed.document.uri) === filePath) {
        this.applyDecoAt(ed, deco, anchor, line, col);
      }
    }
    this.refresh();
  }

  private applyDecoAt(editor: vscode.TextEditor, deco: vscode.TextEditorDecorationType, anchor: string, hintLine: number = -1, hintCol?: number): void {
    if (!anchor) return;
    // Try exact position first
    if (hintLine >= 0 && hintLine < editor.document.lineCount) {
      const lt = editor.document.lineAt(hintLine).text;
      const endCol = Math.min(hintCol || 0, lt.length);
      const beforeLen = Math.min(anchor.length, endCol);
      const textAtPos = lt.slice(endCol - beforeLen, endCol).trim();
      if (textAtPos && anchor.trim().endsWith(textAtPos)) {
        editor.setDecorations(deco, [new vscode.Range(hintLine, endCol, hintLine, endCol)]);
        return;
      }
    }
    // Search for anchor
    const full = editor.document.getText();
    const idx = full.indexOf(anchor);
    if (idx >= 0) {
      const pos = editor.document.positionAt(idx + anchor.length);
      editor.setDecorations(deco, [new vscode.Range(pos, pos)]);
    }
  }

  applyAllDecorations(editor: vscode.TextEditor): void {
    const edPath = storageKey(editor.document.uri);
    for (const [tagKey, entry] of this.decoMap) {
      if (tagKey.startsWith(edPath + '::')) {
        this.applyDecoAt(editor, entry.deco, entry.anchor, entry.posLine, entry.posCol);
      }
    }
  }

  private removeDeco(tagKey: string): void {
    const entry = this.decoMap.get(tagKey);
    if (entry) { entry.deco.dispose(); this.decoMap.delete(tagKey); }
  }

  getExplanation(uri: vscode.Uri, line: number, lineText?: string): AIExplanation | undefined {
    const key = storageKey(uri);
    // 1) Try exact file + paired files with content matching
    for (const checkKey of [key, ...getPairedPaths(key)]) {
      const list = this.data.get(checkKey);
      if (list && list.length > 0) {
        if (lineText) {
          const fp = makeFP(lineText);
          for (const exp of list) {
            // Prefer exact fingerprint equality over fuzzy containment to
            // avoid mismatching two explanations with the same first line.
            if (exp.fingerprint && (fp === exp.fingerprint || fp.includes(exp.fingerprint.slice(0, 30)) || exp.fingerprint.includes(fp.slice(0, 20)))) return exp;
          }
          // Multi-line selections: the hovered line is the END of the
          // selection while the stored fingerprint is from the FIRST line —
          // fall back to position matching.
          const byPos = list.find(e => e.posLine === line);
          if (byPos) return byPos;
        } else {
          // No line text (Q&A append/delete): prefer the explanation anchored
          // at this line, falling back to the first entry.
          const byPos = list.find(e => e.posLine === line);
          if (byPos) return byPos;
          return list[0];
        }
      }
    }
    return undefined;
  }

  async appendQuestion(uri: vscode.Uri, line: number, q: string, a: string): Promise<QAPair | undefined> {
    const exp = this.getExplanation(uri, line);
    if (!exp) return undefined;
    const pair: QAPair = { id: genPairId(), question: q, answer: a };
    exp.qas.push(pair); this.refresh(); await this.save(); return pair;
  }

  async removeQAPair(uri: vscode.Uri, line: number, id: string): Promise<void> {
    const exp = this.getExplanation(uri, line);
    if (!exp) return;
    exp.qas = exp.qas.filter(q => q.id !== id); this.refresh(); await this.save();
  }

  async removeExplanation(filePath: string, line: number, fingerprint?: string): Promise<void> {
    if (!fingerprint && line <= 0) {
      // Delete-all (right-click "删除全部"): remove the current file's
      // explanations AND their copies in paired files (same fingerprint) —
      // otherwise the copies stay reachable through the paired-path lookup
      // and the delete appears to do nothing. Entries unique to the paired
      // file (different fingerprint, e.g. notebook-only content) are kept.
      const list = this.data.get(filePath);
      if (list) {
        const fps = new Set(list.map(e => e.fingerprint));
        for (const e of list) this.removeDeco(e.tagKey);
        this.data.delete(filePath);
        for (const paired of getPairedPaths(filePath)) {
          const plist = this.data.get(paired);
          if (!plist) continue;
          const toRemove = plist.filter(e => e.fingerprint && fps.has(e.fingerprint));
          for (const e of toRemove) this.removeDeco(e.tagKey);
          const remaining = plist.filter(e => !toRemove.includes(e));
          if (remaining.length > 0) this.data.set(paired, remaining); else this.data.delete(paired);
        }
      }
      this.refresh(); await this.save();
      return;
    }
    // Single-entry delete (fingerprint or posLine): also clean the paired
    // copies of the same explanation.
    for (const fp of [filePath, ...getPairedPaths(filePath)]) {
      const list = this.data.get(fp);
      if (!list) continue;
      if (fingerprint) {
        // Hover delete: match by fingerprint. Multi-line selections store the
        // fingerprint of the FIRST line but the 💡 (and hover) sits on the
        // LAST line — when the fingerprint misses, fall back to posLine.
        let toRemove = list.filter(e => e.fingerprint === fingerprint);
        if (toRemove.length === 0) {
          toRemove = list.filter(e => e.posLine === line);
        }
        for (const e of toRemove) this.removeDeco(e.tagKey);
        const remaining = list.filter(e => !toRemove.includes(e));
        if (remaining.length > 0) this.data.set(fp, remaining); else this.data.delete(fp);
      } else {
        // Fallback: match by posLine
        const toRemove = list.filter(e => e.posLine === line);
        for (const e of toRemove) this.removeDeco(e.tagKey);
        const remaining = list.filter(e => e.posLine !== line);
        if (remaining.length > 0) this.data.set(fp, remaining); else this.data.delete(fp);
      }
    }
    this.refresh(); await this.save();
  }

  getAllExplanations(filePath: string): { snippet: string; explanation: string }[] {
    return (this.data.get(filePath) || []).map(e => ({ snippet: e.codeSnippet, explanation: e.explanation }));
  }

  /** Get explanations with position and snippet info for comment insertion */
  getExplanationsWithPositions(filePath: string): { explanation: string; snippet: string; posLine: number }[] {
    return (this.data.get(filePath) || []).map(e => ({ explanation: e.explanation, snippet: e.codeSnippet, posLine: e.posLine }));
  }

  /** Get ALL explanations across all stored files (with origin path). */
  getAllExplanationsGlobal(): { explanation: string; snippet: string; filePath: string }[] {
    const result: { explanation: string; snippet: string; filePath: string }[] = [];
    for (const [filePath, exps] of this.data) {
      for (const exp of exps) {
        result.push({ explanation: exp.explanation, snippet: exp.codeSnippet, filePath });
      }
    }
    return result;
  }

  /**
   * Move explanations from a renamed file to its new path, and update any
   * registered file pairs accordingly.
   *
   * Only the data keyed by `oldPath` itself is migrated — explanations stored
   * under paired paths (e.g. the old .ipynb) are left untouched, since that
   * file still exists on disk.
   */
  async renameExplanations(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;
    let changed = false;

    const exps = this.data.get(oldPath);
    if (exps && exps.length > 0) {
      for (const e of exps) this.removeDeco(e.tagKey);
      const migrated = exps.map(e => ({ ...e, tagKey: e.tagKey.replace(oldPath, newPath) }));
      const existing = this.data.get(newPath);
      this.data.set(newPath, existing ? existing.concat(migrated) : migrated);
      this.data.delete(oldPath);
      for (const e of migrated) this.addDeco(newPath, e.posLine, e.posCol, e.tagKey, e.anchorText);
      changed = true;
    }

    // Rewrite explicit pairs to point at the new path.
    const migratedPairs = new Map<string, Set<string>>();
    let pairsChanged = false;
    for (const [from, toSet] of filePairs) {
      const newFrom = from === oldPath ? newPath : from;
      const newTo = new Set<string>();
      for (const to of toSet) newTo.add(to === oldPath ? newPath : to);
      if (newTo.size > 0) migratedPairs.set(newFrom, newTo);
      pairsChanged = pairsChanged || newFrom !== from;
    }
    if (pairsChanged) {
      filePairs.clear();
      for (const [k, v] of migratedPairs) filePairs.set(k, v);
      changed = true;
    }

    if (changed) { this.refresh(); await this.save(); }
  }

  async copyExplanations(sourcePath: string, targetPath: string): Promise<void> {
    const src = this.data.get(sourcePath);
    if (!src || src.length === 0) return;
    const copies: AIExplanation[] = src.map(e => ({ ...e, tagKey: e.tagKey.replace(sourcePath, targetPath) }));
    this.data.set(targetPath, copies);
    for (const exp of copies) this.addDeco(targetPath, exp.posLine, exp.posCol, exp.tagKey, exp.anchorText);
    await this.save();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'file') return [];
    return [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0),
      { title: 'Open as Jupyter Notebook', command: 'code-learner.openAsNotebook' }
    )];
  }

  /**
   * Sync explanations with document content: hide explanations whose code
   * has been deleted, and restore them if the code comes back (undo).
   *
   * Called from the onDidChangeTextDocument handler in register.ts.
   * The 💡 decoration system already hides/shows based on anchor text
   * visibility; this additionally keeps a "deleted" cache so that
   * explanations survive a delete→undo round-trip in storage.
   */
  syncExplanationsWithDocument(document: vscode.TextDocument): void {
    // storageKey (not uri.toString()) so notebook-cell documents map to the
    // same .ipynb path the explanations are stored under — the decoration
    // path uses storageKey, and both must agree for notebook sync to work.
    const filePath = storageKey(document.uri);
    const fullText = document.getText();
    let changed = false;

    // Check active explanations
    const active = this.data.get(filePath);
    if (active && active.length > 0) {
      const stillValid: AIExplanation[] = [];
      const orphaned: AIExplanation[] = [];
      for (const exp of active) {
        if (fullText.includes(exp.anchorText)) {
          stillValid.push(exp);
        } else {
          orphaned.push(exp);
          this.removeDeco(exp.tagKey);
        }
      }
      if (orphaned.length > 0) {
        this.data.set(filePath, stillValid);
        const existing = this.deletedExplanations.get(filePath) || [];
        this.deletedExplanations.set(filePath, [...existing, ...orphaned]);
        changed = true;
      }
    }

    // Check deleted explanations for possible restore (undo)
    const deleted = this.deletedExplanations.get(filePath);
    if (deleted && deleted.length > 0) {
      const stillDeleted: AIExplanation[] = [];
      const restored: AIExplanation[] = [];
      for (const exp of deleted) {
        if (fullText.includes(exp.anchorText)) {
          restored.push(exp);
        } else {
          stillDeleted.push(exp);
        }
      }
      if (restored.length > 0) {
        if (!this.data.has(filePath)) this.data.set(filePath, []);
        const list = this.data.get(filePath)!;
        for (const exp of restored) {
          list.push(exp);
          this.addDeco(filePath, exp.posLine, exp.posCol, exp.tagKey, exp.anchorText);
        }
        if (stillDeleted.length > 0) {
          this.deletedExplanations.set(filePath, stillDeleted);
        } else {
          this.deletedExplanations.delete(filePath);
        }
        changed = true;
      }
    }

    // Persist so delete→undo state survives restarts.
    if (changed) { this.refresh(); void this.save(); }
  }

  async dispose(): Promise<void> {
    await this.save();
    for (const { deco } of this.decoMap.values()) deco.dispose();
    this.decoMap.clear();
  }
}
