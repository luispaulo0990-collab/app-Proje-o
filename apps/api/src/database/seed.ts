import { createDatabase, migrationUrl } from './client.js';
import { seedDatabase } from './seed-data.js';

async function main(): Promise<void> {
  const url = migrationUrl();
  if (!url) throw new Error('DATABASE_URL (ou DATABASE_MIGRATION_URL) não definida.');
  const db = createDatabase(url, 2);
  try {
    await seedDatabase(db, {
      adminEmail: process.env.SEED_ADMIN_EMAIL,
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      sampleWorks: process.env.SEED_SAMPLE_WORKS === 'true',
    });
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
