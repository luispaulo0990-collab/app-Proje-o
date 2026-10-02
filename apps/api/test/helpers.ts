import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/database/client.js';
import { MemoryMailer } from '../src/services/mailer.js';

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  mailer: MemoryMailer;
}

export async function createTestApp(
  overrides: Record<string, string> = {},
  options: Pick<Parameters<typeof buildApp>[0], 'workCurveProvider' | 'economicProvider'> = {},
): Promise<TestContext> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? 'postgres://unita:unita_dev@localhost:5432/unita_test',
    AUTH_SECRET: 'test-secret-with-at-least-32-characters!!',
    RATE_LIMIT_MAX: '10000',
    AUTH_RATE_LIMIT_MAX: '10000',
    ...overrides,
  });
  const db = createDatabase(env.DATABASE_URL, 4);
  const mailer = new MemoryMailer();
  const app = await buildApp({ env, db, mailer, ...options });
  await app.ready();
  return { app, db, mailer };
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`TRUNCATE audit_logs, fee_issuances, work_economic_indicators, incc_indices, work_progress_indicators, projection_values, projections, work_actual_curve_points,
    work_actual_curves, works, clients, curve_points,
    curve_versions, curves, password_reset_tokens, refresh_tokens, users RESTART IDENTITY CASCADE`);
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.db.close();
}

export const PASSWORD = 'SenhaForte123';

export async function registerUser(app: FastifyInstance, email: string, name = 'Usuário Teste') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { name, email, password: PASSWORD, passwordConfirmation: PASSWORD },
  });
  return { res, body: res.json(), token: res.json().accessToken as string };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

export function refreshCookie(res: {
  cookies: { name: string; value: string }[];
}): string | undefined {
  return res.cookies.find((c) => c.name === 'unita_rt')?.value;
}

export const UNITA_22 = [
  '0.004',
  '0.012',
  '0.02',
  '0.025',
  '0.03',
  '0.03',
  '0.04',
  '0.045',
  '0.05',
  '0.07',
  '0.07',
  '0.07',
  '0.07',
  '0.075',
  '0.075',
  '0.07',
  '0.07',
  '0.07',
  '0.05',
  '0.03',
  '0.02',
  '0.004',
].map((monthlyPct, i) => ({ period: i + 1, monthlyPct }));
