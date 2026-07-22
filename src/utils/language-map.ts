/**
 * Language utility - file extension to language ID mapping
 */

export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.py': 'python',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.php': 'php',
  '.r': 'r',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',
};

/**
 * Get language ID from file extension
 */
export function getLanguageFromExtension(fileName: string): string | undefined {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return undefined;

  const ext = fileName.slice(dotIndex).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext];
}
