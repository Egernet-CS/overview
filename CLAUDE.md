# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -- index --dir <path> --llm local --local-url http://127.0.0.1:1234   # Run with local LLM
npm run dev -- index --dir <path> --llm claude                                     # Run with Claude
npm run dev -- index --dir <path> --force                                          # Re-analyze all files
npm run dev -- status                                                               # Show index stats
npm run dev -- search "query"                                                       # Search the SQLite index
npm run dev -- modules [query]                                                      # Compact module summaries
npm run dev -- inspect <query> --type symbol                                        # Narrow inspect before opening source
npm run build                                                                       # Compile TypeScript
```

## Architecture

The tool scans a codebase, sends each file to an LLM, and writes a SQLite-backed index into `.overview/`. AI agents should search first, inspect second, and only then open full source files.

**Output structure:**
- `.overview/index.db` — SQLite database containing files, symbols, imports, tags, and cache hashes
- `.overview/search` — standalone bash search helper backed by `sqlite3`

**Recommended workflow:**
1. Run `.overview/search "query"` for cheap module/file/symbol narrowing
2. Use `overview inspect <target>` for one file/symbol/module with a small snippet
3. Open full source only for the final 1-3 files

**Data flow:**
1. `bin/overview.ts` — CLI entry, resolves LLM, drives the pipeline
2. `src/scanner/walker.ts` — walks files respecting `.gitignore` and hardcoded skip rules
3. `src/scanner/filter.ts` — skips binary files via extension list + content sniff
4. `src/scanner/importer.ts` — extracts imports via static regex (no LLM); TS/JS and Kotlin resolve to local paths when possible, Swift/Python return module names
5. `src/scanner/chunker.ts` — truncates large files to `maxCharsPerFile` chars before LLM call
6. `src/indexer/analyzer.ts` — sends each file to the LLM using the prompt in `prompts/analyze-file.md`, parses JSON response
7. `src/indexer/metadata.ts` — normalizes module/layer/kind/tags after analysis
8. `src/indexer/cache.ts` — SHA-256 hashing and indexer-version checks used to skip unchanged files
9. `src/indexer/concurrency.ts` — semaphore limiting parallel LLM calls
10. `src/db/schema.ts` / `src/db/store.ts` — manage the SQLite schema, ranked search, inspect resolution, and module summaries
11. `src/db/search-script.ts` — generates the standalone `.overview/search` script
12. `src/search/synonyms.ts` — expands domain query terms and tags
13. `src/inspect/snippet.ts` — extracts small source snippets for `overview inspect`

**Retrieval quality rules:**
- Module/layer/kind names are normalized after LLM output to avoid casing variants such as `Data` vs `data`
- Kotlin imports are resolved to local source file paths when possible, with package names kept for unresolved external imports
- Import search returns separate `uses` and `used_by` arrays, and symbol-name queries are resolved through matching symbol files
- Search expands common domain synonyms such as `popular`/`featured`, `basket`/`cart`, and `auth`/`login`

**LLM clients** (`src/llm/`): both implement `LlmClient { chat(system, user): Promise<string> }`. `LocalClient` normalizes the base URL to always include `/v1` and uses raw `fetch` for model detection.

**Config** (`src/config.ts`): loads `~/.overview/.env` then `.env` then CLI flags.
