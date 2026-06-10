import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { err } from './error-response.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { authenticated: boolean };
  }
}

export const PUBLIC_ROUTES = new Set(['/api/v1/auth/login', '/api/v1/auth/status', '/api/v1/models']);

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    err(reply, 401, 'unauthorized');
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    err(reply, 500, 'auth not configured');
    return;
  }

  try {
    jwt.verify(token, secret, { algorithms: ['HS256'], clockTolerance: 30 });
    request.user = { authenticated: true };
  } catch {
    err(reply, 401, 'unauthorized');
  }
}
