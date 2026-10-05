import { mkdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { resolveSsl, type DatabaseSslMode } from './ssl.js';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
/** Either the root database or a transaction — repositories accept both, on any driver. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** Root database handle with an explicit lifecycle. */
export type Database = Db & { close: () => Promise<void>; driver: 'postgres' | 'pglite' };

/**
 * `DATABASE_URL` selects the driver:
 * - `postgres://…`   → PostgreSQL server (Supabase, VPS, local) — development and production
 * - `pglite:<pasta>` → PostgreSQL embarcado (PGlite/WASM) gravado em disco — modo demonstração
 * - `pglite:memory`  → PostgreSQL embarcado em memória
 * - `pglite:dump=<arquivo.tar.gz>` → cópia em memória de um backup do banco embarcado (dumpDataDir)
 */
export const EMBEDDED_PREFIX = 'pglite:';

/** `pglite:dump=<file>`: in-memory copy of a PGlite data-dir archive (read only on disk). */
export const DUMP_PREFIX = 'dump=';

export function isEmbeddedUrl(url: string): boolean {
  return url.startsWith(EMBEDDED_PREFIX);
}

export interface DatabaseOptions {
  /** Maximum pool size (server driver only). */
  max?: number;
  /** TLS mode; defaults to `DATABASE_SSL`, then `auto` (see ssl.ts). */
  ssl?: DatabaseSslMode;
  /** CA certificate (PEM, base64 PEM or file path); defaults to `DATABASE_SSL_CA`. */
  sslCa?: string;
}

// NUMERIC (1700) and DATE (1082) stay as strings: no float conversion, no timezone shift.
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1082, (v) => v);

function createEmbedded(url: string): Database {
  const location = url.slice(EMBEDDED_PREFIX.length);
  if (location.startsWith(DUMP_PREFIX)) {
    const archive = readFileSync(location.slice(DUMP_PREFIX.length));
    const fromDump = new PGlite({ loadDataDir: new Blob([archive]) });
    const db = drizzlePglite(fromDump, { schema }) as unknown as Db;
    return Object.assign(db, { close: () => fromDump.close(), driver: 'pglite' as const });
  }
  const inMemory = location === '' || location === 'memory';
  if (!inMemory) mkdirSync(location, { recursive: true });
  const client = inMemory ? new PGlite() : new PGlite(location);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return Object.assign(db, { close: () => client.close(), driver: 'pglite' as const });
}

export function createDatabase(url: string, maxOrOptions: number | DatabaseOptions = 10): Database {
  if (isEmbeddedUrl(url)) return createEmbedded(url);
  const options = typeof maxOrOptions === 'number' ? { max: maxOrOptions } : maxOrOptions;
  const { connectionString, ssl } = resolveSsl(url, {
    mode: options.ssl ?? (process.env.DATABASE_SSL as DatabaseSslMode | undefined),
    ca: options.sslCa ?? process.env.DATABASE_SSL_CA,
  });
  const pool = new pg.Pool({ connectionString, ssl, max: options.max ?? 10 });
  // An idle client dropped by the pooler/network must not crash the process.
  pool.on('error', (err) => console.error('[database] conexão ociosa encerrada:', err.message));
  const db = drizzleNodePg(pool, { schema }) as unknown as Db;
  return Object.assign(db, { close: () => pool.end(), driver: 'postgres' as const });
}

/**
 * URL for schema changes and bulk loads. On Supabase the app runs through the transaction
 * pooler (port 6543); migrations prefer the session pooler/direct URL when configured.
 */
export function migrationUrl(source: NodeJS.ProcessEnv = process.env): string | undefined {
  return source.DATABASE_MIGRATION_URL || source.DATABASE_URL;
}

export { schema };
