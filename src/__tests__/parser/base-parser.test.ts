import { describe, it, expect } from 'vitest';
import { GenericParser } from '../../parser/generic-parser';
import { PythonParser } from '../../parser/python-parser';
import { CellType } from '../../parser/cell';

describe('BaseParser.parseLines', () => {
  const generic = new GenericParser('test');
  const python = new PythonParser();

  it('no splits produces a single cell covering all lines', () => {
    const lines = ['x = 1', 'y = 2', 'z = 3'];
    const cells = generic.parseLines(lines, 'test');
    expect(cells.length).toBe(1);
    expect(cells[0].startLine).toBe(0);
    expect(cells[0].endLine).toBe(2);
    expect(cells[0].source).toBe('x = 1\ny = 2\nz = 3');
  });

  it('manual markers produce separate cells', () => {
    // Use mode: 'manual' so only # %% is detected.
    // The marker line (# %%) is included at the start of the next cell.
    const lines = ['x = 1', '# %%', 'y = 2'];
    const cells = generic.parseLines(lines, 'test', { mode: 'manual' });
    expect(cells.length).toBe(2);
    expect(cells[0].source).toBe('x = 1');
    expect(cells[1].source).toContain('y = 2');
    // Marker line is preserved in the subsequent cell
    expect(cells[1].source).toContain('# %%');
  });

  it('split points produce cells with correct ranges (Python)', () => {
    const lines = [
      'import os',
      '',
      'def foo():',
      '    pass',
      '',
      'def bar():',
      '    pass',
    ];
    const cells = python.parseLines(lines, 'python');
    // Should detect import at 0 and function defs
    expect(cells.length).toBeGreaterThanOrEqual(2);
    // First cell should be imports
    expect(cells[0].type).toBe(CellType.IMPORT);
  });

  it('classifies FUNCTION cells correctly (Python)', () => {
    const lines = ['def my_function():', '    pass'];
    const cells = generic.parseLines(lines, 'python');
    expect(cells.length).toBe(1);
    expect(cells[0].type).toBe(CellType.FUNCTION);
  });

  it('classifies IMPORT cells correctly (Python)', () => {
    const lines = ['import os', 'import sys'];
    const cells = generic.parseLines(lines, 'python');
    expect(cells.length).toBe(1);
    expect(cells[0].type).toBe(CellType.IMPORT);
  });

  it('classifies CLASS cells correctly (Python)', () => {
    const lines = ['class MyClass:', '    pass'];
    const cells = generic.parseLines(lines, 'python');
    expect(cells.length).toBe(1);
    expect(cells[0].type).toBe(CellType.CLASS);
  });

  it('classifies CODE cells for plain assignments', () => {
    const lines = ['x = 1', 'y = 2'];
    const cells = generic.parseLines(lines, 'python');
    expect(cells.length).toBe(1);
    expect(cells[0].type).toBe(CellType.CODE);
  });

  it('handles auto + manual mode together (Python)', () => {
    const lines = [
      'import os',
      '',
      '# %%',
      'def foo():',
      '    pass',
      '',
      'def bar():',
      '    pass',
    ];
    const cells = python.parseLines(lines, 'python', { mode: 'both' });
    // mode='both' uses manual markers first; if found, auto is skipped.
    // # %% at line 2 creates a split, giving 2 cells.
    expect(cells.length).toBe(2);
    // First cell is imports
    expect(cells[0].type).toBe(CellType.IMPORT);
  });
});
