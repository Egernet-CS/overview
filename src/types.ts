export interface OverviewConfig {
  anthropicApiKey: string;
  localLlmUrl: string;
  localLlmModel: string;
  localLlmApiKey: string;
  claudeModel: string;
  llmMode: 'claude' | 'local' | 'auto';
  concurrency: number;
  maxFileSizeBytes: number;
  maxCharsPerFile: number;
  retryAttempts: number;
  outDir: string;
  rootDir: string;
  excludePatterns: string[];
  incremental: boolean;
}

export interface FileSymbol {
  name: string;
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'const' | 'other';
  description: string;
  line?: number;
}

export interface FileDetail {
  path: string;
  description: string;
  symbols: FileSymbol[];
  imports: string[];
  hash: string;
  error?: string;
}

export interface IndexEntry {
  path: string;
  description: string;
}

export interface OverviewIndex {
  version: number;
  generated: string;
  llm: string;
  files: IndexEntry[];
}

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}

export interface LlmFileAnalysis {
  description: string;
  symbols: Array<{
    name: string;
    type: string;
    description: string;
    line?: number;
  }>;
}

export interface LlmClient {
  chat(systemPrompt: string, userMessage: string): Promise<string>;
  getModelName(): string;
}

export type ProcessingResult =
  | { status: 'ok'; detail: FileDetail }
  | { status: 'skipped'; path: string; reason: string }
  | { status: 'error'; path: string; error: string };
