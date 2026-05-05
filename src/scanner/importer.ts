import { existsSync, readdirSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';

const kotlinSourceRootsByRootDir = new Map<string, string[]>();

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

  if (ext === 'kt' || ext === 'kts') {
    return extractKotlinImports(filePath, content, rootDir);
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

function extractKotlinImports(filePath: string, content: string, rootDir: string): string[] {
  const results = new Set<string>();
  const sourceRoots = findKotlinSourceRoots(filePath, rootDir);
  const pattern = /^import\s+([A-Za-z_][\w.]*(?:\.\*)?)(?:\s+as\s+\w+)?/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const rawImport = match[1].replace(/\.\*$/, '');
    if (!rawImport || rawImport.startsWith('kotlin.') || rawImport.startsWith('kotlinx.') || rawImport.startsWith('java.')) {
      continue;
    }

    const resolved = resolveKotlinImport(sourceRoots, rawImport, rootDir);
    results.add(resolved ?? rawImport);
  }

  return [...results];
}

function findKotlinSourceRoots(filePath: string, rootDir: string): string[] {
  const roots = new Set<string>();
  const localRoot = findLocalKotlinSourceRoot(filePath);
  if (localRoot) roots.add(localRoot);

  for (const sourceRoot of findRepoKotlinSourceRoots(rootDir)) {
    roots.add(sourceRoot);
  }

  return [...roots];
}

function findRepoKotlinSourceRoots(rootDir: string): string[] {
  const cached = kotlinSourceRootsByRootDir.get(rootDir);
  if (cached) return cached;

  const roots: string[] = [];
  for (const dir of safeReadDir(rootDir)) {
    for (const sourceSet of [
      'commonMain',
      'commonTest',
      'iosMain',
      'iosTest',
      'androidMain',
      'androidUnitTest',
      'androidInstrumentedTest',
      'jvmMain',
      'jvmTest',
      'main',
      'test',
    ]) {
      for (const languageDir of ['kotlin', 'java']) {
        const candidate = join(rootDir, dir, 'src', sourceSet, languageDir);
        if (existsSync(candidate)) roots.push(candidate);
      }
    }
  }

  kotlinSourceRootsByRootDir.set(rootDir, roots);
  return roots;
}

function findLocalKotlinSourceRoot(filePath: string): string | null {
  const normalized = filePath.split('\\').join('/');
  const kotlinIndex = normalized.lastIndexOf('/kotlin/');
  if (kotlinIndex !== -1) {
    return filePath.slice(0, kotlinIndex + '/kotlin'.length);
  }

  const javaIndex = normalized.lastIndexOf('/java/');
  if (javaIndex !== -1) {
    return filePath.slice(0, javaIndex + '/java'.length);
  }

  return null;
}

function resolveKotlinImport(sourceRoots: string[], importPath: string, rootDir: string): string | null {
  const parts = importPath.split('.');

  for (const sourceRoot of sourceRoots) {
    for (let end = parts.length; end > 0; end--) {
      const candidate = join(sourceRoot, ...parts.slice(0, end)) + '.kt';
      if (!existsSync(candidate)) continue;

      const rel = relative(rootDir, candidate);
      return rel.startsWith('..') ? null : rel;
    }
  }

  return null;
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
