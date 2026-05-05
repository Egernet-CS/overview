import { basename } from 'path';
import type { SqliteDB } from './schema.js';
import type { FileDetail } from '../types.js';
import { expandSearchTerms } from '../search/synonyms.js';

const DEFAULT_LIMIT = 5;
export const INDEXER_VERSION = '2026-05-04-metadata-v2';

export function isIndexed(db: SqliteDB, path: string, hash: string, indexerVersion = INDEXER_VERSION): boolean {
  const row = db.prepare('SELECT hash, indexer_version FROM files WHERE path = ?').get(path) as {
    hash: string;
    indexer_version: string | null;
  } | undefined;
  return row?.hash === hash && row.indexer_version === indexerVersion;
}

export function upsertFile(db: SqliteDB, detail: FileDetail, llm: string, indexerVersion = INDEXER_VERSION): void {
  const doUpsert = db.transaction((d: FileDetail, model: string, version: string) => {
    db.prepare(`
      INSERT INTO files (path, module, layer, kind, description, tags, hash, llm, indexer_version, updated_at, has_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        module = excluded.module,
        layer = excluded.layer,
        kind = excluded.kind,
        description = excluded.description,
        tags = excluded.tags,
        hash = excluded.hash,
        llm = excluded.llm,
        indexer_version = excluded.indexer_version,
        updated_at = excluded.updated_at,
        has_error = excluded.has_error
    `).run(
      d.path,
      d.module ?? '',
      d.layer ?? '',
      d.kind ?? '',
      d.description,
      JSON.stringify(d.tags ?? []),
      d.hash,
      model,
      version,
      new Date().toISOString(),
      d.error ? 1 : 0,
    );

    db.prepare('DELETE FROM symbols WHERE file_path = ?').run(d.path);
    const insertSym = db.prepare(`
      INSERT INTO symbols (file_path, name, type, description, line) VALUES (?, ?, ?, ?, ?)
    `);
    for (const sym of d.symbols) {
      insertSym.run(d.path, sym.name, sym.type, sym.description, sym.line ?? null);
    }

    db.prepare('DELETE FROM imports WHERE from_path = ?').run(d.path);
    const insertImp = db.prepare('INSERT OR IGNORE INTO imports (from_path, to_path) VALUES (?, ?)');
    for (const imp of d.imports) {
      insertImp.run(d.path, imp);
    }
  });

  doUpsert(detail, llm, indexerVersion);
}

export interface FileRow {
  path: string;
  module: string;
  layer: string;
  kind: string;
  description: string;
  tags: string[];
  llm: string;
  updated_at: string;
  has_error: number;
}

export interface SymbolRow {
  name: string;
  type: string;
  description: string;
  line: number | null;
  file: string;
  module: string;
  kind: string;
}

export interface ImportSearchResult {
  uses: string[];
  used_by: string[];
}

export interface ModuleSummary {
  module: string;
  fileCount: number;
  symbolCount: number;
  topKinds: string[];
  topTags: string[];
  sampleFiles: string[];
  matchedFiles?: number;
  matchedSymbols?: number;
  score?: number;
  summary: string;
}

export interface SearchResult {
  query: string;
  modules: ModuleSummary[];
  files: FileRow[];
  symbols: SymbolRow[];
  imports: ImportSearchResult;
}

export interface InspectCandidate {
  kind: 'file' | 'symbol' | 'module';
  label: string;
  description: string;
}

export interface InspectFileResult {
  kind: 'file' | 'symbol';
  file: FileRow;
  focusSymbol: SymbolRow | null;
  focusLine: number | null;
  symbols: SymbolRow[];
  imports: {
    uses: string[];
    used_by: string[];
  };
  module: ModuleSummary;
}

export interface InspectModuleResult {
  kind: 'module';
  module: ModuleSummary;
  files: FileRow[];
  symbols: SymbolRow[];
}

export interface InspectResult {
  query: string;
  status: 'ok' | 'ambiguous' | 'not_found';
  result?: InspectFileResult | InspectModuleResult;
  candidates?: InspectCandidate[];
}

