# overview

CLI tool that generates a compact per-file code index so AI agents can navigate large codebases using fewer tokens.

Instead of reading every source file, the AI reads a small `.overview/index.json` to find relevant files, then reads individual `.overview/<path>.json` files to see symbols and dependencies — only opening actual source files when needed.

## How it works

```
overview index --dir ./my-project --llm local
```

This scans the codebase and creates:

```
.overview/
├── index.json                  # All files with a one-line description
├── src/
│   ├── router/
│   │   └── router.ts.json      # Symbols + imports for router.ts
│   └── config.ts.json
└── ...
```

**`index.json`** — the AI's entry point (small, one entry per file):
```json
{
  "version": 1,
  "generated": "2026-05-02T10:00:00Z",
  "llm": "openai/gpt-oss-20b",
  "files": [
    { "path": "src/router/router.ts", "description": "Routes requests to LLM based on complexity." },
    { "path": "src/config.ts", "description": "Loads config from env files and CLI flags." }
  ]
}
```

**`src/router/router.ts.json`** — detailed per-file entry:
```json
{
  "path": "src/router/router.ts",
  "description": "Routes requests to LLM based on complexity.",
  "symbols": [
    { "name": "Router", "type": "class", "description": "Main routing orchestrator", "line": 12 },
    { "name": "route",  "type": "method", "description": "Routes request to local or Claude LLM", "line": 28 }
  ],
  "imports": ["src/llm/claude.ts", "src/llm/local.ts", "src/config.ts"]
}
```

## Setup

```bash
npm install
cp .env.example .env  # optional — add API keys here
```

Global config (applies to all projects):

```bash
mkdir -p ~/.overview
cp .env.example ~/.overview/.env
# Edit ~/.overview/.env with your API keys
```

## Usage

```bash
# Auto-detect LLM (tries local first, falls back to Claude)
npm run dev -- index --dir ./my-project

# Use local LLM (LM Studio or any OpenAI-compatible server)
npm run dev -- index --dir ./my-project --llm local --local-url http://127.0.0.1:1234

# Use Claude
npm run dev -- index --dir ./my-project --llm claude

# Only re-analyze files that have changed
npm run dev -- index --dir ./my-project --incremental

# Show stats for an existing index
npm run dev -- status

# After building: use the installed binary
npm run build
node dist/bin/overview.js index --dir ./my-project
```

### All options

```
overview index [options]

  --dir <path>           Directory to scan (default: current directory)
  --out <dir>            Output directory (default: .overview)
  --llm <mode>           claude | local | auto (default: auto)
  --concurrency <n>      Parallel LLM calls (default: 3)
  --incremental          Skip files whose content has not changed
  --model <model>        Claude model override
  --local-url <url>      Local LLM server URL (e.g. http://127.0.0.1:1234)
  --local-model <model>  Local LLM model name (auto-detected if omitted)
  --exclude <pattern>    Extra glob patterns to exclude (repeatable)
```

## Configuration

Settings are loaded in order: `~/.overview/.env` → `.env` → CLI flags.

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for `--llm claude` |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | Claude model to use |
| `LM_STUDIO_URL` | `http://localhost:1234/v1` | Local LLM server URL |
| `LM_STUDIO_MODEL` | *(auto-detect)* | Local model name |
| `OVERVIEW_LLM_MODE` | `auto` | `auto` / `claude` / `local` |
| `OVERVIEW_CONCURRENCY` | `3` | Parallel LLM calls |
| `OVERVIEW_MAX_FILE_SIZE` | `50000` | Files larger than this (bytes) are truncated before analysis |
| `OVERVIEW_MAX_CHARS_PER_FILE` | `12000` | Max characters sent to LLM per file |
| `OVERVIEW_RETRY_ATTEMPTS` | `2` | Retries per file on LLM error |
| `OVERVIEW_OUT_DIR` | `.overview` | Output directory |

## Notes

- Binary files are automatically skipped (by extension and content detection)
- `node_modules`, `.git`, `Pods`, `DerivedData`, `dist`, `build` are always excluded
- `.gitignore` rules are respected
- `imports` in per-file JSON contains relative file paths for TS/JS, and module names for Swift/Python
- The `--incremental` flag uses a SHA-256 hash to skip unchanged files — useful for large codebases
