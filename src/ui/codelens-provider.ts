/**
 * AI explanations with persistent storage (survives VS Code restarts).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface QAPair { id: string; question: string; answer: string }

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
}

interface PersistedExp {
  fingerprint: string; codeSnippet: string; explanation: string;
  anchorText: string; qas: QAPair[]; posLine: number; posCol: number;
}

let pairIdCounter = 0;
function genPairId(): string { return 'qa_' + (++pairIdCounter); }

function makeFP(text: string): string {
  return text.split('\n')[0]?.trim().replace(/\s+/g, '').slice(0, 60).toLowerCase() || '';
}

function normalizePath(p: string): string {
  if (process.platform === 'win32') return p.replace(/\//g, '\\').replace(/\\$/, '');
  return p.replace(/\/$/, '');
}

function getStorageKey(uri: vscode.Uri): string {
  if (uri.scheme === 'file') return uri.fsPath;
  const decoded = decodeURIComponent(uri.path);
  let p = decoded.replace(/^\/([a-zA-Z]:\/)/, '$1').replace(/^\/([a-zA-Z]:)/, '$1');
  return normalizePath(p);
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

export function getPairedPaths(filePath: string): string[] {
  const result = new Set<string>();
  if (filePath.endsWith('.py')) {
    const nb = filePath.replace(/\.py$/, '.ipynb');
    try { fs.accessSync(nb); result.add(nb); } catch { /* no op */ }
  }
  if (filePath.endsWith('.ipynb')) {
    const py = filePath.replace(/\.ipynb$/, '.py');
    try { fs.accessSync(py); result.add(py); } catch { /* no op */ }
  }
  const explicit = filePairs.get(filePath);
  if (explicit) explicit.forEach(p => result.add(p));
  return Array.from(result);
}

// ── Persistence ──────────────────────────────────────────
let storagePath = '';

export function setStoragePath(p: string): void { storagePath = p; }

function getSavePath(): string {
  if (!storagePath) return '';
  return path.join(storagePath, 'code-learner-data.json');
}

export function loadPersistedData(): { data: Map<string, AIExplanation[]>; pairs: Map<string, Set<string>> } {
  const dataMap = new Map<string, AIExplanation[]>();
  const pairMap = new Map<string, Set<string>>();
  const savePath = getSavePath();
  if (!savePath) return { data: dataMap, pairs: pairMap };
  try {
    const raw = fs.readFileSync(savePath, 'utf-8');
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
  } catch { /* no saved data */ }
  return { data: dataMap, pairs: pairMap };
}

