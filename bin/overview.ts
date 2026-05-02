#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import { loadConfig } from '../src/config.js';
import { ClaudeClient } from '../src/llm/claude.js';
import { LocalClient } from '../src/llm/local.js';
import { checkLocalLlmHealth } from '../src/llm/health.js';
import { walkFiles } from '../src/scanner/walker.js';
import { FileAnalyzer } from '../src/indexer/analyzer.js';
import { Semaphore } from '../src/indexer/concurrency.js';
import { loadCachedDetail, isCacheValid, hashContent } from '../src/indexer/cache.js';
import { writeFileDetail } from '../src/output/file-writer.js';
import { writeIndex } from '../src/output/index-writer.js';
import type { LlmClient, FileDetail, OverviewConfig } from '../src/types.js';

const program = new Command();

program
  .name('overview')
  .description('Generate a per-file code index for AI agents')
  .version('0.1.0');

program
  .command('index', { isDefault: true })
  .description('Scan a directory and generate .overview/ index files')
  .option('--dir <path>', 'Directory to scan (default: cwd)')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .option('--llm <mode>', 'LLM to use: claude|local|auto (default: auto)')
  .option('--concurrency <n>', 'Parallel LLM calls', parseInt)
  .option('--incremental', 'Skip files whose content has not changed')
  .option('--model <model>', 'Claude model override')
  .option('--local-url <url>', 'Local LLM server URL override')
  .option('--local-model <model>', 'Local LLM model name override')
  .option('--exclude <pattern>', 'Extra glob patterns to exclude (repeatable)', collect, [])
  .action(async (opts: {
    dir?: string;
    out?: string;
    llm?: string;
    concurrency?: number;
    incremental?: boolean;
    model?: string;
    localUrl?: string;
    localModel?: string;
    exclude: string[];
  }) => {
    const config = loadConfig({
      rootDir: opts.dir ? resolve(opts.dir) : undefined,
      outDir: opts.out,
      llmMode: opts.llm as OverviewConfig['llmMode'],
      concurrency: opts.concurrency,
      incremental: opts.incremental,
      claudeModel: opts.model,
      localLlmUrl: opts.localUrl,
      localLlmModel: opts.localModel,
      excludePatterns: opts.exclude,
    });

    const outDir = resolve(config.rootDir, config.outDir);

    // Resolve LLM
    const llmClient = await resolveLlm(config);

    console.error(chalk.cyan(`  Scanning ${config.rootDir}`));
    console.error(chalk.gray(`  LLM: ${llmClient.getModelName()} | concurrency: ${config.concurrency} | out: ${config.outDir}`));

    // Walk files
    const files = await walkFiles(config.rootDir, config.excludePatterns);
    console.error(chalk.gray(`  Found ${files.length} files`));

    const analyzer = new FileAnalyzer(llmClient, config);
    await analyzer.init();

    const sem = new Semaphore(config.concurrency);
    const results: FileDetail[] = [];
    let done = 0;
    let cached = 0;
    let errors = 0;

    const tasks = files.map(file => sem.run(async () => {
      // Incremental: check cache
      if (config.incremental) {
        const { readFile: rf } = await import('fs/promises');
        let content: string;
        try {
          content = await rf(file.absolutePath, 'utf8');
        } catch {
          done++;
          return;
        }
        const hash = hashContent(content);
        const cached_ = await loadCachedDetail(outDir, file.relativePath);
        if (cached_ && isCacheValid(cached_, hash)) {
          results.push(cached_);
          cached++;
          done++;
          printProgress(done, files.length, cached, errors);
          return;
        }
      }

      const result = await analyzer.analyze(file);
      done++;

      if (result.status === 'ok') {
        await writeFileDetail(outDir, result.detail);
        results.push(result.detail);
        if (result.detail.error) errors++;
      } else if (result.status === 'error') {
        errors++;
        process.stderr.write(chalk.yellow(`  [warn] ${file.relativePath}: ${result.error}\n`));
      }

      printProgress(done, files.length, cached, errors);
    }));

    await Promise.all(tasks);

    // Write index
    await writeIndex(outDir, results, llmClient.getModelName());

    process.stderr.write('\n');
    console.error(chalk.green(`  Done. ${results.length} files indexed, ${cached} from cache, ${errors} errors.`));
    console.error(chalk.gray(`  Index: ${join(outDir, 'index.json')}`));
  });

program
  .command('status')
  .description('Show stats for the existing .overview/ index')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .action(async (opts: { out?: string }) => {
    const outDir = resolve(opts.out ?? '.overview');
    try {
      const raw = await readFile(join(outDir, 'index.json'), 'utf8');
      const index = JSON.parse(raw) as { version: number; generated: string; llm: string; files: unknown[] };
      console.log(chalk.cyan('Overview index'));
      console.log(`  Files:     ${index.files.length}`);
      console.log(`  LLM:       ${index.llm}`);
      console.log(`  Generated: ${index.generated}`);
    } catch {
      console.error(chalk.red('  No index found. Run: overview index'));
      process.exit(1);
    }
  });

program.parse();

// Helpers

async function resolveLlm(config: OverviewConfig): Promise<LlmClient> {
  if (config.llmMode === 'claude') {
    if (!config.anthropicApiKey) {
      console.error(chalk.red('  Error: ANTHROPIC_API_KEY is required for --llm claude'));
      process.exit(1);
    }
    return new ClaudeClient(config);
  }

  if (config.llmMode === 'local') {
    const local = new LocalClient(config);
    await local.detectModel();
    return local;
  }

  // auto: try local first, fall back to Claude
  const health = await checkLocalLlmHealth(config);
  if (health.available) {
    const local = new LocalClient(config);
    await local.detectModel();
    process.stderr.write(chalk.gray(`  Using local LLM (${health.models[0]})\n`));
    return local;
  }

  if (!config.anthropicApiKey) {
    console.error(chalk.red('  Error: Local LLM unavailable and no ANTHROPIC_API_KEY set.'));
    console.error(chalk.gray('  Start LM Studio or set ANTHROPIC_API_KEY in ~/.overview/.env'));
    process.exit(1);
  }

  process.stderr.write(chalk.gray('  Local LLM unavailable, using Claude\n'));
  return new ClaudeClient(config);
}

function printProgress(done: number, total: number, cached: number, errors: number): void {
  const pct = Math.round((done / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stderr.write(`\r  [${bar}] ${pct}% (${done}/${total}, ${cached} cached, ${errors} err)`);
}

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}
