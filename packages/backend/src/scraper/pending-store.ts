import type { FactsBlock } from '@51publisher/shared';
import type { RawContent } from './site-adapter.js';
import { getDb, pendingWriteQueue } from './pending-db.js';

export type PendingStatus = 'pending' | 'approved' | 'rejected';

export interface PendingTopic {
  id: string;
  sourceUrl: string;
  siteName: string;
  title: string;
  rawContent?: RawContent;
  facts: FactsBlock;
  confidence: number;
  status: PendingStatus;
  rejectedReason?: string;
  coverImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingTopicPatch {
  facts?: FactsBlock;
  confidence?: number;
  status?: PendingStatus;
  rejectedReason?: string;
}

interface PendingRow {
  id: string;
  source_url: string;
  site_name: string;
  title: string;
  raw_content: string;
  facts: string;
  confidence: number;
  status: string;
  rejected_reason: string | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTopic(row: PendingRow): PendingTopic {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    siteName: row.site_name,
    title: row.title,
    rawContent: row.raw_content ? (JSON.parse(row.raw_content) as RawContent) : undefined,
    facts: JSON.parse(row.facts) as FactsBlock,
    confidence: row.confidence,
    status: row.status as PendingStatus,
    rejectedReason: row.rejected_reason ?? undefined,
    coverImageUrl: row.cover_image_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadPendingTopic(id: string): Promise<PendingTopic | null> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pending_topics WHERE id = ?').get(id) as PendingRow | undefined;
  return row ? rowToTopic(row) : null;
}

export async function savePendingTopic(topic: PendingTopic): Promise<void> {
  const db = getDb();
  topic.updatedAt = new Date().toISOString();
  await pendingWriteQueue.enqueue(() => {
    db.prepare(
      `
      INSERT INTO pending_topics
        (id, source_url, site_name, title, raw_content, facts, confidence, status,
         rejected_reason, cover_image_url, created_at, updated_at)
      VALUES
        (@id, @sourceUrl, @siteName, @title, @rawContent, @facts, @confidence, @status,
         @rejectedReason, @coverImageUrl, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        site_name  = excluded.site_name,
        title      = excluded.title,
        raw_content = excluded.raw_content,
        facts      = excluded.facts,
        confidence = excluded.confidence,
        status     = excluded.status,
        rejected_reason = excluded.rejected_reason,
        cover_image_url = excluded.cover_image_url,
        updated_at = excluded.updated_at
    `,
    ).run({
      id: topic.id,
      sourceUrl: topic.sourceUrl,
      siteName: topic.siteName,
      title: topic.title,
      rawContent: topic.rawContent ? JSON.stringify(topic.rawContent) : '{}',
      facts: JSON.stringify(topic.facts),
      confidence: topic.confidence,
      status: topic.status,
      rejectedReason: topic.rejectedReason ?? null,
      coverImageUrl: topic.coverImageUrl ?? null,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
    });
  });
}

export async function listPendingTopics(limit?: number, status?: PendingStatus): Promise<PendingTopic[]> {
  const db = getDb();
  const cap = Math.min(Math.max(limit ?? 50, 1), 500);
  let rows: PendingRow[];
  if (status !== undefined) {
    rows = db.prepare('SELECT * FROM pending_topics WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, cap) as PendingRow[];
  } else {
    rows = db.prepare('SELECT * FROM pending_topics ORDER BY created_at DESC LIMIT ?').all(cap) as PendingRow[];
  }
  return rows.map(rowToTopic);
}

export async function deletePendingTopic(id: string): Promise<void> {
  const db = getDb();
  await pendingWriteQueue.enqueue(() => {
    db.prepare('DELETE FROM pending_topics WHERE id = ?').run(id);
  });
}

export async function updatePendingTopicStatus(
  id: string,
  status: PendingStatus,
  rejectedReason?: string,
): Promise<PendingTopic | null> {
  const db = getDb();
  const now = new Date().toISOString();
  return pendingWriteQueue.enqueue(() => {
    const result = db
      .prepare('UPDATE pending_topics SET status = ?, rejected_reason = ?, updated_at = ? WHERE id = ? RETURNING *')
      .get(status, rejectedReason ?? null, now, id) as PendingRow | undefined;
    return result ? rowToTopic(result) : null;
  });
}
