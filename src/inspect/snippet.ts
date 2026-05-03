import { readFile } from 'fs/promises';

export interface FileSnippet {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

export async function buildSnippet(
  absolutePath: string,
  relativePath: string,
  opts: { focusLine?: number | null; query?: string; context?: number } = {},
): Promise<FileSnippet | null> {
  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/);
  const context = opts.context ?? 8;

  let focusLine = opts.focusLine ?? null;
  if (!focusLine && opts.query) {
    const normalized = opts.query.toLowerCase();
    const found = lines.findIndex((line) => line.toLowerCase().includes(normalized));
    if (found !== -1) {
      focusLine = found + 1;
    }
  }

  if (!focusLine) {
    focusLine = 1;
  }

  const startLine = Math.max(1, focusLine - context);
  const endLine = Math.min(lines.length, focusLine + context);
  const content = lines.slice(startLine - 1, endLine).join('\n');

  return {
    path: relativePath,
    startLine,
    endLine,
    content,
  };
}
