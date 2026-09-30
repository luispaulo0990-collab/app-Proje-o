/**
 * Modo demonstração — um único processo, sem instalar PostgreSQL:
 * PostgreSQL embarcado (PGlite) gravado em `.demo-data/`, migrations + curvas e obras de
 * exemplo, e a API servindo também o frontend compilado. Não use em produção.
 */
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './database/client.js';
import { migrateDatabase } from './database/migrate.js';
import { seedDatabase } from './database/seed-data.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = resolve(process.env.DEMO_DATA_DIR ?? join(repoRoot, '.demo-data'));
const webDir = join(repoRoot, 'apps', 'web', 'dist');

/** Random secret generated once per demo installation (never committed). */
function demoSecret(): string {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'auth-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => undefined);
}

async function main(): Promise<void> {
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(
      'Frontend não compilado. Rode "npm run demo" na raiz do projeto (ele compila antes de iniciar).',
    );
  }
  const port = process.env.PORT ?? '3333';
  const url = `http://localhost:${port}`;
  const env = loadEnv({
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    HOST: '127.0.0.1',
    PORT: port,
    DATABASE_URL: `pglite:${join(dataDir, 'db')}`,
    AUTH_SECRET: demoSecret(),
    CORS_ORIGIN: url,
    APP_URL: url,
    COOKIE_SECURE: 'false',
    SERVE_WEB_DIR: webDir,
    // Optional: Microsoft Graph credentials (MS_GRAPH_*) to import curves from SharePoint.
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k, v]) => k.startsWith('MS_GRAPH_') && v),
    ),
    // Optional: lets an external system push work curves to the demo (X-Api-Key).
    ...(process.env.INTEGRATION_API_KEYS
      ? { INTEGRATION_API_KEYS: process.env.INTEGRATION_API_KEYS }
      : {}),
  });

  const db = createDatabase(env.DATABASE_URL);
  await migrateDatabase(db);
  await seedDatabase(db, { sampleWorks: true, log: () => undefined });

  const app = await buildApp({ env, db });
  const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await app.listen({ host: env.HOST, port: env.PORT });
  console.warn(
    [
      '',
      '  Painel de Obras Unità — modo demonstração',
      `  Acesse: ${url}`,
      '  1º acesso: clique em "Criar conta" — o primeiro usuário vira ADMIN.',
      `  Dados salvos em: ${dataDir}`,
      '  Para encerrar: feche esta janela ou pressione Ctrl+C.',
      '',
    ].join('\n'),
  );
  if (process.env.DEMO_NO_BROWSER !== 'true') openBrowser(url);
}

main().catch((err: unknown) => {
  console.error(
    '\nNão foi possível iniciar a demonstração:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
