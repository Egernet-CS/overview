import { readdir, stat, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { createRequire } from 'module';
import type { ScannedFile } from '../types.js';
import { isBinaryFile } from './filter.js';

// ignore is a CommonJS package; use createRequire for reliable ESM interop
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ignore: () => { add(p: string | string[]): { add(p: string | string[]): unknown; ignores(p: string): boolean }; ignores(p: string): boolean } = require('ignore');

const ALWAYS_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.build',
  'Pods',
  'DerivedData',
  '.overview',
  '*.tsbuildinfo',
  '*.xcarchive',
  '.DS_Store',
];

type IgnoreInstance = { add(p: string | string[]): IgnoreInstance; ignores(p: string): boolean };

async function loadGitignore(dir: string): Promise<IgnoreInstance> {
  const ig = ignore().add(ALWAYS_IGNORE) as IgnoreInstance;

  try {
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    ig.add(content);
  } catch {
    // No .gitignore
  }

  return ig;
}

export async function walkFiles(
  rootDir: string,
  extraExcludes: string[] = [],
): Promise<ScannedFile[]> {
  const ig = await loadGitignore(rootDir);
  if (extraExcludes.length > 0) ig.add(extraExcludes);

  const results: ScannedFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      const absolutePath = join(dir, name);
      const relativePath = relative(rootDir, absolutePath);

      if (ig.ignores(relativePath)) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        if (await isBinaryFile(absolutePath)) continue;

        try {
          const info = await stat(absolutePath);
          results.push({ absolutePath, relativePath, sizeBytes: info.size });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(rootDir);
  return results;
}
