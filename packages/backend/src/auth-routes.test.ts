import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { randomBytes, scryptSync } from 'node:crypto';
import { registerAuthRoutes } from './auth-routes.js';

const SECRET = randomBytes(48).toString('hex');
const PASSWORD = 'super-secret-admin-pw';

function makeHash(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerAuthRoutes(app);
  await app.ready();
  return app;
}

describe('Auth Routes', () => {
  let app: FastifyInstance;
  const prevSecret = process.env.JWT_SECRET;
  const prevHash = process.env.JWT_ADMIN_PASSWORD_HASH;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.JWT_ADMIN_PASSWORD_HASH = makeHash(PASSWORD);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    if (prevHash === undefined) delete process.env.JWT_ADMIN_PASSWORD_HASH;
    else process.env.JWT_ADMIN_PASSWORD_HASH = prevHash;
  });

  describe('POST /api/v1/auth/login', () => {
    it('issues a 24h HS256 token for the correct password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      const decoded = jwt.verify(body.token, SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      // exp - iat should be ~24h (86400s).
      expect(decoded.exp! - decoded.iat!).toBe(86400);
    });

    it('rejects a wrong password with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: 'not-the-password' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().ok).toBe(false);
    });

    it('returns 500 when admin hash is not configured', async () => {
      delete process.env.JWT_ADMIN_PASSWORD_HASH;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: PASSWORD },
      });
      expect(res.statusCode).toBe(500);
    });

    it('does not accept a token signed with a non-HS256 algorithm', async () => {
      // A token forged with "none" must not validate under our HS256 pin.
      const forged = jwt.sign({}, '', { algorithm: 'none' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/status',
        headers: { authorization: `Bearer ${forged}` },
      });
      expect(res.json().authenticated).toBe(false);
    });
  });

  describe('GET /api/v1/auth/status', () => {
    it('reports authenticated for a valid token', async () => {
      const token = jwt.sign({}, SECRET, { expiresIn: '24h', algorithm: 'HS256' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.json()).toEqual({ ok: true, authenticated: true });
    });

    it('reports not authenticated for a garbage token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/status',
        headers: { authorization: 'Bearer garbage.token.here' },
      });
      expect(res.json().authenticated).toBe(false);
    });

    it('reports not authenticated with no auth header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/status' });
      expect(res.json().authenticated).toBe(false);
    });
  });
});
