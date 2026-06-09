// SQLite 持久层初始化。
// better-sqlite3 是 CJS native addon，在 NodeNext ESM 下必须用 createRequire 导入。
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
export const DB_PATH = join(DATA_DIR, 'pending.db');

export type BetterSqlite3DB = InstanceType<typeof Database>;

let _db: BetterSqlite3DB | null = null;

export function initPendingDb(): BetterSqlite3DB {
  if (_db) return _db;

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS pending_topics (
      id          TEXT PRIMARY KEY,
      source_url  TEXT NOT NULL,
      site_name   TEXT NOT NULL,
      title       TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      facts       TEXT NOT NULL,
      confidence  REAL NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected')),
      rejected_reason TEXT,
      cover_image_url TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_topics(status);
    CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_topics(created_at DESC);
  `);

  return _db;
}

export function getDb(): BetterSqlite3DB {
  if (!_db) throw new Error('pending DB not initialized — call initPendingDb() first');
  return _db;
}