export function search(
  db: SqliteDB,
  query: string,
  opts: { only?: string; module?: string; kind?: string; limit?: number; withImports?: boolean } = {},
): SearchResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const terms = expandSearchTerms(query);

  const files = opts.only && opts.only !== 'files'
    ? []
    : rankFiles(queryFiles(db, terms, opts, candidateLimit(limit)), terms).slice(0, limit);

  const symbols = opts.only && opts.only !== 'symbols'
    ? []
    : rankSymbols(querySymbols(db, terms, opts, candidateLimit(limit)), terms).slice(0, limit);

  const modules = opts.only && opts.only !== 'modules'
    ? []
    : rankModules(
      listAllModules(db),
      terms,
      files,
      symbols,
    ).slice(0, limit);

  const includeImports = opts.only === 'imports' || Boolean(opts.withImports);
  const imports = includeImports
    ? queryImportRelations(db, terms, limit)
    : emptyImportSearchResult();

  return {
    query,
    modules,
    files,
    symbols,
    imports,
  };
}

export function inspect(
  db: SqliteDB,
  query: string,
  opts: { type?: 'auto' | 'file' | 'symbol' | 'module'; limit?: number } = {},
): InspectResult {
  const type = opts.type ?? 'auto';
  const limit = opts.limit ?? DEFAULT_LIMIT;

  if (type === 'module') {
    return inspectModule(db, query, limit);
  }

  if (type === 'file') {
    return inspectFile(db, query, limit);
  }

  if (type === 'symbol') {
    return inspectSymbol(db, query, limit);
  }

  const exactPath = getExactFileByPath(db, query);
  if (exactPath) {
    return buildFileInspectResult(db, query, exactPath, null);
  }

  const exactSymbols = getExactSymbols(db, query);
  if (exactSymbols.length === 1) {
    return buildFileInspectResult(db, query, getFileByPath(db, exactSymbols[0].file), exactSymbols[0]);
  }

  const exactModule = getExactModuleName(db, query);
  if (exactModule) {
    return inspectModule(db, exactModule, limit);
  }

  const basenameMatches = getFilesByBasename(db, query);
  if (basenameMatches.length === 1) {
    return buildFileInspectResult(db, query, basenameMatches[0], null);
  }

  const exactCandidates = [
    ...exactSymbols.map((symbol): InspectCandidate => ({
      kind: 'symbol',
      label: `${symbol.name} (${symbol.file})`,
      description: symbol.description,
    })),
    ...basenameMatches.map((file): InspectCandidate => ({
      kind: 'file',
      label: file.path,
      description: file.description,
    })),
  ];

  if (exactCandidates.length > 1) {
    return {
      query,
      status: 'ambiguous',
      candidates: exactCandidates.slice(0, limit),
    };
  }

  const fallback = search(db, query, { limit, withImports: false });
  const candidates = [
    ...fallback.modules.map((module): InspectCandidate => ({
      kind: 'module',
      label: module.module,
      description: module.summary,
    })),
    ...fallback.symbols.map((symbol): InspectCandidate => ({
      kind: 'symbol',
      label: `${symbol.name} (${symbol.file})`,
      description: symbol.description,
    })),
    ...fallback.files.map((file): InspectCandidate => ({
      kind: 'file',
      label: file.path,
      description: file.description,
    })),
  ].slice(0, limit);

  if (candidates.length === 0) {
    return { query, status: 'not_found' };
  }

  return {
    query,
    status: 'ambiguous',
    candidates,
  };
}

export function listModules(
  db: SqliteDB,
  query = '',
  limit = DEFAULT_LIMIT,
): ModuleSummary[] {
  return rankModules(listAllModules(db), expandSearchTerms(query), [], []).slice(0, limit);
}

export function getStats(db: SqliteDB): { files: number; symbols: number; llm: string; updated: string } {
  const fileCount = (db.prepare('SELECT COUNT(*) as n FROM files').get() as { n: number }).n;
  const symbolCount = (db.prepare('SELECT COUNT(*) as n FROM symbols').get() as { n: number }).n;
  const latest = db.prepare('SELECT llm, updated_at FROM files ORDER BY updated_at DESC LIMIT 1').get() as { llm: string; updated_at: string } | undefined;
  return {
    files: fileCount,
    symbols: symbolCount,
    llm: latest?.llm ?? 'unknown',
    updated: latest?.updated_at ?? 'never',
  };
}

