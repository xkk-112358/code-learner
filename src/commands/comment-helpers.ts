/**
 * Shared helpers for comment conversion commands.
 * Extracted to eliminate the three-way duplication of explanation-to-comment formatting.
 */

const MAX_COMMENT_WIDTH = 78;

/**
 * Word-wrap a line of text at the given max width.
 * Returns an array of wrapped lines (each already trimmed).
 */
export function wrapText(text: string, maxWidth: number = MAX_COMMENT_WIDTH): string[] {
  if (!text || text.length <= maxWidth) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxWidth) {
      lines.push(remaining.trim());
      break;
    }
    let breakPos = remaining.lastIndexOf(' ', maxWidth);
    if (breakPos <= 0) {
      breakPos = maxWidth;
    }
    lines.push(remaining.slice(0, breakPos).trim());
    remaining = remaining.slice(breakPos).trim();
  }
  return lines;
}

/**
 * Build a comment block from an AI explanation, using the given comment prefix.
 * Long lines are word-wrapped at 78 characters for readability.
 */
export function hasExistingComment(explanation: string, linesBelow: string[]): boolean {
  if (!explanation || linesBelow.length === 0) return false;
  const fp = explanation.replace(/[#*`]/g, '').replace(/\s+/g, '').slice(0, 30).toLowerCase();
  if (!fp || fp.length < 10) return false;
  return linesBelow.some(l => {
    const cleaned = l.replace(/^[#\s/]+/, '').replace(/[`*]/g, '').replace(/\s+/g, '').toLowerCase();
    return cleaned.includes(fp);
  });
}

export function buildCommentBlock(explanation: string, commentChar: string): string[] {
  const result: string[] = [];
  for (const rawLine of explanation.split('\n')) {
    const t = rawLine.trim();
    if (!t) { result.push(''); continue; }
    const c = t.replace(/^###?\s*/g, '').replace(/\*\*/g, '').replace(/^---.*$/g, '');
    if (c.startsWith('```') || c.startsWith('---') || c.startsWith('[') || c.startsWith('![')) continue;
    const wrapped = wrapText(c, MAX_COMMENT_WIDTH);
    for (const wl of wrapped) {
      result.push(commentChar + wl);
    }
  }
  return result.filter(l => l.trim() !== commentChar.trim());
}

/**
 * Simple deduplication by explanation content.
 */
export function deduplicateExplanations<T extends { explanation: string }>(exps: T[]): T[] {
  const seen = new Set<string>();
  return exps.filter(e => {
    if (!e.explanation || seen.has(e.explanation)) return false;
    seen.add(e.explanation);
    return true;
  });
}

/**
 * Build a code fingerprint from snippet for line matching.
 */
export function makeCodeFingerprint(snippet: string): string {
  return (snippet || '').split('\n')[0]?.trim().replace(/\s+/g, '').slice(0, 40).toLowerCase() || '';
}

/**
 * Try to find which line in docLines matches the given code fingerprint.
 * With `hintLine`, the line where the explanation was recorded is checked
 * first (then the scan continues forward), so duplicate lines elsewhere in
 * the file don't hijack the match. Falls back to a full scan.
 * Returns the line index, or -1 if no match.
 */
export function findMatchingLine(codeFP: string, docLines: string[], hintLine?: number): number {
  if (!codeFP) return -1;
  const matchAt = (l: number): boolean => {
    const lf = docLines[l].trim().replace(/\s+/g, '').slice(0, 40).toLowerCase();
    return !!lf && (lf.includes(codeFP) || codeFP.includes(lf));
  };
  if (hintLine !== undefined && hintLine >= 0 && hintLine < docLines.length) {
    for (let l = hintLine; l < docLines.length; l++) {
      if (matchAt(l)) return l;
    }
  }
  for (let l = 0; l < docLines.length; l++) {
    if (matchAt(l)) return l;
  }
  return -1;
}
