import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { homedir } from 'os';
import type { OverviewConfig } from './types.js';

export function loadConfig(overrides: Partial<OverviewConfig> = {}): OverviewConfig {
  loadEnv({ path: resolve(homedir(), '.overview', '.env') });
  loadEnv({ path: resolve(process.cwd(), '.env') });

  return {
    anthropicApiKey: overrides.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    localLlmUrl: overrides.localLlmUrl ?? process.env.LM_STUDIO_URL ?? 'http://localhost:1234/v1',
    localLlmModel: overrides.localLlmModel ?? process.env.LM_STUDIO_MODEL ?? '',
    localLlmApiKey: overrides.localLlmApiKey ?? process.env.LM_STUDIO_API_KEY ?? 'lm-studio',
    claudeModel: overrides.claudeModel ?? process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001',
    llmMode: overrides.llmMode ?? (process.env.OVERVIEW_LLM_MODE as OverviewConfig['llmMode']) ?? 'auto',
    concurrency: overrides.concurrency ?? parseInt(process.env.OVERVIEW_CONCURRENCY ?? '3', 10),
    maxFileSizeBytes: overrides.maxFileSizeBytes ?? parseInt(process.env.OVERVIEW_MAX_FILE_SIZE ?? '50000', 10),
    maxCharsPerFile: overrides.maxCharsPerFile ?? parseInt(process.env.OVERVIEW_MAX_CHARS_PER_FILE ?? '12000', 10),
    retryAttempts: overrides.retryAttempts ?? parseInt(process.env.OVERVIEW_RETRY_ATTEMPTS ?? '2', 10),
    outDir: overrides.outDir ?? process.env.OVERVIEW_OUT_DIR ?? '.overview',
    rootDir: overrides.rootDir ?? process.cwd(),
    excludePatterns: overrides.excludePatterns ?? [],
    incremental: overrides.incremental ?? false,
  };
}