function inspectFile(db: SqliteDB, query: string, limit: number): InspectResult {
  const exact = getExactFileByPath(db, query);
  if (exact) {
    return buildFileInspectResult(db, query, exact, null);
  }

  const basenameMatches = getFilesByBasename(db, query);
  if (basenameMatches.length === 1) {
    return buildFileInspectResult(db, query, basenameMatches[0], null);
  }

  if (basenameMatches.length > 1) {
    return {
      query,
      status: 'ambiguous',
      candidates: basenameMatches.slice(0, limit).map((file) => ({
        kind: 'file',
        label: file.path,
        description: file.description,
      })),
    };
  }

  return { query, status: 'not_found' };
}

function inspectSymbol(db: SqliteDB, query: string, limit: number): InspectResult {
  const exactSymbols = getExactSymbols(db, query);
  if (exactSymbols.length === 1) {
    return buildFileInspectResult(db, query, getFileByPath(db, exactSymbols[0].file), exactSymbols[0]);
  }

  if (exactSymbols.length > 1) {
    return {
      query,
      status: 'ambiguous',
      candidates: exactSymbols.slice(0, limit).map((symbol) => ({
        kind: 'symbol',
        label: `${symbol.name} (${symbol.file})`,
        description: symbol.description,
      })),
    };
  }

  return { query, status: 'not_found' };
}

function inspectModule(db: SqliteDB, query: string, limit: number): InspectResult {
  const moduleName = getExactModuleName(db, query);
  if (!moduleName) {
    return { query, status: 'not_found' };
  }

  return {
    query,
    status: 'ok',
    result: {
      kind: 'module',
      module: getModuleSummary(db, moduleName),
      files: getFilesForModule(db, moduleName, limit),
      symbols: getSymbolsForModule(db, moduleName, limit),
    },
  };
}

function buildFileInspectResult(
  db: SqliteDB,
  query: string,
  file: FileRow,
  focusSymbol: SymbolRow | null,
): InspectResult {
  return {
    query,
    status: 'ok',
    result: {
      kind: focusSymbol ? 'symbol' : 'file',
      file,
      focusSymbol,
      focusLine: focusSymbol?.line ?? null,
      symbols: getSymbolsForFile(db, file.path),
      imports: getImportsForFile(db, file.path),
      module: getModuleSummary(db, file.module),
    },
  };
}

function queryFiles(
  db: SqliteDB,
  terms: string[],
  opts: { module?: string; kind?: string; limit?: number },
  limit: number,
): FileRow[] {
  const filterSql = [
    opts.module ? 'AND lower(f.module) = lower(?)' : '',
    opts.kind ? 'AND lower(f.kind) = lower(?)' : '',
  ].filter(Boolean).join(' ');
  const filterParams = [opts.module, opts.kind].filter((value): value is string => Boolean(value));
  const rows: Array<Omit<FileRow, 'tags'> & { tags: string }> = [];
  const perTermLimit = Math.max(limit, 20);

  const stmt = db.prepare(`
    SELECT DISTINCT f.path, f.module, f.layer, f.kind, f.description, f.tags, f.llm, f.updated_at, f.has_error
    FROM files f
    WHERE (
      f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
      OR lower(f.path) LIKE ? ESCAPE '\\'
      OR lower(f.description) LIKE ? ESCAPE '\\'
      OR lower(f.module) LIKE ? ESCAPE '\\'
      OR lower(f.kind) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_each(f.tags) WHERE lower(value) LIKE ? ESCAPE '\\')
    )
    ${filterSql}
    LIMIT ?
  `);

  for (const term of terms) {
    const like = `%${escapeLike(normalize(term))}%`;
    rows.push(...stmt.all(
      escapeFtsQuery(term),
      like,
      like,
      like,
      like,
      like,
      ...filterParams,
      perTermLimit,
    ) as Array<Omit<FileRow, 'tags'> & { tags: string }>);
  }

  return dedupe(rows, (row) => row.path).map((row) => ({
    ...row,
    tags: parseTags(row.tags),
  }));
}

