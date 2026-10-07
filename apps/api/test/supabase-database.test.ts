import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/database/client.js';
import { copyDatabase, tablesInDependencyOrder } from '../src/database/copy-database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { queryRows } from '../src/database/raw-query.js';
import { seedDatabase } from '../src/database/seed-data.js';
import { hardenForSupabase } from '../src/database/supabase-hardening.js';
import { isSupabaseHost, loadCaCertificate, resolveSsl } from '../src/database/ssl.js';
import { usersRepository } from '../src/database/repositories/users.repository.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
const SESSION = 'postgresql://postgres.abc:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';

describe('TLS da conexão (Supabase)', () => {
  it('reconhece hosts do Supabase', () => {
    expect(isSupabaseHost('aws-0-sa-east-1.pooler.supabase.com')).toBe(true);
    expect(isSupabaseHost('db.abc.supabase.co')).toBe(true);
    expect(isSupabaseHost('localhost')).toBe(false);
    expect(isSupabaseHost('supabase.com.evil.io')).toBe(false);
  });

  it('auto: Supabase sem CA → require; com CA → verify-full; outros hosts → sem TLS', () => {
    expect(resolveSsl(SESSION).mode).toBe('require');
    expect(resolveSsl(SESSION).ssl).toEqual({ rejectUnauthorized: false });
    const verified = resolveSsl(SESSION, { ca: PEM });
    expect(verified.mode).toBe('verify-full');
    expect(verified.ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(resolveSsl('postgres://u:p@localhost:5432/db').ssl).toBe(false);
  });

  it('remove parâmetros sslmode da URL para não sobrescrever a configuração', () => {
    const r = resolveSsl(`${SESSION}?sslmode=require&application_name=painel`);
    expect(r.connectionString).not.toContain('sslmode');
    expect(r.connectionString).toContain('application_name=painel');
    expect(r.mode).toBe('require');
  });

  it('modo explícito prevalece e verify-full exige CA', () => {
    expect(resolveSsl(SESSION, { mode: 'disable' }).ssl).toBe(false);
    expect(() => resolveSsl(SESSION, { mode: 'verify-full' })).toThrow(/DATABASE_SSL_CA/);
  });

  it('aceita CA em PEM, PEM com \\n literal e base64', () => {
    expect(loadCaCertificate(PEM)).toBe(PEM);
    expect(loadCaCertificate(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
    expect(loadCaCertificate(Buffer.from(PEM).toString('base64'))).toBe(PEM);
    expect(loadCaCertificate('')).toBeUndefined();
    expect(() => loadCaCertificate('lixo')).toThrow(/DATABASE_SSL_CA/);
  });
});

describe('Cópia do banco da demonstração para o servidor', () => {
  let source: Database;
  let target: Database;

  beforeAll(async () => {
    source = createDatabase('pglite:memory');
    await migrateDatabase(source);
    await seedDatabase(source, { log: () => undefined });
    await usersRepository.create(source, {
      name: 'Origem',
      email: 'origem@unita.test',
      passwordHash: 'hash',
      role: 'ADMIN',
    });
    target = createDatabase(process.env.TEST_DATABASE_URL ?? '', 2);
  });

  afterAll(async () => {
    await source.close();
    await target.close();
  });

  it('ordena tabelas pais antes das filhas', async () => {
    const order = (await tablesInDependencyOrder(source)).map((t) => t.name);
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('refresh_tokens'));
    expect(order.indexOf('curves')).toBeLessThan(order.indexOf('curve_versions'));
    expect(order.indexOf('works')).toBeLessThan(order.indexOf('projections'));
    expect(order.indexOf('projections')).toBeLessThan(order.indexOf('projection_values'));
  });

  it('copia tudo, confere e recusa sobrescrever usuários sem --substituir', async () => {
    const report = await copyDatabase(source, target, { replace: true, log: () => undefined });
    const users = await queryRows<{ email: string }>(target, sql`SELECT email FROM users`);
    expect(users.map((u) => u.email)).toEqual(['origem@unita.test']);
    expect(report.tables.find((t) => t.table === 'incc_indices')?.rows).toBeGreaterThan(300);

    await expect(copyDatabase(source, target, { log: () => undefined })).rejects.toThrow(
      /--substituir/,
    );
  });

  it('fecha a Data API do Supabase quando os papéis anon/authenticated existem', async () => {
    const roles = await queryRows<{ n: number }>(
      target,
      sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`,
    );
    const applied = await hardenForSupabase(target);
    expect(applied).toBe(Number(roles[0]?.n) > 0);
    if (!applied) return;
    const exposed = await queryRows<{ tablename: string }>(
      target,
      sql`SELECT c.relname AS tablename FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND (NOT c.relrowsecurity OR has_table_privilege('anon', c.oid, 'SELECT'))`,
    );
    expect(exposed).toEqual([]);
  });
});
