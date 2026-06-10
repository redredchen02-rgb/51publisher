import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { err } from './error-response.js';
import { LoginBody, LoginResponse } from './schemas.js';

interface LoginBody {
  password: string;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: LoginBody,
        response: {
          200: LoginResponse,
        },
      },
    },
    async (request, reply) => {
      const adminPassword = process.env.JWT_ADMIN_PASSWORD;
      if (!adminPassword) {
        return err(reply, 500, 'auth not configured');
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return err(reply, 500, 'auth not configured');
      }

      const { password } = request.body;
      if (password !== adminPassword) {
        return err(reply, 401, 'invalid password');
      }

      const token = jwt.sign({}, secret, { expiresIn: '7d' });
      return { ok: true, token };
    },
  );

  app.get('/api/v1/auth/status', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { ok: true, authenticated: false };
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return { ok: true, authenticated: false };
    }

    const token = authHeader.slice(7);
    try {
      jwt.verify(token, secret);
      return { ok: true, authenticated: true };
    } catch {
      return { ok: true, authenticated: false };
    }
  });
}
