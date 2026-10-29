import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  MarkdownString: class {},
  env: { language: 'zh-cn' },
}));

import { latexToUnicode } from '../../ui/hover-content';

describe('latexToUnicode', () => {
  it('converts superscripts and subscripts', () => {
    expect(latexToUnicode('$x^2$ and $x_{i}$')).toBe('x² and xᵢ');
    expect(latexToUnicode('$O(n^{2})$')).toBe('O(n²)');
  });

  it('converts common symbols and Greek letters', () => {
    expect(latexToUnicode('$\\alpha + \\beta \\to \\infty$')).toBe('α + β → ∞');
    expect(latexToUnicode('$\\sqrt{n}$')).toBe('√(n)');
  });

  it('converts function names and fractions', () => {
    expect(latexToUnicode('$O(n \\log n)$')).toBe('O(n log n)');
    expect(latexToUnicode('$\\frac{1}{2}$')).toBe('(1)/(2)');
  });

  it('handles display math', () => {
    expect(latexToUnicode('$$\\sum_{i=1}^{n} i$$')).toBe('∑ᵢ₌₁ⁿ i');
  });

  it('keeps code blocks and inline code untouched', () => {
    expect(latexToUnicode('```\n$x^2$\n```')).toBe('```\n$x^2$\n```');
    expect(latexToUnicode('use `$x^2$` here')).toBe('use `$x^2$` here');
  });

  it('does not convert currency-looking prose', () => {
    expect(latexToUnicode('cost $5 and $10 today')).toBe('cost $5 and $10 today');
  });

  it('leaves unmappable math readable instead of garbage', () => {
    expect(latexToUnicode('$x^{c}$')).toBe('x^c');
    expect(latexToUnicode('$\\unknown{3}$')).toBe('unknown3');
  });

  it('converts the user-reported formula', () => {
    const formula = '\\text{out}_{i} \\sim \\mathcal{CN}(0, 1)';
    expect(latexToUnicode('$' + formula + '$')).toBe('outᵢ ∼ CN(0, 1)');
    expect(latexToUnicode(formula)).toBe('outᵢ ∼ CN(0, 1)');
  });

  it('supports bare LaTeX tokens without delimiters', () => {
    expect(latexToUnicode('noise \\sim \\mathcal{N}(0, 1) added')).toBe('noise ∼ N(0, 1) added');
    expect(latexToUnicode('\\frac{1}{2} of the data')).toBe('(1)/(2) of the data');
  });

  it('does not corrupt Windows paths with backslashes', () => {
    expect(latexToUnicode('path C:\\Users\\foo\\bar.py works')).toBe('path C:\\Users\\foo\\bar.py works');
  });

  it('supports \\(...\\) delimiters', () => {
    expect(latexToUnicode('\\(x^2 + y^2\\)')).toBe('x² + y²');
  });
});
