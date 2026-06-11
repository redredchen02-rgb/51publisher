import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES } from './auth-middleware.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.get('/healthz', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('GET /healthz', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns {ok:true} with status 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('is listed in PUBLIC_ROUTES', () => {
    expect(PUBLIC_ROUTES.has('/healthz')).toBe(true);
  });
});
