import { existsSync, readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

/**
 * TLS for the PostgreSQL connection.
 * - `disable`     → no TLS (local Postgres, tests)
 * - `require`     → encrypted, certificate not verified
 * - `verify-full` → encrypted and verified against `DATABASE_SSL_CA` (Supabase CA) + host name
 * - `auto`        → follows `sslmode` in the URL; otherwise Supabase hosts get `verify-full`
 *                   when a CA is configured, `require` when not; any other host gets `disable`.
 */
export type DatabaseSslMode = 'auto' | 'disable' | 'require' | 'verify-full';

/** Query parameters that `pg` would otherwise turn into its own TLS settings (overriding ours). */
const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

const SUPABASE_HOST = /(^|\.)supabase\.(co|com|net)$/i;

export interface ResolvedSsl {
  connectionString: string;
  ssl: false | ConnectionOptions;
  mode: Exclude<DatabaseSslMode, 'auto'>;
}

export function isSupabaseHost(host: string): boolean {
  return SUPABASE_HOST.test(host);
}

function modeFromUrl(sslmode: string | null): Exclude<DatabaseSslMode, 'auto'> | null {
  switch (sslmode) {
    case 'disable':
      return 'disable';
    case 'allow':
    case 'prefer':
    case 'require':
    case 'no-verify':
      return 'require';
    case 'verify-ca':
    case 'verify-full':
      return 'verify-full';
    default:
      return null;
  }
}

/** Accepts PEM text, PEM with literal "\n" (single-line env vars), base64 of the PEM or a path. */
export function loadCaCertificate(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (raw.includes('-----BEGIN')) return raw.replace(/\\n/g, '\n');
  if (existsSync(raw)) return readFileSync(raw, 'utf8');
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  if (decoded.includes('-----BEGIN')) return decoded;
  throw new Error(
    'DATABASE_SSL_CA inválido: use o conteúdo PEM do certificado, o PEM em base64 ou o caminho do arquivo .crt.',
  );
}

export function resolveSsl(
  url: string,
  options: { mode?: DatabaseSslMode | undefined; ca?: string | undefined } = {},
): ResolvedSsl {
  const parsed = new URL(url);
  const fromUrl = modeFromUrl(parsed.searchParams.get('sslmode'));
  for (const param of SSL_URL_PARAMS) parsed.searchParams.delete(param);
  const connectionString = parsed.toString();

  const ca = loadCaCertificate(options.ca);
  const requested = options.mode && options.mode !== 'auto' ? options.mode : null;
  const mode =
    requested ??
    fromUrl ??
    (isSupabaseHost(parsed.hostname) ? (ca ? 'verify-full' : 'require') : 'disable');

  if (mode === 'disable') return { connectionString, ssl: false, mode };
  if (mode === 'require') return { connectionString, ssl: { rejectUnauthorized: false }, mode };
  if (!ca) {
    throw new Error(
      'DATABASE_SSL=verify-full exige DATABASE_SSL_CA (certificado do Supabase: Project Settings → Database → SSL Configuration).',
    );
  }
  return { connectionString, ssl: { rejectUnauthorized: true, ca }, mode };
}
