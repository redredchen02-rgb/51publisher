#!/usr/bin/env tsx
import { createRequire } from 'node:module';
import { readdir, readFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PROMPTS_DIR = join(DATA_DIR, 'prompts');
const BATCHES_DIR = join(DATA_DIR, 'batches');

const db = new Database(join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

const insertPrompt = db.prepare(`
  INSERT INTO prompt_templates (id, name, template, few_shot_examples, model, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertBatch = db.prepare(`
  INSERT INTO batch_queue (id, tab_id, authorized_host, items, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

async function migratePrompts(dryRun: boolean): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0, skipped = 0;
  try {
    const files = await readdir(PROMPTS_DIR).then((f) => f.filter((x) => x.endsWith('.json')));
    for (const f of files) {
      const raw = await readFile(join(PROMPTS_DIR, f), 'utf-8');
      const doc = JSON.parse(raw);
      if (!doc.id || !doc.template) { skipped++; continue; }
      if (!dryRun) {
        insertPrompt.run(
          doc.id,
          doc.name,
          doc.template,
          doc.fewShotExamples ?? doc.few_shot_examples ?? '',
          doc.model ?? null,
          doc.createdAt ?? doc.created_at ?? new Date().toISOString(),
          doc.updatedAt ?? doc.updated_at ?? new Date().toISOString(),
        );
      }
      migrated++;
    }
  } catch {
    // dir doesn't exist yet
  }
  return { migrated, skipped };
}

async function migrateBatches(dryRun: boolean): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0, skipped = 0;
  try {
    const files = await readdir(BATCHES_DIR).then((f) => f.filter((x) => x.endsWith('.json')));
    for (const f of files) {
      const raw = await readFile(join(BATCHES_DIR, f), 'utf-8');
      const doc = JSON.parse(raw);
      if (!doc.id || !Array.isArray(doc.items)) { skipped++; continue; }
      if (!dryRun) {
        insertBatch.run(
          doc.id,
          doc.tabId,
          doc.authorizedHost,
          JSON.stringify(doc.items),
          doc.createdAt ?? doc.created_at ?? new Date().toISOString(),
          doc.updatedAt ?? doc.updated_at ?? new Date().toISOString(),
        );
      }
      migrated++;
    }
  } catch {
    // dir doesn't exist yet
  }
  return { migrated, skipped };
}

async function backupDir(src: string): Promise<void> {
  const bak = src + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  await rename(src, bak);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const doRollback = process.argv.includes('--rollback');

  if (doRollback) {
    console.log('Rollback: restore from .bak-* directories and remove app.db');
    process.exit(0);
  }

  const promptResult = await migratePrompts(dryRun);
  const batchResult = await migrateBatches(dryRun);

  console.log('Prompts:', `${promptResult.migrated} migrated, ${promptResult.skipped} skipped`);
  console.log('Batches:', `${batchResult.migrated} migrated, ${batchResult.skipped} skipped`);

  if (!dryRun) {
    try { await backupDir(PROMPTS_DIR); console.log('Backed up prompts dir'); } catch {}
    try { await backupDir(BATCHES_DIR); console.log('Backed up batches dir'); } catch {}
    console.log('Migration complete.');
  } else {
    console.log('Dry run complete. Re-run without --dry-run to apply.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
