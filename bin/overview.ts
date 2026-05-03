#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, join } from 'path';
import { mkdir, writeFile, chmod } from 'fs/promises';
import { loadConfig } from '../src/config.js';
import { ClaudeClient } from '../src/llm/claude.js';
import { LocalClient } from '../src/llm/local.js';
import { checkLocalLlmHealth } from '../src/llm/health.js';
import { walkFiles } from '../src/scanner/walker.js';
import { FileAnalyzer } from '../src/indexer/analyzer.js';
import { Semaphore } from '../src/indexer/concurrency.js';
import { hashContent } from '../src/indexer/cache.js';
import { initDb } from '../src/db/schema.js';
import { isIndexed, upsertFile, search, inspect, listModules, getStats } from '../src/db/store.js';
import { generateSearchScript } from '../src/db/search-script.js';
import { buildSnippet } from '../src/inspect/snippet.js';
import type { LlmClient, OverviewConfig } from '../src/types.js';

const DB_FILENAME = 'index.db';
const SEARCH_FILENAME = 'search';

const program = new Command();

program
  .name('overview')
  .description('Generate a searchable code index for AI agents')
  .version('0.2.0');

// ─── index ────────────────────────────────────────────────────────────────────

program
  .command('index', { isDefault: true })
  .description('Scan a directory and build .overview/index.db')
  .option('--dir <path>', 'Directory to scan (default: cwd)')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .option('--llm <mode>', 'LLM: claude|local|auto (default: auto)')
  .option('--concurrency <n>', 'Parallel LLM calls', parseInt)
  .option('--force', 'Re-analyze all files, ignore cached hashes')
  .option('--model <model>', 'Claude model override')
  .option('--local-url <url>', 'Local LLM server URL')
  .option('--local-model <model>', 'Local LLM model name')
  .option('--exclude <pattern>', 'Extra glob excludes (repeatable)', collect, [])
  .action(async (opts: {
    dir?: string; out?: string; llm?: string; concurrency?: number;
    force?: boolean; model?: string; localUrl?: string; localModel?: string;
    exclude: string[];
  }) => {
    const config = loadConfig({
      rootDir: opts.dir ? resolve(opts.dir) : undefined,
      outDir: opts.out,
      llmMode: opts.llm as OverviewConfig['llmMode'],
      concurrency: opts.concurrency,
      force: opts.force,
      claudeModel: opts.model,
      localLlmUrl: opts.localUrl,
      localLlmModel: opts.localModel,
      excludePatterns: opts.exclude,
    });

    const outDir = resolve(config.rootDir, config.outDir);
    await mkdir(outDir, { recursive: true });

    const dbPath = join(outDir, DB_FILENAME);
    const db = initDb(dbPath);

    const llmClient = await resolveLlm(config);

    console.error(chalk.cyan(`  Scanning ${config.rootDir}`));
    console.error(chalk.gray(`  LLM: ${llmClient.getModelName()} | concurrency: ${config.concurrency} | db: ${dbPath}`));

    const files = await walkFiles(config.rootDir, config.excludePatterns);
    console.error(chalk.gray(`  Found ${files.length} files`));

    const analyzer = new FileAnalyzer(llmClient, config);
    await analyzer.init();

    const sem = new Semaphore(config.concurrency);
    let done = 0;
    let cached = 0;
    let errors = 0;

    const tasks = files.map(file => sem.run(async () => {
      let content: string;
      try {
        const { readFile } = await import('fs/promises');
        content = await readFile(file.absolutePath, 'utf8');
      } catch {
        done++;
        return;
      }

      const hash = hashContent(content);

      if (!config.force && isIndexed(db, file.relativePath, hash)) {
        cached++;
        done++;
        printProgress(done, files.length, cached, errors);
        return;
      }

      const result = await analyzer.analyze(file);
      done++;

      if (result.status === 'ok') {
        upsertFile(db, result.detail, llmClient.getModelName());
        if (result.detail.error) errors++;
      } else if (result.status === 'error') {
        errors++;
        process.stderr.write(chalk.yellow(`\n  [warn] ${file.relativePath}: ${result.error}`));
      }

      printProgress(done, files.length, cached, errors);
    }));

    await Promise.all(tasks);

    // Write search script
    const scriptPath = join(outDir, SEARCH_FILENAME);
    await writeFile(scriptPath, generateSearchScript(DB_FILENAME), 'utf8');
    await chmod(scriptPath, 0o755);

    process.stderr.write('\n');
    const stats = getStats(db);
    console.error(chalk.green(`  Done. ${stats.files} files, ${stats.symbols} symbols | ${cached} cached, ${errors} errors`));
    console.error(chalk.gray(`  Search: ${scriptPath} "your query"`));

    db.close();
  });

