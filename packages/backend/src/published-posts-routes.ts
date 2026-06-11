import type { FastifyInstance } from 'fastify';
import { err } from './error-response.js';
import { getDb, pendingWriteQueue } from './scraper/pending-db.js';

// Body shape matches extension's published-posts-client.ts recordPublishedPost().
interface PublishedPostBody {
  id?: string;
  batch_item_id?: string;
  source_title?: string;
  publish_url?: string | null;
  publish_url_source?: string;
  published_at?: string;
  outcome?: string;
}

export interface PublishedPost {
  id: string;
  batchItemId?: string;
  sourceTitle?: string;
  publishUrl?: string;
  publishUrlSource?: string;
  publishedAt?: string;
  outcome: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

function rowToPost(row: Record<string, unknown>): PublishedPost {
  return {
    id: row.id as string,
    batchItemId: (row.batch_item_id as string | null) ?? undefined,
    sourceTitle: (row.source_title as string | null) ?? undefined,
    publishUrl: (row.publish_url as string | null) ?? undefined,
    publishUrlSource: (row.publish_url_source as string | null) ?? undefined,
    publishedAt: (row.published_at as string | null) ?? undefined,
    outcome: row.outcome as string | null,
    lastCheckedAt: row.last_checked_at as string | null,
    createdAt: row.created_at as string,
  };
}

export async function registerPublishedPostsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PublishedPostBody }>('/api/v1/published-posts', async (request, reply) => {
    const {
      id: bodyId,
      batch_item_id,
      source_title,
      publish_url,
      publish_url_source,
      published_at,
      outcome,
    } = request.body;

    // publish_url is optional (some publishes don't get a URL back)
    // but if present must be http/https
    if (publish_url) {
      let parsed: URL;
      try {
        parsed = new URL(publish_url);
      } catch {
        return err(reply, 400, 'Invalid publish_url: not a valid URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return err(reply, 400, 'Invalid publish_url: only http/https schemes are allowed');
      }
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = bodyId ?? `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result = await pendingWriteQueue.enqueue(() => {
      // Use publish_url as upsert key if present, otherwise id
      const existing = publish_url
        ? db.prepare('SELECT id FROM published_posts WHERE publish_url = ?').get(publish_url)
        : db.prepare('SELECT id FROM published_posts WHERE id = ?').get(id);

      db.prepare(
        `
				INSERT INTO published_posts
					(id, batch_item_id, source_title, publish_url, publish_url_source,
					 published_at, outcome, created_at)
				VALUES
					(@id, @batchItemId, @sourceTitle, @publishUrl, @publishUrlSource,
					 @publishedAt, @outcome, @createdAt)
				ON CONFLICT(id) DO UPDATE SET
					batch_item_id      = excluded.batch_item_id,
					source_title       = excluded.source_title,
					publish_url        = excluded.publish_url,
					publish_url_source = excluded.publish_url_source,
					published_at       = excluded.published_at,
					outcome            = excluded.outcome
			`,
      ).run({
        id,
        batchItemId: batch_item_id ?? null,
        sourceTitle: source_title ?? null,
        publishUrl: publish_url ?? null,
        publishUrlSource: publish_url_source ?? null,
        publishedAt: published_at ?? null,
        outcome: outcome ?? null,
        createdAt: now,
      });

      const row = db.prepare('SELECT * FROM published_posts WHERE id = ?').get(id) as Record<string, unknown>;
      return { wasNew: !existing, post: rowToPost(row) };
    });

    reply.status(result.wasNew ? 201 : 200);
    return { ok: true, post: result.post };
  });

  app.get<{ Querystring: { sourceTitle?: string } }>('/api/v1/published-posts', async (request) => {
    const db = getDb();
    const { sourceTitle } = request.query;
    const rows = sourceTitle
      ? (db
          .prepare('SELECT * FROM published_posts WHERE source_title = ? ORDER BY created_at DESC')
          .all(sourceTitle) as Record<string, unknown>[])
      : (db.prepare('SELECT * FROM published_posts ORDER BY created_at DESC').all() as Record<string, unknown>[]);
    return { ok: true, posts: rows.map(rowToPost) };
  });
}
