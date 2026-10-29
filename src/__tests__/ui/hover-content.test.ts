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

  it('converts \\operatorname and mixed bare formulas', () => {
    const text = 'This is equivalent to separately sampling the real (\\operatorname{Re}) and imaginary (\\operatorname{Im}) part of \\text{out}_i as';
    expect(latexToUnicode(text)).toBe('This is equivalent to separately sampling the real (Re) and imaginary (Im) part of outᵢ as');
  });

  it('converts RST :math: roles and drops the wrapper', () => {
    const text = 'This is equivalent to separately sampling the real :math:`(\\operatorname{Re})` and imaginary\n    :math:`(\\operatorname{Im})` part of :math:`\\text{out}_i` as';
    expect(latexToUnicode(text)).toBe(
      'This is equivalent to separately sampling the real (Re) and imaginary\n    (Im) part of outᵢ as'
    );
  });

  it('does not convert :math: inside fenced code blocks', () => {
    expect(latexToUnicode('```\n:math:`x^2`\n```')).toBe('```\n:math:`x^2`\n```');
  });

  it('converts torch-style docstring math with \\operatorname and \\quad', () => {
    const math = '\\operatorname{Re}(\\text{out}_{i}) \\sim \\mathcal{N}(0, \\frac{1}{2}),\\quad\\operatorname{Im}(\\text{out}_{i}) \\sim \\mathcal{N}(0, \\frac{1}{2})';
    expect(latexToUnicode(math)).toBe('Re(outᵢ) ∼ N(0, (1)/(2)), Im(outᵢ) ∼ N(0, (1)/(2))');
  });

  it('converts backtick-wrapped math restored from placeholders', () => {
    const text = '这等价于分别对 `\\text{out}_i` 的实部 `(\\operatorname{Re})` 和虚部 `(\\operatorname{Im})` 进行采样，即';
    expect(latexToUnicode(text)).toBe('这等价于分别对 outᵢ 的实部 (Re) 和虚部 (Im) 进行采样，即');
  });

  it('still protects non-math backtick spans', () => {
    expect(latexToUnicode('use `C:\\Users\\foo\\bar.py` here')).toBe('use `C:\\Users\\foo\\bar.py` here');
    expect(latexToUnicode('call `torch.randn(size)` here')).toBe('call `torch.randn(size)` here');
  });
});
