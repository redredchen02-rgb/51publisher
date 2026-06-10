import { getDb, initAppDb } from './migrations/db.js';
import type { FactsBlock } from '@51publisher/shared';
import type { FieldFillResult } from '@51publisher/shared';

export type BatchItemStatus =
  | 'queued'
  | 'generating'
  | 'filled'
  | 'awaiting-approval'
  | 'publish-dispatched'
  | 'publish-confirmed'
  | 'needs-human-verification'
  | 'aborted'
  | 'error';

export interface BatchItem {
  id: string;
  topic: string;
  facts?: FactsBlock;
  status: BatchItemStatus;
  draft?: import('@51publisher/shared').ContentDraft;
  publishUrl?: string;
  error?: string;
  fillResults?: FieldFillResult[];
}

export interface Batch {
  id: string;
  tabId: number;
  authorizedHost: string;
  items: BatchItem[];
  createdAt: string;
  updatedAt: string;
}

interface BatchRow {
  id: string;
  tab_id: number;
  authorized_host: string;
  items: string;
  created_at: string;
  updated_at: string;
}

function rowToBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    tabId: row.tab_id,
    authorizedHost: row.authorized_host,
    items: JSON.parse(row.items) as BatchItem[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadBatch(batchId: string): Batch | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM batch_queue WHERE id = ?').get(batchId) as BatchRow | undefined;
  return row ? rowToBatch(row) : null;
}

export function saveBatch(batch: Batch): void {
  const db = getDb();
  batch.updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO batch_queue (id, tab_id, authorized_host, items, created_at, updated_at)
    VALUES (@id, @tabId, @authorizedHost, @items, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      tab_id = excluded.tab_id,
      authorized_host = excluded.authorized_host,
      items = excluded.items,
      updated_at = excluded.updated_at
  `).run({
    id: batch.id,
    tabId: batch.tabId,
    authorizedHost: batch.authorizedHost,
    items: JSON.stringify(batch.items),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  });
}

export function listBatches(limit = 50): Batch[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM batch_queue ORDER BY updated_at DESC LIMIT ?').all(limit) as BatchRow[];
  return rows.map(rowToBatch);
}

export function recoverBatch(batch: Batch): Batch {
  return {
    ...batch,
    items: batch.items.map((it) =>
      it.status === 'publish-dispatched'
        ? { ...it, status: 'needs-human-verification' as const, error: 'recovered-dispatched-no-confirm' }
        : it,
    ),
  };
}

const TERMINAL: ReadonlySet<BatchItemStatus> = new Set([
  'publish-confirmed',
  'aborted',
  'error',
  'needs-human-verification',
]);

export function isTerminal(s: BatchItemStatus): boolean {
  return TERMINAL.has(s);
}
