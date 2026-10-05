/**
 * Entrada de produção para hospedagem Node.js gerenciada (ex.: Hostinger Node.js Web App).
 *
 * Um único processo serve a API (/api/v1) e o frontend compilado (apps/web/dist) no mesmo
 * domínio — sem CORS e com o cookie de sessão SameSite=Strict funcionando.
 * Antes de abrir a porta, aplica as migrations e a carga idempotente das curvas padrão.
 * Nenhuma regra de negócio aqui: tudo vem de apps/api/dist (gerado por "npm run build").
 */
import { fileURLToPath } from 'node:url';
import { loadEnv } from './apps/api/dist/config/env.js';
import { runMigrations } from './apps/api/dist/database/migrate.js';
import { createDatabase } from './apps/api/dist/database/client.js';
import { seedDatabase } from './apps/api/dist/database/seed-data.js';

process.env.SERVE_WEB_DIR ??= fileURLToPath(new URL('./apps/web/dist', import.meta.url));

async function prepareDatabase() {
  if (process.env.DB_MIGRATE_ON_START === 'false') return;
  const env = loadEnv();
  const url = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;
  await runMigrations(url);
  const db = createDatabase(url, 1);
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

try {
  await prepareDatabase();
} catch (err) {
  console.error('Falha ao preparar o banco de dados:', err);
  process.exit(1);
}

await import('./apps/api/dist/server.js');
