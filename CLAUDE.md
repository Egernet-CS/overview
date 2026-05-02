# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- index --dir <path> --llm local --local-url http://127.0.0.1:1234   # Run with local LLM
npm run dev -- index --dir <path> --llm claude                                     # Run with Claude
npm run dev -- index --dir <path> --incremental                                    # Only re-analyze changed files
npm run dev -- status                                                               # Show index stats
npm run build                                                                       # Compile TypeScript
```

## Architecture

The tool scans a codebase, sends each file to an LLM, and writes one JSON file per source file into a `.overview/` directory. The AI agent reads only the files it needs rather than scanning the whole codebase.

**Output structure:**
- `.overview/index.json` — all files with path + one-line description (entry point for AI)
- `.overview/<path>.json` — symbols, imports, and hash for each individual file

**Data flow:**
1. `bin/overview.ts` — CLI entry, resolves LLM, drives the pipeline
2. `src/scanner/walker.ts` — walks files respecting `.gitignore` and hardcoded skip rules
3. `src/scanner/filter.ts` — skips binary files via extension list + content sniff
4. `src/scanner/importer.ts` — extracts imports via static regex (no LLM); TS/JS resolves to relative paths, Swift/Python return module names
5. `src/scanner/chunker.ts` — truncates large files to `maxCharsPerFile` chars before LLM call
6. `src/indexer/analyzer.ts` — sends each file to the LLM using the prompt in `prompts/analyze-file.md`, parses JSON response
7. `src/indexer/cache.ts` — SHA-256 hash comparison for `--incremental` mode
8. `src/indexer/concurrency.ts` — semaphore limiting parallel LLM calls
9. `src/output/file-writer.ts` / `index-writer.ts` — write the final JSON files

**LLM clients** (`src/llm/`): both implement `LlmClient { chat(system, user): Promise<string> }`. `LocalClient` normalizes the base URL to always include `/v1` and uses raw `fetch` for model detection.

**Config** (`src/config.ts`): loads `~/.overview/.env` then `.env` then CLI flags.
