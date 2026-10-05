import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().default(3333),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string()
      .refine(
        (v) => /^postgres(ql)?:\/\//.test(v) || v.startsWith('pglite:'),
        'Use postgres://… (servidor) ou pglite:<pasta> (banco embarcado de demonstração).',
      ),
    /**
     * Schema changes, seed and bulk copy. On Supabase: the session pooler (port 5432); the app
     * itself (DATABASE_URL) uses the transaction pooler (port 6543) on serverless hosts.
     */
    DATABASE_MIGRATION_URL: z
      .string()
      .refine((v) => v === '' || /^postgres(ql)?:\/\//.test(v), 'Use postgres://…')
      .optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    /** TLS: auto | disable | require | verify-full (see database/ssl.ts). */
    DATABASE_SSL: z.enum(['auto', 'disable', 'require', 'verify-full']).default('auto'),
    /** CA certificate for verify-full (Supabase: prod-ca-2021.crt) — PEM, base64 or file path. */
    DATABASE_SSL_CA: z.string().optional(),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET deve ter pelo menos 32 caracteres.'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    /** Comma separated list of allowed origins. Never "*" when credentials are used. */
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    /** Public URL of the web app, used in password reset e-mails. */
    APP_URL: z.string().url().default('http://localhost:5173'),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: bool.default(false),
    ALLOW_PUBLIC_REGISTRATION: bool.default(true),
    /**
     * Who checks passwords: `local` (Argon2 in our users table — demo/VPS) or `supabase`
     * (users created in Supabase → Authentication; our users table keeps profile and role).
     */
    AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
    /** Project URL, e.g. https://xxxx.supabase.co (AUTH_PROVIDER=supabase). */
    SUPABASE_URL: z.string().trim().url().optional(),
    /** Publishable (public) key — sb_publishable_… or the legacy anon key. Never the secret key. */
    SUPABASE_PUBLISHABLE_KEY: z.string().trim().optional(),
    /** Serves the built web app (apps/web/dist) from the API — single-process demo mode. */
    SERVE_WEB_DIR: z.string().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().default(300),
    /** Per-IP limit for login/register/reset endpoints (brute-force protection). */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),
    /**
     * Integration keys for external systems (ERP/planning) that push work curves:
     * `nome:chave,nome2:chave2` — each key with at least 32 characters. Sent as `X-Api-Key`.
     */
    INTEGRATION_API_KEYS: z.string().optional(),
    /**
     * Microsoft Graph (app-only) — reads the own curves of started works from the
     * "Consolidado Físico - Obras.xlsx" workbook on SharePoint. All three credentials are
     * required to enable the integration.
     */
    MS_GRAPH_TENANT_ID: z.string().trim().optional(),
    MS_GRAPH_CLIENT_ID: z.string().trim().optional(),
    MS_GRAPH_CLIENT_SECRET: z.string().trim().optional(),
    MS_GRAPH_DRIVE_ID: z.string().trim().optional(),
    MS_GRAPH_ITEM_ID: z.string().trim().optional(),
    MS_GRAPH_SHEET_FISICO_GERAL: z.string().trim().default('BD_Infos Gerais'),
    MS_GRAPH_CUMULATIVE_COLUMN: z.string().trim().default('Replanejado Atual Acumulado - Obra'),
    MS_GRAPH_REALIZED_COLUMN: z.string().trim().default('Realizado Acumulado'),
    MS_GRAPH_CLIENT_REPLANNED_COLUMN: z
      .string()
      .trim()
      .default('Replanejado Atual Acumulado - Cliente'),
    MS_GRAPH_TARGET_COLUMN: z.string().trim().default('Meta Acumulada - Atual'),
    /** "IEC Obra" of the Consolidado: sheet "BD_Econômico" (empty = do not read it). */
    MS_GRAPH_SHEET_ECONOMICO: z.string().trim().default('BD_Econômico'),
    MS_GRAPH_IEC_COLUMN: z.string().trim().default('IEC Obra'),
    MS_GRAPH_PROJECTED_RESULT_COLUMN: z.string().trim().default('Resultado Projetado Obra'),
    /** Value of the "Item" column that holds the work totals. */
    MS_GRAPH_ECONOMICO_TOTAL_ITEM: z.string().trim().default('Geral'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(465),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('Painel de Obras Unità <no-reply@unitaengenharia.com.br>'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.CORS_ORIGIN.split(',').some((o) => o.trim() === '*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN="*" não é permitido em produção.',
      });
    }
    if (env.AUTH_PROVIDER === 'supabase') {
      for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} é obrigatória com AUTH_PROVIDER=supabase.`,
          });
        }
      }
      if (env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_secret_')) {
        ctx.addIssue({
          code: 'custom',
          path: ['SUPABASE_PUBLISHABLE_KEY'],
          message: 'Use a chave publishable (sb_publishable_…), nunca a secret key.',
        });
      }
    }
    for (const entry of splitList(env.INTEGRATION_API_KEYS)) {
      const [name, key] = splitKey(entry);
      if (!name || !key || key.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['INTEGRATION_API_KEYS'],
          message: 'Use o formato nome:chave, com chave de pelo menos 32 caracteres.',
        });
      }
    }
  });

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function splitKey(entry: string): [string, string] {
  const at = entry.indexOf(':');
  return at < 0 ? [entry, ''] : [entry.slice(0, at).trim(), entry.slice(at + 1).trim()];
}

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  itemId: string;
  sheet: string;
  cumulativeColumn: string;
  realizedColumn: string;
  clientReplannedColumn: string;
  targetColumn: string;
  /** "BD_Econômico" sheet ("IEC Obra"); null = not read. */
  economic: {
    sheet: string;
    iecColumn: string;
    projectedResultColumn: string;
    totalItem: string;
  } | null;
}

export interface IntegrationKey {
  name: string;
  key: string;
}

export interface SupabaseAuthConfig {
  url: string;
  publishableKey: string;
}

export type Env = z.infer<typeof envSchema> & {
  /** Set when AUTH_PROVIDER=supabase. */
  supabaseAuth: SupabaseAuthConfig | null;
  COOKIE_SECURE: boolean;
  corsOrigins: string[];
  integrationKeys: IntegrationKey[];
  /** null when the Microsoft Graph integration is not configured. */
  graph: GraphConfig | null;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${details}`);
  }
  const env = parsed.data;
  return {
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    supabaseAuth:
      env.AUTH_PROVIDER === 'supabase' && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY
        ? {
            url: env.SUPABASE_URL.replace(/\/+$/, ''),
            publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
          }
        : null,
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    graph:
      env.MS_GRAPH_TENANT_ID &&
      env.MS_GRAPH_CLIENT_ID &&
      env.MS_GRAPH_CLIENT_SECRET &&
      env.MS_GRAPH_DRIVE_ID &&
      env.MS_GRAPH_ITEM_ID
        ? {
            tenantId: env.MS_GRAPH_TENANT_ID,
            clientId: env.MS_GRAPH_CLIENT_ID,
            clientSecret: env.MS_GRAPH_CLIENT_SECRET,
            driveId: env.MS_GRAPH_DRIVE_ID,
            itemId: env.MS_GRAPH_ITEM_ID,
            sheet: env.MS_GRAPH_SHEET_FISICO_GERAL,
            cumulativeColumn: env.MS_GRAPH_CUMULATIVE_COLUMN,
            realizedColumn: env.MS_GRAPH_REALIZED_COLUMN,
            clientReplannedColumn: env.MS_GRAPH_CLIENT_REPLANNED_COLUMN,
            targetColumn: env.MS_GRAPH_TARGET_COLUMN,
            economic: env.MS_GRAPH_SHEET_ECONOMICO
              ? {
                  sheet: env.MS_GRAPH_SHEET_ECONOMICO,
                  iecColumn: env.MS_GRAPH_IEC_COLUMN,
                  projectedResultColumn: env.MS_GRAPH_PROJECTED_RESULT_COLUMN,
                  totalItem: env.MS_GRAPH_ECONOMICO_TOTAL_ITEM,
                }
              : null,
          }
        : null,
    integrationKeys: splitList(env.INTEGRATION_API_KEYS).map((entry) => {
      const [name, key] = splitKey(entry);
      return { name, key };
    }),
  };
}