export class CodeLearnerCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  private data = new Map<string, AIExplanation[]>();
  private decoMap = new Map<string, { deco: vscode.TextEditorDecorationType; anchor: string; posLine: number; posCol: number }>();

  constructor() {
    const saved = loadPersistedData();
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

  private save(): void {
    const savePath = getSavePath();
    if (!savePath) return;
    try {
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const entries: { filePath: string; exps: PersistedExp[] }[] = [];
      for (const [filePath, exps] of this.data) {
        entries.push({
          filePath,
          exps: exps.map(e => ({
            fingerprint: e.fingerprint, codeSnippet: e.codeSnippet,
            explanation: e.explanation, anchorText: e.anchorText,
            qas: e.qas, posLine: e.posLine, posCol: e.posCol,
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
      fs.writeFileSync(savePath, JSON.stringify({ version: 1, explanations: entries, pairs }, null, 2), 'utf-8');
    } catch (e: any) { console.error('[Code Learner] Save failed:', e?.message); }
  }

  refresh(): void { this._onDidChange.fire(); }

  addExplanation(filePath: string, range: vscode.Range, explanation: string, anchorText?: string, codeSnippet?: string): void {
    this._store(filePath, range, explanation, anchorText, codeSnippet);
    for (const paired of getPairedPaths(filePath)) {
      if (paired !== filePath) this._store(paired, range, explanation, anchorText, codeSnippet);
    }
    this.save();
    if (pairsChanged) { pairsChanged = false; this.save(); }
  }

  private _store(filePath: string, range: vscode.Range, explanation: string, anchorText?: string, codeSnippet?: string): void {
    if (!this.data.has(filePath)) this.data.set(filePath, []);
    const list = this.data.get(filePath)!;
    const fp = makeFP(codeSnippet || '');
    const toKeep = list.filter(e => e.fingerprint !== fp);
    for (const old of list) { if (!toKeep.includes(old)) this.removeDeco(old.tagKey); }

    const anchor: string = anchorText || (codeSnippet || '').split('\n')[0]?.trim() || '';
    const tagKey = `${filePath}::${fp}`;
    toKeep.push({
      fingerprint: fp, codeSnippet: codeSnippet || '', explanation,
      tagKey, anchorText: anchor, qas: [],
      posLine: range.end.line, posCol: range.end.character,
    });
    this.data.set(filePath, toKeep);
    this.addDeco(filePath, range.end.line, range.end.character, tagKey, anchor);
    this.refresh();
  }

  private addDeco(filePath: string, line: number, col: number, tagKey: string, anchor: string): void {
    if (this.decoMap.has(tagKey)) {
      const entry = this.decoMap.get(tagKey)!;
      for (const ed of vscode.window.visibleTextEditors) {
        if (getStorageKey(ed.document.uri) === filePath) {
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
      if (getStorageKey(ed.document.uri) === filePath) {
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
    const edPath = getStorageKey(editor.document.uri);
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

  getExplanation(uri: vscode.Uri, _line: number, lineText?: string): AIExplanation | undefined {
    const key = getStorageKey(uri);
    // 1) Try exact file + paired files with content matching
    for (const checkKey of [key, ...getPairedPaths(key)]) {
      const list = this.data.get(checkKey);
      if (list && list.length > 0) {
        if (lineText) {
          const fp = makeFP(lineText);
          for (const exp of list) {
            if (exp.fingerprint && (fp.includes(exp.fingerprint.slice(0, 30)) || exp.fingerprint.includes(fp.slice(0, 20)))) return exp;
          }
        } else {
          return list[0];
        }
      }
    }
    return undefined;
  }

  appendQuestion(uri: vscode.Uri, line: number, q: string, a: string): QAPair | undefined {
    const exp = this.getExplanation(uri, line);
    if (!exp) return undefined;
    const pair: QAPair = { id: genPairId(), question: q, answer: a };
    exp.qas.push(pair); this.refresh(); this.save(); return pair;
  }

  removeQAPair(uri: vscode.Uri, line: number, id: string): void {
    const exp = this.getExplanation(uri, line);
    if (!exp) return;
    exp.qas = exp.qas.filter(q => q.id !== id); this.refresh(); this.save();
  }

  removeExplanation(filePath: string, _line: number): void {
    for (const fp of [filePath, ...getPairedPaths(filePath)]) {
      const list = this.data.get(fp);
      if (list) { for (const e of list) this.removeDeco(e.tagKey); this.data.delete(fp); }
    }
    this.refresh(); this.save();
  }

  getAllExplanations(filePath: string): { snippet: string; explanation: string }[] {
    return (this.data.get(filePath) || []).map(e => ({ snippet: e.codeSnippet, explanation: e.explanation }));
  }

  /** Get explanations with position and snippet info for comment insertion */
  getExplanationsWithPositions(filePath: string): { explanation: string; snippet: string; posLine: number }[] {
    return (this.data.get(filePath) || []).map(e => ({ explanation: e.explanation, snippet: e.codeSnippet, posLine: e.posLine }));
  }

  /** Get ALL explanations across all stored files */
  getAllExplanationsGlobal(): { explanation: string; snippet: string }[] {
    const result: { explanation: string; snippet: string }[] = [];
    for (const [_, exps] of this.data) {
      for (const exp of exps) {
        result.push({ explanation: exp.explanation, snippet: exp.codeSnippet });
      }
    }
    return result;
  }

  copyExplanations(sourcePath: string, targetPath: string): void {
    const src = this.data.get(sourcePath);
    if (!src || src.length === 0) return;
    const copies: AIExplanation[] = src.map(e => ({ ...e, tagKey: e.tagKey.replace(sourcePath, targetPath) }));
    this.data.set(targetPath, copies);
    for (const exp of copies) this.addDeco(targetPath, exp.posLine, exp.posCol, exp.tagKey, exp.anchorText);
    this.save();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'file') return [];
    return [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0),
      { title: 'Open as Jupyter Notebook', command: 'code-learner.openAsNotebook' }
    )];
  }

  dispose(): void {
    this.save();
    for (const { deco } of this.decoMap.values()) deco.dispose();
    this.decoMap.clear();
  }
}