function querySymbols(
  db: SqliteDB,
  terms: string[],
  opts: { module?: string; kind?: string; limit?: number },
  limit: number,
): SymbolRow[] {
  const filterSql = [
    opts.module ? 'AND lower(f.module) = lower(?)' : '',
    opts.kind ? 'AND lower(f.kind) = lower(?)' : '',
  ].filter(Boolean).join(' ');
  const filterParams = [opts.module, opts.kind].filter((value): value is string => Boolean(value));
  const rows: SymbolRow[] = [];
  const perTermLimit = Math.max(limit, 20);

  const stmt = db.prepare(`
    SELECT DISTINCT s.name, s.type, s.description, s.line, s.file_path as file, f.module, f.kind
    FROM symbols s
    JOIN files f ON f.path = s.file_path
    WHERE (
      s.id IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ?)
      OR lower(s.name) LIKE ? ESCAPE '\\'
      OR lower(s.description) LIKE ? ESCAPE '\\'
      OR lower(s.file_path) LIKE ? ESCAPE '\\'
    )
    ${filterSql}
    LIMIT ?
  `);

  for (const term of terms) {
    const like = `%${escapeLike(normalize(term))}%`;
    rows.push(...stmt.all(
      escapeFtsQuery(term),
      like,
      like,
      like,
      ...filterParams,
      perTermLimit,
    ) as SymbolRow[]);
  }

  return dedupe(rows, (row) => `${row.name}:${row.file}:${row.line ?? ''}`);
}

function queryImportRelations(db: SqliteDB, terms: string[], limit: number): ImportSearchResult {
  const uses: string[] = [];
  const usedBy: string[] = [];
  const perTermLimit = Math.max(limit, 10);

  const usesByPathStmt = db.prepare(`
    SELECT to_path as path FROM imports
    WHERE from_path LIKE ? ESCAPE '\\'
    LIMIT ?
  `);
  const usesBySymbolStmt = db.prepare(`
    SELECT DISTINCT i.to_path as path
    FROM imports i
    JOIN symbols s ON s.file_path = i.from_path
    WHERE lower(s.name) = lower(?)
       OR lower(s.name) LIKE ? ESCAPE '\\'
    LIMIT ?
  `);
  const usedByPathStmt = db.prepare(`
    SELECT from_path as path FROM imports
    WHERE to_path LIKE ? ESCAPE '\\'
    LIMIT ?
  `);
  const usedBySymbolStmt = db.prepare(`
    SELECT DISTINCT i.from_path as path
    FROM imports i
    JOIN symbols s ON s.file_path = i.to_path
    WHERE lower(s.name) = lower(?)
       OR lower(s.name) LIKE ? ESCAPE '\\'
    LIMIT ?
  `);

  for (const term of terms) {
    const normalized = normalize(term);
    if (!normalized) continue;

    const likeQuery = `%${escapeLike(normalized)}%`;
    uses.push(
      ...(usesByPathStmt.all(likeQuery, perTermLimit) as Array<{ path: string }>).map((row) => row.path),
      ...(usesBySymbolStmt.all(normalized, likeQuery, perTermLimit) as Array<{ path: string }>).map((row) => row.path),
    );
    usedBy.push(
      ...(usedByPathStmt.all(likeQuery, perTermLimit) as Array<{ path: string }>).map((row) => row.path),
      ...(usedBySymbolStmt.all(normalized, likeQuery, perTermLimit) as Array<{ path: string }>).map((row) => row.path),
    );
  }

  return {
    uses: rankImportPaths(dedupeStrings(uses), terms).slice(0, limit),
    used_by: rankImportPaths(dedupeStrings(usedBy), terms).slice(0, limit),
  };
}

