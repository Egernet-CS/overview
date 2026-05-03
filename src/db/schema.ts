import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

export interface SqliteStatement {
  run(...params: (string | number | null | undefined)[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: (string | number | null | undefined)[]): unknown;
  all(...params: (string | number | null | undefined)[]): unknown[];
}

export interface SqliteDB {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void;
  pragma(pragma: string, value?: unknown): unknown;
  close(): void;
}

interface SqliteConstructor {
  new(path: string): SqliteDB;
}

const Database = _require('better-sqlite3') as SqliteConstructor;

export function initDb(dbPath: string): SqliteDB {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path        TEXT PRIMARY KEY,
      module      TEXT,
      layer       TEXT,
      kind        TEXT,
      description TEXT,
      tags        TEXT,
      hash        TEXT,
      llm         TEXT,
      updated_at  TEXT,
      has_error   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path   TEXT REFERENCES files(path) ON DELETE CASCADE,
      name        TEXT,
      type        TEXT,
      description TEXT,
      line        INTEGER
    );

    CREATE TABLE IF NOT EXISTS imports (
      from_path TEXT,
      to_path   TEXT,
      PRIMARY KEY (from_path, to_path)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      path, module, description, tags, kind, layer,
      content=files, content_rowid=rowid
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
      name, description, file_path,
      content=symbols, content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, path, module, description, tags, kind, layer)
      VALUES (new.rowid, new.path, new.module, new.description, new.tags, new.kind, new.layer);
    END;

    CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, path, module, description, tags, kind, layer)
      VALUES ('delete', old.rowid, old.path, old.module, old.description, old.tags, old.kind, old.layer);
    END;

    CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, path, module, description, tags, kind, layer)
      VALUES ('delete', old.rowid, old.path, old.module, old.description, old.tags, old.kind, old.layer);
      INSERT INTO files_fts(rowid, path, module, description, tags, kind, layer)
      VALUES (new.rowid, new.path, new.module, new.description, new.tags, new.kind, new.layer);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
      INSERT INTO symbols_fts(rowid, name, description, file_path)
      VALUES (new.id, new.name, new.description, new.file_path);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, description, file_path)
      VALUES ('delete', old.id, old.name, old.description, old.file_path);
    END;
  `);

  return db;
}
