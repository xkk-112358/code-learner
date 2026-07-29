/**
 * Bidirectional code sync between .py and .ipynb files.
 * Rebuilds cell mappings after each sync to keep positions correct.
 */

import * as vscode from 'vscode';

export interface CellMapping {
  cellIndex: number; pyStartLine: number; pyEndLine: number; originalSource: string;
}

/** Minimal structure for notebook JSON used in sync operations. */
interface NotebookJson {
  metadata?: {
    codeLearner?: {
      cellMapping?: Array<{ cellIndex: number; pyStartLine: number; pyEndLine: number }>;
    };
  };
  cells?: Array<{ source: string[]; cell_type: string }>;
}

/**
 * Build cell mappings by matching notebook cell content to .py source.
 */
export function buildCellMapping(
  pySource: string,
  notebookCells: { source: string[]; cell_type: string }[]
): CellMapping[] {
  const pyLines = pySource.split('\n');
  const mappings: CellMapping[] = [];
  const usedLines = new Set<number>();

  for (let ci = 0; ci < notebookCells.length; ci++) {
    const cell = notebookCells[ci];
    if (cell.cell_type !== 'code') continue;
    const cellSrc = (cell.source || []).join('').trim();
    if (!cellSrc) continue;
    const cellLines = cellSrc.split('\n');
    const firstSigLine = cellLines.find(l => l.trim())?.trim() || '';
    if (!firstSigLine) continue;

    let matchLine = -1;
    for (let pl = 0; pl < pyLines.length; pl++) {
      if (usedLines.has(pl)) continue;
      if (pyLines[pl].trim() === firstSigLine) { matchLine = pl; break; }
    }
    if (matchLine < 0) continue;

    let endLine = matchLine;
    let cellIdx = 0;
    for (let pl = matchLine; pl < pyLines.length && cellIdx < cellLines.length; pl++) {
      if (pyLines[pl].trim() === cellLines[cellIdx].trim()) {
        usedLines.add(pl); endLine = pl; cellIdx++;
      } else break;
    }
    mappings.push({ cellIndex: ci, pyStartLine: matchLine, pyEndLine: endLine, originalSource: cellSrc });
  }
  return mappings;
}

export function storeCellMapping(nbJson: NotebookJson, mappings: CellMapping[]): void {
  if (!nbJson.metadata) nbJson.metadata = {};
  if (!nbJson.metadata.codeLearner) nbJson.metadata.codeLearner = {};
  nbJson.metadata.codeLearner.cellMapping = mappings.map(m => ({
    cellIndex: m.cellIndex, pyStartLine: m.pyStartLine, pyEndLine: m.pyEndLine,
  }));
}

export function readCellMapping(nbJson: NotebookJson): { cellIndex: number; pyStartLine: number; pyEndLine: number }[] {
  return nbJson?.metadata?.codeLearner?.cellMapping || [];
}

// ── Notebook → Source sync ──────────────────────────────

/**
 * Sync notebook cell change to .py file, then rebuild mapping.
 * Returns the updated mapping or null if sync failed.
 */
export async function syncNotebookToSource(
  pyFilePath: string,
  cellIndex: number,
  newCellSource: string,
  nbJson: NotebookJson,
  nbFilePath?: string  // notebook file path for saving mapping
): Promise<boolean> {
  const mappings = readCellMapping(nbJson);
  const mapping = mappings.find(m => m.cellIndex === cellIndex);
  if (!mapping) return false;

  try {
    const pyUri = vscode.Uri.file(pyFilePath);
    const doc = await vscode.workspace.openTextDocument(pyUri);

    const oldLineCount = doc.lineCount;
    const startLine = Math.min(mapping.pyStartLine, oldLineCount - 1);
    const endLine = Math.min(mapping.pyEndLine, oldLineCount - 1);
    const range = new vscode.Range(startLine, 0, endLine + 1, 0);
    const newText = newCellSource.endsWith('\n') ? newCellSource : newCellSource + '\n';
    const edit = new vscode.WorkspaceEdit();
    edit.replace(pyUri, range, newText);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) return false;

    await doc.save();

    // Rebuild mapping after sync (line numbers may have shifted)
    const newPySource = doc.getText();
    const newMappings = buildCellMapping(newPySource, nbJson.cells || []);
    if (newMappings.length > 0) {
      storeCellMapping(nbJson, newMappings);
      // Save updated mapping to notebook file
      if (nbFilePath) {
        try {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(nbFilePath),
            new TextEncoder().encode(JSON.stringify(nbJson, null, 2))
          );
        } catch { /* mapping save failed */ }
      }
    }
    return true;
  } catch { return false; }
}

// ── Source → Notebook sync ──────────────────────────────

export async function syncSourceToNotebook(
  oldPySource: string, newPySource: string,
  notebookCells: { source: string[]; cell_type: string }[],
  mappings: { cellIndex: number; pyStartLine: number; pyEndLine: number }[]
): Promise<{ cellIndex: number; newSource: string }[]> {
  const oldLines = oldPySource.split('\n');
  const newLines = newPySource.split('\n');
  const updates: { cellIndex: number; newSource: string }[] = [];

  for (const m of mappings) {
    const oldText = oldLines.slice(m.pyStartLine, m.pyEndLine + 1).join('\n');
    const newText = newLines.slice(m.pyStartLine, m.pyEndLine + 1).join('\n');
    if (oldText !== newText) {
      // Check if this is the only mapping affected
      const overlap = mappings.filter(
        o => m.cellIndex !== o.cellIndex &&
        m.pyStartLine <= o.pyEndLine && m.pyEndLine >= o.pyStartLine
      );
      if (overlap.length === 0) {
        updates.push({ cellIndex: m.cellIndex, newSource: newText });
      }
    }
  }
  return updates;
}