function getFileByPath(db: SqliteDB, path: string): FileRow {
  const row = db.prepare(`
    SELECT path, module, layer, kind, description, tags, llm, updated_at, has_error
    FROM files WHERE path = ?
  `).get(path) as Omit<FileRow, 'tags'> & { tags: string } | undefined;

  if (!row) {
    throw new Error(`Indexed file not found: ${path}`);
  }

  return {
    ...row,
    tags: parseTags(row.tags),
  };
}

function getExactFileByPath(db: SqliteDB, query: string): FileRow | null {
  const row = db.prepare(`
    SELECT path, module, layer, kind, description, tags, llm, updated_at, has_error
    FROM files
    WHERE lower(path) = lower(?)
    LIMIT 1
  `).get(query) as Omit<FileRow, 'tags'> & { tags: string } | undefined;

  return row ? { ...row, tags: parseTags(row.tags) } : null;
}

function getFilesByBasename(db: SqliteDB, query: string): FileRow[] {
  const normalized = normalize(query);
  return queryAllFiles(db).filter((file) => normalize(basename(file.path)) === normalized);
}

function getExactSymbols(db: SqliteDB, query: string): SymbolRow[] {
  return db.prepare(`
    SELECT s.name, s.type, s.description, s.line, s.file_path as file, f.module, f.kind
    FROM symbols s
    JOIN files f ON f.path = s.file_path
    WHERE lower(s.name) = lower(?)
    ORDER BY length(s.file_path), s.line
  `).all(query) as SymbolRow[];
}

function getExactModuleName(db: SqliteDB, query: string): string | null {
  const row = db.prepare(`
    SELECT module
    FROM files
    WHERE lower(module) = lower(?)
    LIMIT 1
  `).get(query) as { module: string } | undefined;
  return row?.module ?? null;
}

function getSymbolsForFile(db: SqliteDB, filePath: string): SymbolRow[] {
  return db.prepare(`
    SELECT s.name, s.type, s.description, s.line, s.file_path as file, f.module, f.kind
    FROM symbols s
    JOIN files f ON f.path = s.file_path
    WHERE s.file_path = ?
    ORDER BY COALESCE(s.line, 999999), s.name
  `).all(filePath) as SymbolRow[];
}

function getImportsForFile(db: SqliteDB, filePath: string): { uses: string[]; used_by: string[] } {
  const uses = db.prepare(`
    SELECT to_path as path
    FROM imports
    WHERE from_path = ?
    ORDER BY to_path
    LIMIT 20
  `).all(filePath) as Array<{ path: string }>;

  const usedBy = db.prepare(`
    SELECT from_path as path
    FROM imports
    WHERE to_path = ?
    ORDER BY from_path
    LIMIT 20
  `).all(filePath) as Array<{ path: string }>;

  return {
    uses: uses.map((row) => row.path),
    used_by: usedBy.map((row) => row.path),
  };
}

function getFilesForModule(db: SqliteDB, moduleName: string, limit: number): FileRow[] {
  return (db.prepare(`
    SELECT path, module, layer, kind, description, tags, llm, updated_at, has_error
    FROM files
    WHERE module = ?
    ORDER BY path
    LIMIT ?
  `).all(moduleName, limit) as Array<Omit<FileRow, 'tags'> & { tags: string }>).map((row) => ({
    ...row,
    tags: parseTags(row.tags),
  }));
}

function getSymbolsForModule(db: SqliteDB, moduleName: string, limit: number): SymbolRow[] {
  return db.prepare(`
    SELECT s.name, s.type, s.description, s.line, s.file_path as file, f.module, f.kind
    FROM symbols s
    JOIN files f ON f.path = s.file_path
    WHERE f.module = ?
    ORDER BY f.path, COALESCE(s.line, 999999), s.name
    LIMIT ?
  `).all(moduleName, limit) as SymbolRow[];
}

