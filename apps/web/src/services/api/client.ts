import type { AuthResponse, ErrorResponse } from '@unita/contracts';

const BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Access token lives only in memory; the refresh token is an HttpOnly cookie. */
let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const session = {
  set(token: string | null) {
    accessToken = token;
  },
  onExpired(handler: () => void) {
    onSessionExpired = handler;
  },
};

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ErrorResponse | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Erro ${res.status}`,
      err?.details ?? [],
    );
  }
  return body as T;
}

/** Single-flight refresh: concurrent 401s share the same refresh request. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => (res.ok ? parse<AuthResponse>(res) : null))
    .catch(() => null)
    .then((data) => {
      session.set(data?.accessToken ?? null);
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  auth?: boolean;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
  retry = true,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  Object.entries(options.query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  });

  if (res.status === 401 && retry && options.auth !== false) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, options, false);
    onSessionExpired?.();
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    request<T>(path, { method: 'POST', body, auth }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** User-facing message for any error thrown by the API layer. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const first = err.details[0] as { message?: string } | undefined;
    return err.code === 'VALIDATION_ERROR' && first?.message ? first.message : err.message;
  }
  return 'Não foi possível conectar ao servidor.';
}
