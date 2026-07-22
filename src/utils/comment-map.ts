/**
 * Maps language IDs to their comment syntax.
 */

const commentMap: Record<string, string> = {
  // # comments
  python: '# ',
  ruby: '# ',
  shellscript: '# ',
  dockerfile: '# ',
  yaml: '# ',
  r: '# ',
  perl: '# ',
  coq: '# ',
  toml: '# ',
  makefile: '# ',
  'cuda-cpp': '// ',

  // // comments
  javascript: '// ',
  javascriptreact: '// ',
  typescript: '// ',
  typescriptreact: '// ',
  java: '// ',
  c: '// ',
  cpp: '// ',
  'c#': '// ',
  csharp: '// ',
  go: '// ',
  rust: '// ',
  swift: '// ',
  kotlin: '// ',
  scala: '// ',
  dart: '// ',
  groovy: '// ',
  lua: '-- ',
  sql: '-- ',
  php: '// ',
  haskell: '-- ',
  fsharp: '// ',
  'objective-c': '// ',
  'objective-cpp': '// ',
  glsl: '// ',
  hlsl: '// ',
  shaderlab: '// ',
  pascal: '// ',

  // -- comments
  lua2: '-- ',
  nix: '# ',

  // % comments
  latex: '% ',
  erlang: '% ',
  matlab: '% ',
  prolog: '% ',
  spice: '% ',

  // No comment char or specific
  plaintext: '',
  markdown: '',
  html: '<!-- ',
  xml: '<!-- ',
  css: '/* ',
  less: '// ',
  scss: '// ',
  stylus: '// ',
  json: '',
  jsonc: '// ',
  vue: '// ',
  svelte: '<!-- ',
  astro: '<!-- ',
};

/**
 * Get the comment prefix for a given language ID.
 * Falls back to '// ' for unknown languages.
 */
export function getCommentChar(languageId: string): string {
  return commentMap[languageId] || '// ';
}
