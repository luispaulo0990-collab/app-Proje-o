import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { queryRows } from './raw-query.js';

/**
 * Supabase publishes every table of the `public` schema through its Data API (PostgREST) to the
 * `anon` and `authenticated` roles — whose key ships in browsers. This application never uses
 * the Data API: all access goes through our API, connected as the table owner. So, whenever
 * those roles exist (i.e. on Supabase), every table gets RLS enabled with no policy and loses
 * the grants to those roles, and future tables are created without them.
 *
 * Idempotent; runs after every migration. On plain PostgreSQL/PGlite it is a no-op.
 * The owner role used by the app bypasses RLS (no FORCE), so the application is unaffected.
 */
export async function hardenForSupabase(db: Db): Promise<boolean> {
  const roles = await queryRows<{ rolname: string }>(
    db,
    sql`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`,
  );
  const exposed = roles.map((r) => r.rolname);
  if (exposed.length === 0) return false;
  const grantees = sql.raw(exposed.map((r) => `"${r}"`).join(', '));

  const tables = await queryRows<{ tablename: string }>(
    db,
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  for (const { tablename } of tables) {
    const table = sql.identifier(tablename);
    await db.execute(sql`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON TABLE public.${table} FROM ${grantees}`);
  }
  await db.execute(sql`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${grantees}`);
  await db.execute(
    sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${grantees}`,
  );
  await db.execute(
    sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${grantees}`,
  );
  return true;
}
