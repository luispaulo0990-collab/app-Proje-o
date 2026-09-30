import pg from 'pg';
import { runMigrations } from '../src/database/migrate.js';

/** Recreates the test database schema from the versioned migrations before the suite. */
export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgres://unita:unita_dev@localhost:5432/unita_test';
  process.env.TEST_DATABASE_URL = url;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await client.end();
  await runMigrations(url);
}