function getModuleSummary(db: SqliteDB, moduleName: string): ModuleSummary {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as fileCount,
      (SELECT COUNT(*) FROM symbols s JOIN files f2 ON f2.path = s.file_path WHERE f2.module = ?) as symbolCount
    FROM files f
    WHERE f.module = ?
  `).get(moduleName, moduleName) as { fileCount: number; symbolCount: number };

  const topKinds = (db.prepare(`
    SELECT kind
    FROM files
    WHERE module = ? AND kind != ''
    GROUP BY kind
    ORDER BY COUNT(*) DESC, kind
    LIMIT 3
  `).all(moduleName) as Array<{ kind: string }>).map((row) => row.kind);

  const sampleFiles = (db.prepare(`
    SELECT path
    FROM files
    WHERE module = ?
    ORDER BY path
    LIMIT 3
  `).all(moduleName) as Array<{ path: string }>).map((row) => row.path);

  const topTags = topTagsForFiles(getFilesForModule(db, moduleName, 200));

  return {
    module: moduleName,
    fileCount: counts.fileCount,
    symbolCount: counts.symbolCount,
    topKinds,
    topTags,
    sampleFiles,
    summary: buildModuleSummary(counts.fileCount, counts.symbolCount, topKinds, topTags),
  };
}

function listAllModules(db: SqliteDB): ModuleSummary[] {
  const rows = db.prepare(`
    SELECT module, COUNT(*) as fileCount
    FROM files
    WHERE module != ''
    GROUP BY module
    ORDER BY module
  `).all() as Array<{ module: string; fileCount: number }>;

  return rows.map((row) => getModuleSummary(db, row.module));
}

function queryAllFiles(db: SqliteDB): FileRow[] {
  return (db.prepare(`
    SELECT path, module, layer, kind, description, tags, llm, updated_at, has_error
    FROM files
    ORDER BY path
  `).all() as Array<Omit<FileRow, 'tags'> & { tags: string }>).map((row) => ({
    ...row,
    tags: parseTags(row.tags),
  }));
}

function rankFiles(rows: FileRow[], terms: string[]): FileRow[] {
  const normalizedTerms = terms.map(normalize);
  return dedupe(rows, (row) => row.path).sort((a, b) => {
    const scoreDiff = maxScore(normalizedTerms, (term) => scoreFile(b, term)) - maxScore(normalizedTerms, (term) => scoreFile(a, term));
    if (scoreDiff !== 0) return scoreDiff;
    return a.path.length - b.path.length || a.path.localeCompare(b.path);
  });
}

function rankSymbols(rows: SymbolRow[], terms: string[]): SymbolRow[] {
  const normalizedTerms = terms.map(normalize);
  return dedupe(rows, (row) => `${row.name}:${row.file}:${row.line ?? ''}`).sort((a, b) => {
    const scoreDiff = maxScore(normalizedTerms, (term) => scoreSymbol(b, term)) - maxScore(normalizedTerms, (term) => scoreSymbol(a, term));
    if (scoreDiff !== 0) return scoreDiff;
    return (a.line ?? 999999) - (b.line ?? 999999) || a.file.localeCompare(b.file);
  });
}

function rankImportPaths(paths: string[], terms: string[]): string[] {
  const normalizedTerms = terms.map(normalize);
  return paths.sort((a, b) => {
    const scoreDiff = maxScore(normalizedTerms, (term) => scoreImportPath(b, term)) - maxScore(normalizedTerms, (term) => scoreImportPath(a, term));
    if (scoreDiff !== 0) return scoreDiff;
    return a.length - b.length || a.localeCompare(b);
  });
}

function rankModules(
  modules: ModuleSummary[],
  terms: string[],
  files: FileRow[],
  symbols: SymbolRow[],
): ModuleSummary[] {
  const normalizedTerms = terms.map(normalize);
  const fileMatches = new Map<string, number>();
  const symbolMatches = new Map<string, number>();

  for (const file of files) {
    fileMatches.set(file.module, (fileMatches.get(file.module) ?? 0) + 1);
  }
  for (const symbol of symbols) {
    symbolMatches.set(symbol.module, (symbolMatches.get(symbol.module) ?? 0) + 1);
  }

  return modules
    .map((module) => ({
      ...module,
      matchedFiles: fileMatches.get(module.module) ?? 0,
      matchedSymbols: symbolMatches.get(module.module) ?? 0,
      score: maxScore(normalizedTerms, (term) => scoreModule(module, term, fileMatches.get(module.module) ?? 0, symbolMatches.get(module.module) ?? 0)),
    }))
    .filter((module) => normalizedTerms.some((term) => term === '') || (module.score ?? 0) > 0)
    .sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return a.module.localeCompare(b.module);
    });
}

function scoreFile(file: FileRow, normalizedQuery: string): number {
  const path = normalize(file.path);
  const base = normalize(basename(file.path));
  const module = normalize(file.module);
  const kind = normalize(file.kind);
  const description = normalize(file.description);

  let score = 0;
  if (path === normalizedQuery) score += 180;
  if (base === normalizedQuery) score += 150;
  if (path.startsWith(normalizedQuery)) score += 100;
  if (base.startsWith(normalizedQuery)) score += 90;
  if (module === normalizedQuery) score += 80;
  if (kind === normalizedQuery) score += 70;
  if (path.includes(normalizedQuery)) score += 50;
  if (description.includes(normalizedQuery)) score += 25;
  if (file.tags.some((tag) => normalize(tag) === normalizedQuery)) score += 60;
  if (file.tags.some((tag) => normalize(tag).includes(normalizedQuery))) score += 30;
  return score;
}

function scoreSymbol(symbol: SymbolRow, normalizedQuery: string): number {
  const name = normalize(symbol.name);
  const description = normalize(symbol.description);
  const file = normalize(symbol.file);

  let score = 0;
  if (name === normalizedQuery) score += 200;
  if (name.startsWith(normalizedQuery)) score += 120;
  if (name.includes(normalizedQuery)) score += 80;
  if (file.includes(normalizedQuery)) score += 35;
  if (description.includes(normalizedQuery)) score += 20;
  return score;
}

function scoreImportPath(rawPath: string, normalizedQuery: string): number {
  const path = normalize(rawPath);
  if (path === normalizedQuery) return 120;
  if (path.endsWith(normalizedQuery)) return 100;
  if (path.includes(normalizedQuery)) return 60;
  return 0;
}

function scoreModule(module: ModuleSummary, normalizedQuery: string, matchedFiles: number, matchedSymbols: number): number {
  const name = normalize(module.module);
  let score = 0;
  if (normalizedQuery === '') score += module.fileCount;
  if (name === normalizedQuery) score += 180;
  if (name.startsWith(normalizedQuery)) score += 120;
  if (name.includes(normalizedQuery)) score += 80;
  if (module.topTags.some((tag) => normalize(tag) === normalizedQuery)) score += 40;
  if (module.topTags.some((tag) => normalize(tag).includes(normalizedQuery))) score += 20;
  score += matchedFiles * 35;
  score += matchedSymbols * 25;
  return score;
}

function candidateLimit(limit: number): number {
  return Math.max(limit * 8, 30);
}

function maxScore(terms: string[], scorer: (term: string) => number): number {
  return Math.max(0, ...terms.map(scorer));
}

function emptyImportSearchResult(): ImportSearchResult {
  return { uses: [], used_by: [] };
}

function topTagsForFiles(files: FileRow[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const tag of file.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([tag]) => tag);
}

function buildModuleSummary(fileCount: number, symbolCount: number, topKinds: string[], topTags: string[]): string {
  const parts = [`${fileCount} files`, `${symbolCount} symbols`];
  if (topKinds.length > 0) {
    parts.push(`kinds: ${topKinds.join(', ')}`);
  }
  if (topTags.length > 0) {
    parts.push(`tags: ${topTags.join(', ')}`);
  }
  return parts.join(' | ');
}

function escapeFtsQuery(query: string): string {
  if (/\bAND\b|\bOR\b|\bNOT\b|[*"()^]/.test(query)) return query;
  return `"${query.replace(/"/g, '""')}"`;
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, '\\$&');
}

function parseTags(raw: string): string[] {
  try {
    const tags = JSON.parse(raw) as unknown;
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function dedupe<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupeStrings(items: string[]): string[] {
  return dedupe(items, (item) => item);
}
