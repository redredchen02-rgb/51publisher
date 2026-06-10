import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerBatchRoutes } from './batch-routes.js';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// data/ 目录清理(测试隔离)。优先使用 test-setup 注入的隔离临时目录，
// 避免误删真实 packages/backend/data。
const DATA_DIR = process.env.PUBLISHER_DATA_DIR || join(dirname(new URL(import.meta.url).pathname), '..', 'data');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerBatchRoutes(app);
  await app.ready();
  return app;
}

function cleanData() {
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

describe('Batch Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    cleanData();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    cleanData();
  });

  describe('POST /api/v1/batches', () => {
    it('creates a new batch', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/batches',
        payload: {
          id: 'test-batch-1',
          tabId: 42,
          authorizedHost: 'example.com',
          topics: ['topic-a', 'topic-b'],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.batch.id).toBe('test-batch-1');
      expect(body.batch.items).toHaveLength(2);
      expect(body.batch.items[0].status).toBe('queued');
      expect(body.batch.items[1].topic).toBe('topic-b');
    });

    it('rejects empty topics', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/batches',
        payload: {
          id: 'test-batch-2',
          tabId: 42,
          authorizedHost: 'example.com',
          topics: [],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/batches/:id', () => {
    it('returns 404 for unknown batch', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/batches/nonexist' });
      expect(res.statusCode).toBe(404);
    });

    it('returns a created batch', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/batches',
        payload: {
          id: 'b1',
          tabId: 1,
          authorizedHost: 'h.com',
          topics: ['t1'],
        },
      });
      const res = await app.inject({ method: 'GET', url: '/api/v1/batches/b1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().batch.id).toBe('b1');
    });
  });

  describe('PATCH /api/v1/batches/:id/items/:itemId', () => {
    it('transitions queued → generating', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/batches',
        payload: {
          id: 'b2',
          tabId: 1,
          authorizedHost: 'h.com',
          topics: ['t1'],
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/batches/b2/items/b2_item_0',
        payload: { status: 'generating' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().item.status).toBe('generating');
    });

    it('rejects invalid state transition', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/batches',
        payload: {
          id: 'b3',
          tabId: 1,
          authorizedHost: 'h.com',
          topics: ['t1'],
        },
      });

      // queued → publish-confirmed is invalid
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/batches/b3/items/b3_item_0',
        payload: { status: 'publish-confirmed' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().ok).toBe(false);
    });

    it('returns 404 for unknown item', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/batches',
        payload: {
          id: 'b4',
          tabId: 1,
          authorizedHost: 'h.com',
          topics: ['t1'],
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/batches/b4/items/fake_item',
        payload: { status: 'generating' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/batches (list)', () => {
    it('lists recently created batches', async () => {
      for (const id of ['la', 'lb', 'lc']) {
        await app.inject({
          method: 'POST',
          url: '/api/v1/batches',
          payload: {
            id,
            tabId: 1,
            authorizedHost: 'h.com',
            topics: ['t1'],
          },
        });
      }
      const res = await app.inject({ method: 'GET', url: '/api/v1/batches' });
      expect(res.statusCode).toBe(200);
      expect(res.json().batches.length).toBe(3);
    });
  });
});
