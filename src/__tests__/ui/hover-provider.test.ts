import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: class { static file(p: string) { return { fsPath: p, toString: () => p }; } },
  Position: class {},
  Range: class {},
  EventEmitter: class {
    event = () => ({ dispose: () => { /* noop */ } });
    fire = () => { /* noop */ };
  },
  MarkdownString: class {},
  Hover: class {},
  window: {
    createTextEditorDecorationType: () => ({ dispose: () => { /* noop */ } }),
    visibleTextEditors: [],
  },
  env: { language: 'zh-cn' },
  commands: { executeCommand: vi.fn() },
  languages: {},
}));

import { sanitizeAiContent } from '../../ui/hover-provider';

describe('sanitizeAiContent', () => {
  it('escapes real command: URIs', () => {
    expect(sanitizeAiContent('click [here](command:code-learner.foo)')).toContain('command\\:');
  });

  it('escapes file: links', () => {
    expect(sanitizeAiContent('see file:c:/x.txt')).toContain('file\\:');
  });

  it('does not corrupt identifiers containing scheme substrings (regression: validation_data:)', () => {
    expect(sanitizeAiContent('(parameter) validation_data: Any | None')).toBe('(parameter) validation_data: Any | None');
  });

  it('still escapes a real data: URI at a word boundary', () => {
    expect(sanitizeAiContent('image data:image/png;base64,xxx')).toContain('data\\:');
  });
});
