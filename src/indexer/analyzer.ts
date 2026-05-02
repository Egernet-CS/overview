import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LlmClient, LlmFileAnalysis, FileDetail, FileSymbol, ScannedFile, ProcessingResult, OverviewConfig } from '../types.js';
import { truncateContent } from '../scanner/chunker.js';
import { extractImports } from '../scanner/importer.js';
import { hashContent } from './cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class FileAnalyzer {
  private promptTemplate: string = '';
  private systemPrompt: string = '';

  constructor(
    private client: LlmClient,
    private config: OverviewConfig,
  ) {}

  async init(): Promise<void> {
    this.promptTemplate = await readFile(
      join(__dirname, '../../prompts/analyze-file.md'),
      'utf8',
    );
    this.systemPrompt = this.promptTemplate;
  }

  async analyze(file: ScannedFile): Promise<ProcessingResult> {
    let content: string;
    try {
      content = await readFile(file.absolutePath, 'utf8');
    } catch (err) {
      return { status: 'error', path: file.relativePath, error: `Cannot read file: ${err instanceof Error ? err.message : String(err)}` };
    }

    const hash = hashContent(content);
    const truncated = truncateContent(content, this.config.maxCharsPerFile);
    const userMessage = `File: ${file.relativePath}\n---\n${truncated}`;

    let analysis: LlmFileAnalysis | null = null;
    let lastError = '';

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const raw = await this.client.chat(this.systemPrompt, userMessage);
        analysis = this.parseResponse(raw);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < this.config.retryAttempts) {
          const wait = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }

    const imports = extractImports(file.absolutePath, content, this.config.rootDir);

    if (!analysis) {
      const detail: FileDetail = {
        path: file.relativePath,
        description: 'Analysis failed.',
        symbols: [],
        imports,
        hash,
        error: lastError,
      };
      return { status: 'ok', detail };
    }

    const symbols: FileSymbol[] = analysis.symbols.map(s => ({
      name: s.name,
      type: this.normalizeType(s.type),
      description: s.description,
      ...(s.line !== undefined ? { line: s.line } : {}),
    }));

    const detail: FileDetail = {
      path: file.relativePath,
      description: analysis.description,
      symbols,
      imports,
      hash,
    };

    return { status: 'ok', detail };
  }

  private parseResponse(raw: string): LlmFileAnalysis {
    // Try direct parse first
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed) as LlmFileAnalysis;
    } catch { /* fall through */ }

    // Extract JSON object from response (handles markdown fences or extra prose)
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as LlmFileAnalysis;
      } catch { /* fall through */ }
    }

    throw new Error('Could not parse LLM response as JSON');
  }

  private normalizeType(raw: string): FileSymbol['type'] {
    const valid: FileSymbol['type'][] = ['function', 'class', 'method', 'interface', 'type', 'const', 'other'];
    const lower = raw.toLowerCase() as FileSymbol['type'];
    return valid.includes(lower) ? lower : 'other';
  }
}
