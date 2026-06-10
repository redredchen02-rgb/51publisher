import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', '..', 'data');
export const DB_PATH = join(DATA_DIR, 'app.db');

type BetterSqlite3DB = InstanceType<typeof Database>;

let _db: BetterSqlite3DB | null = null;

export function initAppDb(): BetterSqlite3DB {
  if (_db) return _db;

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('wal_autocheckpoint = 1000');
  _db.pragma('journal_size_limit = 67108864');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      template         TEXT NOT NULL,
      few_shot_examples TEXT NOT NULL,
      model            TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_updated ON prompt_templates(updated_at DESC);

    CREATE TABLE IF NOT EXISTS batch_queue (
      id              TEXT PRIMARY KEY,
      tab_id          INTEGER NOT NULL,
      authorized_host TEXT NOT NULL,
      items           TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_batch_updated ON batch_queue(updated_at DESC);
  `);

  return _db;
}

export function getDb(): BetterSqlite3DB {
  if (!_db) throw new Error('app DB not initialized — call initAppDb() first');
  return _db;
}

