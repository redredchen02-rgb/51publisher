import type { FastifyInstance } from 'fastify';
import { err } from './error-response.js';
import { getDb, pendingWriteQueue } from './scraper/pending-db.js';

interface PublishedPostBody {
  id?: string;
  batch_item_id?: string;
  source_title?: string;
  publish_url?: string;
  publish_url_source?: string;
  published_at?: string;
  outcome?: string;
}

function isValidScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function registerPublishedPostsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PublishedPostBody }>('/api/v1/published-posts', async (request, reply) => {
    const body = request.body ?? {};
    const { id, batch_item_id, source_title, publish_url, publish_url_source, published_at, outcome } = body;

    if (!publish_url) {
      return err(reply, 400, 'Missing required field: publish_url');
    }
    if (!isValidScheme(publish_url)) {
      return err(reply, 400, 'publish_url must use http or https scheme');
    }

    const now = new Date().toISOString();
    const recordId = id ?? `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const isNew = await pendingWriteQueue.enqueue(() => {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM published_posts WHERE publish_url = ?').get(publish_url);
      if (existing) {
        db.prepare(
          `
          UPDATE published_posts
          SET outcome = ?, last_checked_at = ?
          WHERE publish_url = ?
        `,
        ).run(outcome ?? null, now, publish_url);
        return false;
      }
      db.prepare(
        `
        INSERT INTO published_posts
          (id, batch_item_id, source_title, publish_url, publish_url_source, published_at, outcome, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        recordId,
        batch_item_id ?? null,
        source_title ?? null,
        publish_url,
        publish_url_source ?? null,
        published_at ?? null,
        outcome ?? null,
        now,
      );
      return true;
    });

    reply.status(isNew ? 201 : 200);
    return { ok: true };
  });

  app.get<{ Querystring: { workTitle?: string } }>('/api/v1/published-posts', async (request) => {
    const { workTitle } = request.query;
    const db = getDb();
    let rows: unknown[];
    if (workTitle) {
      rows = db.prepare('SELECT * FROM published_posts WHERE source_title = ? ORDER BY created_at DESC').all(workTitle);
    } else {
      rows = db.prepare('SELECT * FROM published_posts ORDER BY created_at DESC').all();
    }
    return { ok: true, posts: rows };
  });
}