// ─── search ───────────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('Search the code index')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .option('--only <type>', 'files | symbols | imports | modules')
  .option('--module <name>', 'Filter by module')
  .option('--kind <kind>', 'Filter by kind (view, viewmodel, client, ...)')
  .option('--with-imports', 'Include import relations in default search output')
  .option('--limit <n>', 'Max results per section', parseInt)
  .action(async (query: string, opts: {
    out?: string; only?: string; module?: string; kind?: string; limit?: number; withImports?: boolean;
  }) => {
    const outDir = resolve(opts.out ?? '.overview');
    const dbPath = join(outDir, DB_FILENAME);

    let db;
    try {
      db = initDb(dbPath);
    } catch {
      console.error(chalk.red(`  No index found at ${dbPath}. Run: overview index`));
      process.exit(1);
    }

    const result = search(db, query, {
      only: opts.only,
      module: opts.module,
      kind: opts.kind,
      limit: opts.limit,
      withImports: opts.withImports,
    });

    console.log(JSON.stringify(result, null, 2));
    db.close();
  });

// ─── inspect ──────────────────────────────────────────────────────────────────

program
  .command('inspect <query>')
  .description('Inspect a file, symbol, or module without opening full source by default')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .option('--dir <path>', 'Project root for reading source snippets (default: cwd)')
  .option('--type <type>', 'auto | file | symbol | module', 'auto')
  .option('--context <n>', 'Lines of context around the focused match', parseInt)
  .action(async (query: string, opts: {
    out?: string; dir?: string; type?: 'auto' | 'file' | 'symbol' | 'module'; context?: number;
  }) => {
    const rootDir = resolve(opts.dir ?? process.cwd());
    const outDir = resolve(opts.out ?? join(rootDir, '.overview'));
    const dbPath = join(outDir, DB_FILENAME);

    let db;
    try {
      db = initDb(dbPath);
    } catch {
      console.error(chalk.red(`  No index found at ${dbPath}. Run: overview index`));
      process.exit(1);
    }

    const result = inspect(db, query, {
      type: opts.type,
    });

    if (result.status === 'ok' && result.result && result.result.kind !== 'module') {
      const inspectResult = result.result;
      const snippet = await buildSnippet(
        join(rootDir, inspectResult.file.path),
        inspectResult.file.path,
        {
          focusLine: inspectResult.focusLine,
          query,
          context: opts.context ?? 8,
        },
      );

      console.log(JSON.stringify({
        ...result,
        result: {
          ...inspectResult,
          snippet,
        },
      }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    db.close();
  });

// ─── modules ──────────────────────────────────────────────────────────────────

program
  .command('modules [query]')
  .description('List compact module summaries')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .option('--limit <n>', 'Max module results', parseInt)
  .action(async (query: string | undefined, opts: { out?: string; limit?: number }) => {
    const outDir = resolve(opts.out ?? '.overview');
    const dbPath = join(outDir, DB_FILENAME);

    let db;
    try {
      db = initDb(dbPath);
    } catch {
      console.error(chalk.red(`  No index found at ${dbPath}. Run: overview index`));
      process.exit(1);
    }

    const modules = listModules(db, query ?? '', opts.limit);
    console.log(JSON.stringify({
      query: query ?? '',
      modules,
    }, null, 2));
    db.close();
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show stats for the existing .overview/index.db')
  .option('--out <dir>', 'Output directory (default: .overview)')
  .action(async (opts: { out?: string }) => {
    const outDir = resolve(opts.out ?? '.overview');
    const dbPath = join(outDir, DB_FILENAME);

    let db;
    try {
      db = initDb(dbPath);
    } catch {
      console.error(chalk.red(`  No index found. Run: overview index`));
      process.exit(1);
    }

    const stats = getStats(db);
    console.log(chalk.cyan('Overview index'));
    console.log(`  Files:    ${stats.files}`);
    console.log(`  Symbols:  ${stats.symbols}`);
    console.log(`  LLM:      ${stats.llm}`);
    console.log(`  Updated:  ${stats.updated}`);
    db.close();
  });

program.parse();

// ─── helpers ──────────────────────────────────────────────────────────────────

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

  const health = await checkLocalLlmHealth(config);
  if (health.available) {
    const local = new LocalClient(config);
    await local.detectModel();
    process.stderr.write(chalk.gray(`  Using local LLM (${health.models[0]})\n`));
    return local;
  }

  if (!config.anthropicApiKey) {
    console.error(chalk.red('  Error: Local LLM unavailable and no ANTHROPIC_API_KEY set.'));
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
