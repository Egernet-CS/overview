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
  force: boolean;
}

export interface FileSymbol {
  name: string;
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'const' | 'other';
  description: string;
  line?: number;
}

export interface FileDetail {
  path: string;
  module: string;
  layer: string;
  kind: string;
  description: string;
  tags: string[];
  symbols: FileSymbol[];
  imports: string[];
  hash: string;
  error?: string;
}

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}

export interface LlmFileAnalysis {
  description: string;
  module?: string;
  layer?: string;
  kind?: string;
  tags?: string[];
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
