/**
 * Vercel Function — expõe a API Fastify (apps/api) em /api/* no mesmo domínio do frontend.
 * Só adapta o runtime serverless: rotas, regras e cálculo continuam em apps/api e packages/.
 * O build (apps/api/dist) é gerado pelo "buildCommand" do vercel.json antes do empacotamento.
 */
import { buildApp } from '../apps/api/dist/app.js';
import { loadEnv } from '../apps/api/dist/config/env.js';
import { createDatabase } from '../apps/api/dist/database/client.js';

/** Reaproveitado entre invocações enquanto a instância estiver ativa. */
let appPromise;

function getApp() {
  appPromise ??= (async () => {
    const env = loadEnv();
    const db = createDatabase(env.DATABASE_URL, {
      max: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL,
      sslCa: env.DATABASE_SSL_CA,
    });
    const app = await buildApp({ env, db });
    await app.ready();
    return app;
  })().catch((err) => {
    appPromise = undefined; // permite nova tentativa na próxima requisição
    throw err;
  });
  return appPromise;
}

export default async function handler(req, res) {
  // Vercel OIDC token of this deployment (only available per request): used to sign in to
  // Microsoft Graph through workload identity federation, without any client secret.
  const oidc = req.headers['x-vercel-oidc-token'];
  if (typeof oidc === 'string' && oidc) process.env.VERCEL_OIDC_TOKEN = oidc;
  const app = await getApp();
  app.server.emit('request', req, res);
}
