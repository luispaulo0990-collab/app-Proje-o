import type { SQL } from 'drizzle-orm';
import type { Db } from './client.js';

/** Runs a raw SQL query and returns its rows — same shape on node-postgres and PGlite. */
export async function queryRows<T extends Record<string, unknown>>(
  db: Db,
  query: SQL,
): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
