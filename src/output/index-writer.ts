import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { OverviewIndex, FileDetail } from '../types.js';

export async function writeIndex(outDir: string, details: FileDetail[], llmName: string): Promise<void> {
  const index: OverviewIndex = {
    version: 1,
    generated: new Date().toISOString(),
    llm: llmName,
    files: details
      .filter(d => !d.error || d.description !== 'Analysis failed.')
      .map(d => ({ path: d.path, description: d.description }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index), 'utf8');
}
