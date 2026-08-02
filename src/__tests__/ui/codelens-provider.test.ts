import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class Uri {
    scheme = 'file';
    fsPath: string;
    path: string;
    constructor(p: string) {
      this.fsPath = p;
      this.path = p;
    }
    toString(): string { return this.fsPath; }
    static file(p: string): Uri { return new Uri(p); }
  }
  class Position {
    constructor(public line: number, public character: number) {}
  }
  class Range {
    constructor(public start: Position, public end: Position) {}
  }
  class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    event = (cb: (e: T) => void): { dispose: () => void } => {
      this.listeners.push(cb);
      return { dispose: () => { /* noop */ } };
    };
    fire(e: T): void {
      for (const l of this.listeners) l(e);
    }
  }
  return {
    Uri,
    Position,
    Range,
    EventEmitter,
    window: {
      createTextEditorDecorationType: () => ({ dispose: () => { /* noop */ } }),
      visibleTextEditors: [],
    },
  };
});

import * as vscode from 'vscode';
import { CodeLearnerCodeLensProvider, registerFilePair } from '../../ui/codelens-provider';

function uri(p: string): vscode.Uri { return vscode.Uri.file(p); }
function range(line: number): vscode.Range {
  return new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 10));
}

describe('CodeLearnerCodeLensProvider', () => {
  let provider: CodeLearnerCodeLensProvider;

  beforeEach(() => {
    provider = new CodeLearnerCodeLensProvider();
  });

  it('stores and retrieves an explanation', async () => {
    await provider.addExplanation('/a.py', range(3), 'explanation', 'anchor', 'def foo():');
    const exp = provider.getExplanation(uri('/a.py'), 3);
    expect(exp?.explanation).toBe('explanation');
  });

  it('deletes by fingerprint (single-line selection)', async () => {
    await provider.addExplanation('/a.py', range(3), 'expl', 'def foo():', 'def foo():');
    await provider.removeExplanation('/a.py', 3, 'deffoo():');
    expect(provider.getExplanation(uri('/a.py'), 3)).toBeUndefined();
  });

  it('falls back to posLine when the fingerprint misses (multi-line selection) — regression', async () => {
    // Stored fingerprint comes from the FIRST line of the snippet, but the 💡
    // (and hover/delete) sits on the LAST line of the selection.
    await provider.addExplanation('/a.py', range(3), 'expl', '    return x', 'def foo():\n    return x');
    await provider.removeExplanation('/a.py', 3, 'returnx'); // fingerprint of the hovered (last) line
    expect(provider.getExplanation(uri('/a.py'), 3)).toBeUndefined();
  });

  it('delete-all removes the current file AND same-fingerprint paired copies', async () => {
    registerFilePair('/a.py', '/a.ipynb');
    await provider.addExplanation('/a.py', range(1), 'py expl', 'x', 'code1');
    await provider.appendQuestion(uri('/a.py'), 1, 'why?', 'because');
    await provider.removeExplanation('/a.py', 0);
    // The .py entry, its .ipynb copy and the Q&A are all gone — no stale
    // copies remain reachable through the paired-path lookup.
    expect(provider.getExplanation(uri('/a.py'), 1)).toBeUndefined();
    expect(provider.getExplanation(uri('/a.ipynb'), 1)).toBeUndefined();
  });

  it('preserves Q&A when re-explaining the same code', async () => {
    await provider.addExplanation('/a.py', range(1), 'first', 'x', 'code');
    await provider.appendQuestion(uri('/a.py'), 1, 'why?', 'because');
    await provider.addExplanation('/a.py', range(1), 'second', 'x', 'code');
    const exp = provider.getExplanation(uri('/a.py'), 1);
    expect(exp?.explanation).toBe('second');
    expect(exp?.qas).toHaveLength(1);
    expect(exp?.qas[0].question).toBe('why?');
  });
});
