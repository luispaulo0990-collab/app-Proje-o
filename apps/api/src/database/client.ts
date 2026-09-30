import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
/** Either the root database or a transaction — repositories accept both, on any driver. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** Root database handle with an explicit lifecycle. */
export type Database = Db & { close: () => Promise<void>; driver: 'postgres' | 'pglite' };

/**
 * `DATABASE_URL` selects the driver:
 * - `postgres://…`   → PostgreSQL server (development and production)
 * - `pglite:<pasta>` → PostgreSQL embarcado (PGlite/WASM) gravado em disco — modo demonstração
 * - `pglite:memory`  → PostgreSQL embarcado em memória
 */
export const EMBEDDED_PREFIX = 'pglite:';

export function isEmbeddedUrl(url: string): boolean {
  return url.startsWith(EMBEDDED_PREFIX);
}

// NUMERIC (1700) and DATE (1082) stay as strings: no float conversion, no timezone shift.
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1082, (v) => v);

function createEmbedded(url: string): Database {
  const location = url.slice(EMBEDDED_PREFIX.length);
  const inMemory = location === '' || location === 'memory';
  if (!inMemory) mkdirSync(location, { recursive: true });
  const client = inMemory ? new PGlite() : new PGlite(location);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return Object.assign(db, { close: () => client.close(), driver: 'pglite' as const });
}

export function createDatabase(url: string, max = 10): Database {
  if (isEmbeddedUrl(url)) return createEmbedded(url);
  const pool = new pg.Pool({ connectionString: url, max });
  const db = drizzleNodePg(pool, { schema }) as unknown as Db;
  return Object.assign(db, { close: () => pool.end(), driver: 'postgres' as const });
}

export { schema };
