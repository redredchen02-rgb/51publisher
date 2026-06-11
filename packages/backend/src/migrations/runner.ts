import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { BetterSqlite3DB } from '../scraper/pending-db.js';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

// Inlined so migrations work in both tsx (dev) and compiled dist (prod).
const MIGRATIONS: Record<string, string> = {
  '001-initial.sql': `\
CREATE TABLE IF NOT EXISTS pending_topics (
  id              TEXT PRIMARY KEY,
  source_url      TEXT NOT NULL,
  site_name       TEXT NOT NULL,
  title           TEXT NOT NULL,
  raw_content     TEXT NOT NULL,
  facts           TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected')),
  rejected_reason  TEXT,
  cover_image_url  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_topics(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_topics(created_at DESC);`,
  '002-config-store.sql': `\
CREATE TABLE IF NOT EXISTS config_store (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);`,
  '003-published-posts.sql': `\
CREATE TABLE IF NOT EXISTS published_posts (
  id                 TEXT PRIMARY KEY,
  batch_item_id      TEXT,
  source_title       TEXT,
  publish_url        TEXT UNIQUE,
  publish_url_source TEXT,
  published_at       TEXT,
  outcome            TEXT DEFAULT NULL,
  last_checked_at    TEXT DEFAULT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_publish_url ON published_posts(publish_url);
CREATE INDEX IF NOT EXISTS idx_published_outcome ON published_posts(outcome);`,
  '004-source-url-unique.sql': `\
DELETE FROM pending_topics WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM pending_topics GROUP BY source_url
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_source_url ON pending_topics(source_url);`,
};

export function runMigrations(dbPath: string): void {
  const dataDir = dirname(dbPath);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const db: BetterSqlite3DB = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set((db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name));

  const names = Object.keys(MIGRATIONS).sort();
  const insert = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const name of names) {
    if (applied.has(name)) continue;
    db.exec(MIGRATIONS[name]);
    insert.run(name);
    console.log(`[migration] Applied: ${name}`);
  }

  db.close();
}
