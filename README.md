# overview

CLI tool that generates a compact, searchable code index so AI agents can navigate large codebases using fewer tokens.

Instead of reading every source file, the AI runs `.overview/search "query"` and gets back only the files, symbols, and imports that match — no JSON files to parse, no index to load upfront.

The intended workflow is: search first, then open only the 1-3 most relevant files.

## How it works

```
overview index --dir ./my-project --llm local
```

This scans the codebase and creates:

```
.overview/
├── index.db      # SQLite database (files, symbols, imports + FTS5 full-text search)
└── search        # Executable bash script — the AI's entry point
```

The `search` script can be called directly by an AI agent or from the command line:

```bash
.overview/search "login"                          # files + symbols + imports matching "login"
.overview/search "AuthService" --only imports     # who imports AuthService
.overview/search "LoginViewModel" --only symbols  # find a class or function
.overview/search "auth" --module Norlys           # scoped to one module
.overview/search "view" --kind viewmodel          # filter by architectural kind
.overview/search "login" --limit 20              # more results (default: 10)
```

Output is a single JSON object:

```json
{
  "query": "login",
  "files": [
    { "path": "Features/Auth/LoginViewModel.swift", "module": "Auth", "kind": "viewmodel", "description": "login state auth flow", "tags": ["auth","login","session"] }
  ],
  "symbols": [
    { "name": "login", "type": "method", "description": "authenticates user", "file": "Features/Auth/LoginViewModel.swift", "line": 45 }
  ],
  "imports": [
    { "direction": "used_by", "path": "Features/Auth/LoginView.swift" }
  ]
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

# Re-analyze all files (default: skips files whose hash matches the DB)
npm run dev -- index --dir ./my-project --force

# Update an existing index in place
npm run dev -- index --dir ./my-project

# Search from the CLI
npm run dev -- search "login"
npm run dev -- search "AuthService" --only imports

# Show stats for an existing index
npm run dev -- status

# After building: use the installed binary
npm run build
node dist/bin/overview.js index --dir ./my-project
```

### Search-first workflow

For day-to-day use, treat `.overview/search` as the entry point:

```bash
.overview/search "login"
.overview/search "CommonEnvironment" --only symbols
.overview/search "popular recipes" --module Recipes --limit 5
```

That keeps exploration cheap. The point is not that the index exists, but that agents can narrow the search space before opening full source files.

### Stop and resume

Indexing can be interrupted at any time with Ctrl+C. Each file is written to the database immediately after analysis. Restarting without `--force` skips files whose content hash already exists in the database.

### Updating an existing index

Running `overview index` again updates the existing `.overview/index.db` in place. Unchanged files are skipped automatically based on content hash, so you no longer need a separate incremental mode.

### All options

```
overview index [options]

  --dir <path>           Directory to scan (default: current directory)
  --out <dir>            Output directory (default: .overview)
  --llm <mode>           claude | local | auto (default: auto)
  --concurrency <n>      Parallel LLM calls (default: 3)
  --force                Re-analyze all files, ignore cached hashes
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
- `.overview/` is generated output and should normally not be committed
- The `search` script requires `sqlite3` (available by default on macOS; `brew install sqlite` on Linux)
- The database uses WAL mode and a short busy timeout to make parallel reads more robust
- `imports` tracks relative file paths for TS/JS and module names for Swift/Python
