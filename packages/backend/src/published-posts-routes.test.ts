import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { initPendingDb, getDb } from './scraper/pending-db.js';
import { registerPublishedPostsRoutes } from './published-posts-routes.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  initPendingDb();
  await registerPublishedPostsRoutes(app);
  await app.ready();
  return app;
}

describe('published-posts routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    getDb().prepare('DELETE FROM published_posts').run();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/published-posts', () => {
    it('returns empty array on fresh DB', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/published-posts' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, posts: [] });
    });
  });

  describe('POST /api/v1/published-posts', () => {
    it('happy path: inserts record and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: {
          id: 'pp-001',
          batch_item_id: 'item-1',
          source_title: '测试作品',
          publish_url: 'https://example.com/post/1',
          published_at: '2026-06-11T00:00:00.000Z',
          outcome: 'publish-confirmed',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().ok).toBe(true);
    });

    it('GET returns the inserted record', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { id: 'pp-002', publish_url: 'https://example.com/post/2', source_title: '作品A' },
      });
      const res = await app.inject({ method: 'GET', url: '/api/v1/published-posts' });
      const { posts } = res.json();
      expect(posts).toHaveLength(1);
      expect(posts[0].publish_url).toBe('https://example.com/post/2');
    });

    it('upsert: second POST with same publish_url returns 200, no duplicate', async () => {
      const url = 'https://example.com/post/3';
      await app.inject({ method: 'POST', url: '/api/v1/published-posts', payload: { publish_url: url } });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { publish_url: url, outcome: 'online' },
      });
      expect(res.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/api/v1/published-posts' });
      expect(list.json().posts).toHaveLength(1);
      expect(list.json().posts[0].outcome).toBe('online');
    });

    it('scheme validation: file:// → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { publish_url: 'file:///etc/passwd' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('scheme validation: data: URL → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { publish_url: 'data:text/html,<script>alert(1)</script>' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('scheme validation: valid https → 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { publish_url: 'https://dx-999-adm.ympxbys.xyz/post/42' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('missing publish_url → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { source_title: '无URL帖子' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/published-posts?workTitle=', () => {
    beforeEach(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { publish_url: 'https://example.com/a', source_title: '作品X' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/published-posts',
        payload: { publish_url: 'https://example.com/b', source_title: '作品Y' },
      });
    });

    it('filter by workTitle returns only matching entries', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/published-posts?workTitle=作品X' });
      const { posts } = res.json();
      expect(posts).toHaveLength(1);
      expect(posts[0].source_title).toBe('作品X');
    });

    it('no filter returns all entries', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/published-posts' });
      expect(res.json().posts).toHaveLength(2);
    });

    it('unknown workTitle returns empty array', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/published-posts?workTitle=不存在' });
      expect(res.json().posts).toHaveLength(0);
    });
  });

  describe('migration integration', () => {
    it('published_posts table exists after initPendingDb', async () => {
      const { getDb } = await import('./scraper/pending-db.js');
      const db = getDb();
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='published_posts'").get();
      expect(row).toBeTruthy();
    });
  });
});
