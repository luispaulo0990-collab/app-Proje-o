import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { createDatabase, type Database, type Schema } from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Applies versioned SQL migrations (apps/api/drizzle) on an open database handle. */
export async function migrateDatabase(db: Database): Promise<void> {
  if (db.driver === 'pglite') {
    await migratePglite(db as unknown as PgliteDatabase<Schema>, { migrationsFolder });
  } else {
    await migrateNodePg(db as unknown as NodePgDatabase<Schema>, { migrationsFolder });
  }
}

/** Opens, migrates and closes (works from src/ and dist/). */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const db = createDatabase(databaseUrl, 1);
  try {
    await migrateDatabase(db);
  } finally {
    await db.close();
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.warn('Migrations aplicadas com sucesso.'))
    .catch((err: unknown) => {
      console.error('Falha ao aplicar migrations:', err);
      process.exit(1);
    });
}
