import { resolve, dirname, relative } from 'path';

export function extractImports(filePath: string, content: string, rootDir: string): string[] {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') {
    return extractJsImports(filePath, content, rootDir);
  }

  if (ext === 'py') {
    return extractPythonImports(content);
  }

  if (ext === 'swift') {
    return extractSwiftImports(content);
  }

  return [];
}

function extractJsImports(filePath: string, content: string, rootDir: string): string[] {
  const patterns = [
    /from\s+['"](\.[^'"]+)['"]/g,
    /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];

  const results = new Set<string>();
  const fileDir = dirname(filePath);

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1];
      const resolved = resolve(fileDir, importPath);
      const rel = relative(rootDir, resolved);
      if (!rel.startsWith('..')) {
        // Normalize: strip .js extension added for ESM, prefer .ts
        const normalized = rel.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
        results.add(normalized);
      }
    }
  }

  return [...results];
}

function extractPythonImports(content: string): string[] {
  const results = new Set<string>();
  const fromPattern = /^from\s+(\.+[\w.]*)\s+import/gm;
  const importPattern = /^import\s+([\w.]+)/gm;

  let match: RegExpExecArray | null;
  while ((match = fromPattern.exec(content)) !== null) {
    results.add(match[1]);
  }
  while ((match = importPattern.exec(content)) !== null) {
    results.add(match[1]);
  }

  return [...results];
}

function extractSwiftImports(content: string): string[] {
  const results = new Set<string>();
  const pattern = /^import\s+(\w+)/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    results.add(match[1]);
  }

  return [...results];
}
