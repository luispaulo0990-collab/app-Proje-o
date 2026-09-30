/**
 * CLI for scheduled syncs (cron / PM2 on the Hostinger VPS):
 *
 *   npm run integrations:sync-curves --workspace=@unita/api           # imports
 *   npm run integrations:sync-curves --workspace=@unita/api -- --dry  # simulation only
 *
 * Audit rows are recorded as `Integração: cron:microsoft-graph`.
 */
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../database/client.js';
import { createCurveSyncService } from '../modules/integrations/curve-sync.service.js';
import { createMailer } from '../services/mailer.js';
import { JwtService } from '../modules/auth/jwt.js';
import { graphProviderFromEnv } from './microsoft-graph/graph-work-curve-provider.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const provider = graphProviderFromEnv(env);
  if (!provider) throw new Error('Configure as variáveis MS_GRAPH_* antes de sincronizar.');
  const db = createDatabase(env.DATABASE_URL, 2);
  const log = { info: console.warn, warn: console.warn, error: console.error };
  try {
    const service = createCurveSyncService({
      env,
      db,
      jwt: new JwtService(env.AUTH_SECRET, 60),
      mailer: createMailer(env, log as never),
    });
    const report = await service.sync(
      provider,
      { user: null, integration: 'cron:microsoft-graph' },
      { dryRun: process.argv.includes('--dry') },
    );
    console.warn(JSON.stringify(report.totals));
    for (const u of report.unmatched) console.warn(`Obra da planilha sem cadastro: ${u.sheetName}`);
    for (const i of report.items.filter((x) => x.outcome === 'REJECTED'))
      console.warn(
        `Curva rejeitada (${i.workName}): ${i.issues.map((x) => x.message).join(' | ')}`,
      );
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
