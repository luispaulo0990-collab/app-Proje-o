import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './database/client.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
    sslCa: env.DATABASE_SSL_CA,
  });
  const app = await buildApp({ env, db });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'encerrando');
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
