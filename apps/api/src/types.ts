import type { Role } from '@unita/contracts';
import type { Env } from './config/env.js';
import type { Database } from './database/client.js';
import type { JwtService } from './modules/auth/jwt.js';
import type { Mailer } from './services/mailer.js';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

/**
 * Who is performing an operation: a signed-in user, or an external system authenticated by
 * an integration key (audit rows then carry `userId = null` and `metadata.integration`).
 */
export interface Actor {
  user: AuthUser | null;
  integration: string | null;
}

export interface AppDeps {
  env: Env;
  db: Database;
  jwt: JwtService;
  mailer: Mailer;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    integrationName?: string;
  }
  interface FastifyInstance {
    deps: AppDeps;
  }
}
