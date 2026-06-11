import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrations/runner.js';
import { registerPublishedPostsRoutes } from './published-posts-routes.js';
import { DB_PATH, getDb, initPendingDb } from './scraper/pending-db.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerPublishedPostsRoutes(app);
  await app.ready();
  return app;
}

function resetDb() {
  initPendingDb();
  getDb().exec('DELETE FROM published_posts');
}

let app: FastifyInstance;

beforeEach(async () => {
  resetDb();
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

// ================================================================
// POST /api/v1/published-posts
// ================================================================

describe('POST /api/v1/published-posts', () => {
  it('新记录 → 201，数据库写入', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'post-001',
        batch_item_id: 'batch-1',
        source_title: '测试文章',
        publish_url: 'https://example.com/post/1',
        publish_url_source: 'manual',
        published_at: '2026-06-11T10:00:00Z',
        outcome: 'publish-confirmed',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.post.sourceTitle).toBe('测试文章');
    expect(body.post.publishUrl).toBe('https://example.com/post/1');
    expect(body.post.createdAt).toBeTruthy();

    const row = getDb()
      .prepare('SELECT * FROM published_posts WHERE publish_url = ?')
      .get('https://example.com/post/1');
    expect(row).not.toBeNull();
  });

  it('相同 publish_url 再次提交 → 200（upsert，无重复行）', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'post-002',
        publish_url: 'https://example.com/post/2',
        source_title: '旧标题',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'post-002',
        publish_url: 'https://example.com/post/2',
        source_title: '新标题',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.sourceTitle).toBe('新标题');

    const rows = getDb()
      .prepare('SELECT * FROM published_posts WHERE publish_url = ?')
      .all('https://example.com/post/2');
    expect(rows.length).toBe(1);
  });

  it('相同 publish_url 但无 id（auto-generated）→ 200，仍只有一行（upsert 用 existing.id）', async () => {
    // First POST — no id, publish_url is the upsert key
    await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: { publish_url: 'https://example.com/auto-upsert', source_title: '初始' },
    });

    // Second POST — again no id, same publish_url → must update the existing row, not insert a new one
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: { publish_url: 'https://example.com/auto-upsert', source_title: '更新后' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.sourceTitle).toBe('更新后');

    const rows = getDb()
      .prepare('SELECT * FROM published_posts WHERE publish_url = ?')
      .all('https://example.com/auto-upsert');
    expect(rows.length).toBe(1);
  });

  it('publish_url 可以为空（null）→ 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'post-003',
        source_title: '无链接文章',
        outcome: 'publish-confirmed',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().post.publishUrl).toBeUndefined();
  });

  it('scheme 校验：file:// → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: { publish_url: 'file:///etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/http\/https/i);
  });

  it('scheme 校验：data: → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: { publish_url: 'data:text/html,XSS' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/http\/https/i);
  });

  it('scheme 校验：https:// → 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: { publish_url: 'https://valid.com/post/123' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('所有扩展字段都保存到 DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'post-004',
        batch_item_id: 'batch-99',
        source_title: '某作品',
        publish_url: 'https://example.com/post/4',
        publish_url_source: 'scraped',
        published_at: '2026-06-11T10:00:00.000Z',
        outcome: 'publish-confirmed',
      },
    });
    expect(res.statusCode).toBe(201);
    const post = res.json().post;
    expect(post.batchItemId).toBe('batch-99');
    expect(post.sourceTitle).toBe('某作品');
    expect(post.publishUrlSource).toBe('scraped');
    expect(post.publishedAt).toBe('2026-06-11T10:00:00.000Z');
    expect(post.outcome).toBe('publish-confirmed');
  });
});

// ================================================================
// GET /api/v1/published-posts
// ================================================================

describe('GET /api/v1/published-posts', () => {
  it('无记录 → { ok: true, posts: [] }', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/published-posts',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, posts: [] });
  });

  it('返回所有记录', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'a',
        publish_url: 'https://example.com/a',
        source_title: 'A',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'b',
        publish_url: 'https://example.com/b',
        source_title: 'B',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/published-posts',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().posts.length).toBe(2);
  });

  it('?sourceTitle=X → 只返回匹配条目', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'x1',
        publish_url: 'https://example.com/x1',
        source_title: 'X作品',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/published-posts',
      payload: {
        id: 'y1',
        publish_url: 'https://example.com/y1',
        source_title: 'Y作品',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/published-posts?sourceTitle=X%E4%BD%9C%E5%93%81',
    });
    expect(res.statusCode).toBe(200);
    const posts = res.json().posts as { sourceTitle: string }[];
    expect(posts.length).toBe(1);
    expect(posts[0].sourceTitle).toBe('X作品');
  });
});

// ================================================================
// Migration idempotency
// ================================================================

describe('migration idempotency', () => {
  it('重复执行 runMigrations 不报错', () => {
    expect(() => runMigrations(DB_PATH)).not.toThrow();
    expect(() => runMigrations(DB_PATH)).not.toThrow();
  });
});
