import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { FileDetail } from '../types.js';

export async function writeFileDetail(outDir: string, detail: FileDetail): Promise<void> {
  const outputPath = join(outDir, detail.path + '.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(detail), 'utf8');
}
