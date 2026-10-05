import type { SupabaseAuthConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

/** Identity returned by Supabase Auth (GoTrue) — only what the app needs. */
export interface SupabaseIdentity {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Minimal Supabase Auth client (GoTrue REST API) used by our API when AUTH_PROVIDER=supabase.
 * Supabase checks the password; our database keeps the profile and the role. Only the
 * publishable key is used — the secret key is never needed by this application.
 */
export interface SupabaseAuthClient {
  /** null = wrong e-mail/password (or e-mail not confirmed). */
  signInWithPassword(email: string, password: string): Promise<SupabaseIdentity | null>;
  /** Sends the "reset password" e-mail; never reveals whether the e-mail exists. */
  sendPasswordRecovery(email: string, redirectTo: string): Promise<void>;
  /** Sets a new password with the access token from the recovery/invite link. */
  updatePassword(accessToken: string, password: string): Promise<SupabaseIdentity>;
}

type Fetch = typeof fetch;

interface GoTrueUser {
  id?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

function identity(user: GoTrueUser | undefined): SupabaseIdentity {
  if (!user?.id || !user.email) {
    throw new AppError(502, 'AUTH_PROVIDER_ERROR', 'Resposta inesperada do Supabase Auth.');
  }
  const meta = user.user_metadata ?? {};
  const name = [meta.name, meta.full_name].find((v) => typeof v === 'string' && v.trim());
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    name: (name as string | undefined) ?? null,
  };
}

function unavailable(): AppError {
  return new AppError(
    502,
    'AUTH_PROVIDER_ERROR',
    'Não foi possível validar o acesso no Supabase. Tente novamente em instantes.',
  );
}

export function createSupabaseAuthClient(
  config: SupabaseAuthConfig,
  fetchImpl: Fetch = fetch,
  log: { warn: (obj: unknown, msg?: string) => void } = console,
): SupabaseAuthClient {
  const base = `${config.url}/auth/v1`;
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: config.publishableKey,
    'content-type': 'application/json',
    ...extra,
  });

  async function call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      log.warn({ err }, 'supabase auth indisponível');
      throw unavailable();
    }
  }

  return {
    async signInWithPassword(email, password) {
      const res = await call('/token?grant_type=password', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 400 || res.status === 401 || res.status === 422) return null;
      if (res.status === 429) {
        throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde e tente de novo.');
      }
      if (!res.ok) {
        log.warn({ status: res.status }, 'supabase auth: falha no login');
        throw unavailable();
      }
      const body = (await res.json()) as { user?: GoTrueUser };
      return identity(body.user);
    },

    async sendPasswordRecovery(email, redirectTo) {
      const res = await call(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email }),
      });
      if (!res.ok) log.warn({ status: res.status }, 'supabase auth: falha ao enviar recuperação');
    },

    async updatePassword(accessToken, password) {
      const res = await call('/user', {
        method: 'PUT',
        headers: headers({ authorization: `Bearer ${accessToken}` }),
        body: JSON.stringify({ password }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new AppError(400, 'INVALID_TOKEN', 'Link de redefinição inválido ou expirado.');
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { msg?: string; message?: string };
        throw new AppError(
          400,
          'WEAK_PASSWORD',
          body.msg ?? body.message ?? 'Senha não aceita pelo Supabase (use outra senha).',
        );
      }
      if (!res.ok) {
        log.warn({ status: res.status }, 'supabase auth: falha ao trocar senha');
        throw unavailable();
      }
      return identity((await res.json()) as GoTrueUser);
    },
  };
}
