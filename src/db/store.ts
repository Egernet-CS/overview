import type { SqliteDB } from './schema.js';
import type { FileDetail } from '../types.js';

export function isIndexed(db: SqliteDB, path: string, hash: string): boolean {
  const row = db.prepare('SELECT hash FROM files WHERE path = ?').get(path) as { hash: string } | undefined;
  return row?.hash === hash;
}

export function upsertFile(db: SqliteDB, detail: FileDetail, llm: string): void {
  const doUpsert = db.transaction((d: FileDetail, model: string) => {
    // INSERT OR REPLACE triggers files_ad (delete from FTS) then files_ai (add to FTS)
    // CASCADE also removes old symbols from symbols_fts via symbols_ad trigger
    db.prepare(`
      INSERT OR REPLACE INTO files (path, module, layer, kind, description, tags, hash, llm, updated_at, has_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.path,
      d.module ?? '',
      d.layer ?? '',
      d.kind ?? '',
      d.description,
      JSON.stringify(d.tags ?? []),
      d.hash,
      model,
      new Date().toISOString(),
      d.error ? 1 : 0,
    );

    // Symbols were cascade-deleted above; re-insert fresh
    const insertSym = db.prepare(`
      INSERT INTO symbols (file_path, name, type, description, line) VALUES (?, ?, ?, ?, ?)
    `);
    for (const sym of d.symbols) {
      insertSym.run(d.path, sym.name, sym.type, sym.description, sym.line ?? null);
    }

    // Re-insert imports
    db.prepare('DELETE FROM imports WHERE from_path = ?').run(d.path);
    const insertImp = db.prepare('INSERT OR IGNORE INTO imports (from_path, to_path) VALUES (?, ?)');
    for (const imp of d.imports) {
      insertImp.run(d.path, imp);
    }
  });

  doUpsert(detail, llm);
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

export interface ImportRow {
  direction: string;
  path: string;
}

export interface SearchResult {
  query: string;
  files: FileRow[];
  symbols: SymbolRow[];
  imports: ImportRow[];
}

export function search(
  db: SqliteDB,
  query: string,
  opts: { only?: string; module?: string; kind?: string; limit?: number } = {},
): SearchResult {
  const limit = opts.limit ?? 10;
  const ftsQuery = escapeFtsQuery(query);

  const filterSql = [
    opts.module ? 'AND f.module = ?' : '',
    opts.kind ? 'AND f.kind = ?' : '',
  ].filter(Boolean).join(' ');
  const filterParams = [opts.module, opts.kind].filter((value): value is string => Boolean(value));

  const files: FileRow[] = opts.only && opts.only !== 'files' ? [] : (
    (db.prepare(`
      SELECT f.path, f.module, f.layer, f.kind, f.description, f.tags, f.llm, f.updated_at, f.has_error
      FROM files f
      WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
      ${filterSql}
      LIMIT ?
    `).all(ftsQuery, ...filterParams, limit) as Array<Omit<FileRow, 'tags'> & { tags: string }>).map(row => ({
      ...row,
      tags: parseTags(row.tags),
    }))
  );

  const symbols: SymbolRow[] = opts.only && opts.only !== 'symbols' ? [] : (
    db.prepare(`
      SELECT s.name, s.type, s.description, s.line, s.file_path as file, f.module, f.kind
      FROM symbols s
      JOIN files f ON f.path = s.file_path
      WHERE s.id IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ?)
      ${filterSql}
      LIMIT ?
    `).all(ftsQuery, ...filterParams, limit) as SymbolRow[]
  );

  const likeQuery = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
  const imports: ImportRow[] = opts.only && opts.only !== 'imports' ? [] : (
    db.prepare(`
      SELECT 'uses' as direction, to_path as path FROM imports
      WHERE from_path LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'used_by', from_path FROM imports
      WHERE to_path LIKE ? ESCAPE '\\'
      LIMIT ?
    `).all(likeQuery, likeQuery, limit) as ImportRow[]
  );

  return { query, files, symbols, imports };
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

function escapeFtsQuery(query: string): string {
  // Wrap in double quotes for phrase search if multi-word and no FTS operators present
  // Otherwise pass through (allows FTS5 syntax like AND, OR, *)
  if (/\bAND\b|\bOR\b|\bNOT\b|[*"()^]/.test(query)) return query;
  return `"${query.replace(/"/g, '""')}"`;
}

function parseTags(raw: string): string[] {
  try {
    const tags = JSON.parse(raw) as unknown;
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}
