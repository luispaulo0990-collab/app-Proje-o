import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Role } from '@unita/contracts';
import type { Actor, AuthUser } from '../types.js';
import { forbidden, unauthorized } from '../utils/errors.js';

const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };

export function hasRole(user: AuthUser, minimum: Role): boolean {
  return RANK[user.role] >= RANK[minimum];
}

/**
 * Route guard: validates the Bearer access token and enforces the minimum role.
 * Hierarchy: ADMIN ⊃ EDITOR ⊃ VIEWER.
 */
export function requireRole(minimum: Role = 'VIEWER'): preHandlerAsyncHookHandler {
  return async function guard(this: unknown, request: FastifyRequest, _reply: FastifyReply) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    try {
      const claims = await request.server.deps.jwt.verify(header.slice(7));
      request.authUser = { id: claims.sub, role: claims.role, name: claims.name };
    } catch {
      throw unauthorized('Sessão expirada ou inválida.');
    }
    if (!hasRole(request.authUser, minimum)) throw forbidden();
  };
}

export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw unauthorized();
  return request.authUser;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time lookup of an integration key; returns the integration name or null. */
export function matchIntegrationKey(
  keys: readonly { name: string; key: string }[],
  presented: string,
): string | null {
  const candidate = digest(presented);
  let found: string | null = null;
  for (const k of keys) {
    if (timingSafeEqual(digest(k.key), candidate)) found = k.name;
  }
  return found;
}

/**
 * Guard for integration endpoints: accepts an `X-Api-Key` issued in INTEGRATION_API_KEYS
 * (acts with EDITOR permissions, scoped to the routes that use this guard) or a user session
 * with the minimum role.
 */
export function requireRoleOrApiKey(minimum: Role = 'EDITOR'): preHandlerAsyncHookHandler {
  const userGuard = requireRole(minimum);
  return async function guard(this: unknown, request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers['x-api-key'];
    if (typeof header === 'string' && header.length > 0) {
      const name = matchIntegrationKey(request.server.deps.env.integrationKeys, header);
      if (!name) throw unauthorized('Chave de integração inválida.');
      request.integrationName = name;
      return;
    }
    await userGuard.call(this as never, request, reply);
  };
}

export function currentActor(request: FastifyRequest): Actor {
  if (request.integrationName) return { user: null, integration: request.integrationName };
  return { user: currentUser(request), integration: null };
}
