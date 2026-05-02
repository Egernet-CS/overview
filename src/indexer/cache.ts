import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { FileDetail } from '../types.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function loadCachedDetail(
  outDir: string,
  relativePath: string,
): Promise<FileDetail | null> {
  try {
    const detailPath = join(outDir, relativePath + '.json');
    const raw = await readFile(detailPath, 'utf8');
    const detail = JSON.parse(raw) as FileDetail;
    if (detail.hash && detail.path) return detail;
    return null;
  } catch {
    return null;
  }
}

export function isCacheValid(cached: FileDetail, currentHash: string): boolean {
  return cached.hash === currentHash;
}
