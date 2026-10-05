import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { queryRows } from '../src/database/raw-query.js';
import { syncSupabaseAuthUsers } from '../src/database/supabase-auth-sync.js';
import { usersRepository } from '../src/database/repositories/users.repository.js';
import { loadEnv } from '../src/config/env.js';
import {
  createSupabaseAuthClient,
  type SupabaseAuthClient,
  type SupabaseIdentity,
} from '../src/modules/auth/supabase-auth.js';
import { closeTestApp, createTestApp, resetDatabase, type TestContext } from './helpers.js';

const AUTH_ID = '6f1c1f9e-5a5c-4a63-9a39-0d6a2a3b9c01';
const OTHER_ID = '6f1c1f9e-5a5c-4a63-9a39-0d6a2a3b9c02';

/** In-memory stand-in for Supabase Auth. */
class FakeSupabase implements SupabaseAuthClient {
  accounts = new Map<string, { password: string; identity: SupabaseIdentity }>();
  recoveries: { email: string; redirectTo: string }[] = [];
  async signInWithPassword(email: string, password: string) {
    const acc = this.accounts.get(email.toLowerCase());
    return acc && acc.password === password ? acc.identity : null;
  }
  async sendPasswordRecovery(email: string, redirectTo: string) {
    this.recoveries.push({ email, redirectTo });
  }
  async updatePassword(accessToken: string, password: string) {
    const acc = [...this.accounts.values()].find((a) => `token-${a.identity.id}` === accessToken);
    if (!acc) throw Object.assign(new Error('x'), { statusCode: 400 });
    acc.password = password;
    return acc.identity;
  }
}

const SUPABASE_ENV = {
  AUTH_PROVIDER: 'supabase',
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste',
  APP_URL: 'https://painel.exemplo.com.br',
};

describe('Login pelo Supabase Auth (AUTH_PROVIDER=supabase)', () => {
  let ctx: TestContext;
  const fake = new FakeSupabase();

  beforeAll(async () => {
    ctx = await createTestApp(SUPABASE_ENV, { supabaseAuth: fake });
  });
  afterAll(() => closeTestApp(ctx));
  beforeEach(async () => {
    await resetDatabase(ctx.db);
    fake.accounts.clear();
    fake.recoveries = [];
  });

  it('informa o modo e fecha o cadastro pela tela', async () => {
    const config = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/config' });
    expect(config.json()).toEqual({ provider: 'supabase', registrationEnabled: false });
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Fulano',
        email: 'fulano@unita.test',
        password: 'SenhaForte123',
        passwordConfirmation: 'SenhaForte123',
      },
    });
    expect(reg.statusCode).toBe(403);
  });

  it('vincula o usuário existente pelo e-mail e mantém o papel', async () => {
    await usersRepository.create(ctx.db, {
      name: 'Lucas',
      email: 'lucas@unita.test',
      passwordHash: 'hash-antigo',
      role: 'ADMIN',
    });
    fake.accounts.set('lucas@unita.test', {
      password: 'SenhaSupabase1',
      identity: { id: AUTH_ID, email: 'lucas@unita.test', name: null },
    });
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lucas@unita.test', password: 'errada' },
    });
    expect(bad.statusCode).toBe(401);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'Lucas@Unita.test', password: 'SenhaSupabase1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('ADMIN');
    const linked = await usersRepository.findByAuthUserId(ctx.db, AUTH_ID);
    expect(linked?.email).toBe('lucas@unita.test');
  });

  it('cria perfil VIEWER no primeiro login de quem não tinha perfil', async () => {
    fake.accounts.set('nova@unita.test', {
      password: 'SenhaSupabase1',
      identity: { id: OTHER_ID, email: 'nova@unita.test', name: 'Maria' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nova@unita.test', password: 'SenhaSupabase1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ name: 'Maria', role: 'VIEWER' });
  });

  it('usuário desativado na tabela users não entra', async () => {
    const u = await usersRepository.create(ctx.db, {
      name: 'Inativo',
      email: 'inativo@unita.test',
      passwordHash: null,
      role: 'EDITOR',
      authUserId: AUTH_ID,
    });
    await usersRepository.update(ctx.db, u.id, { isActive: false });
    fake.accounts.set('inativo@unita.test', {
      password: 'SenhaSupabase1',
      identity: { id: AUTH_ID, email: 'inativo@unita.test', name: null },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'inativo@unita.test', password: 'SenhaSupabase1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('recuperação de senha usa o Supabase e o link volta para /redefinir-senha', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'lucas@unita.test' },
    });
    expect(res.statusCode).toBe(204);
    expect(fake.recoveries).toEqual([
      { email: 'lucas@unita.test', redirectTo: 'https://painel.exemplo.com.br/redefinir-senha' },
    ]);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('redefine a senha com o token do link do Supabase', async () => {
    fake.accounts.set('lucas@unita.test', {
      password: 'Antiga12345',
      identity: { id: AUTH_ID, email: 'lucas@unita.test', name: 'Lucas' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: `token-${AUTH_ID}`,
        password: 'NovaSenha123',
        passwordConfirmation: 'NovaSenha123',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(fake.accounts.get('lucas@unita.test')?.password).toBe('NovaSenha123');
  });
});

describe('Configuração AUTH_PROVIDER=supabase', () => {
  const base = { DATABASE_URL: 'pglite:memory', AUTH_SECRET: 'x'.repeat(40) };

  it('exige URL e chave publishable, e recusa a secret key', () => {
    expect(() => loadEnv({ ...base, AUTH_PROVIDER: 'supabase' })).toThrow(/SUPABASE_URL/);
    expect(() =>
      loadEnv({
        ...base,
        AUTH_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc',
      }),
    ).toThrow(/publishable/);
    const env = loadEnv({ ...base, ...SUPABASE_ENV, SUPABASE_URL: 'https://x.supabase.co/' });
    expect(env.supabaseAuth).toEqual({
      url: 'https://x.supabase.co',
      publishableKey: 'sb_publishable_teste',
    });
  });
});

describe('Cliente REST do Supabase Auth', () => {
  const config = { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_k' };
  const silent = { warn: () => undefined };

  it('login: envia apikey e devolve a identidade; 400 = credenciais inválidas', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = createSupabaseAuthClient(
      config,
      (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            user: { id: AUTH_ID, email: 'A@B.com', user_metadata: { full_name: 'Ana' } },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
      silent,
    );
    expect(await ok.signInWithPassword('a@b.com', 'x')).toEqual({
      id: AUTH_ID,
      email: 'a@b.com',
      name: 'Ana',
    });
    expect(calls[0]?.url).toBe('https://x.supabase.co/auth/v1/token?grant_type=password');
    expect((calls[0]?.init.headers as Record<string, string>).apikey).toBe('sb_publishable_k');

    const denied = createSupabaseAuthClient(
      config,
      (async () => new Response('{}', { status: 400 })) as typeof fetch,
      silent,
    );
    expect(await denied.signInWithPassword('a@b.com', 'x')).toBeNull();

    const down = createSupabaseAuthClient(
      config,
      (async () => {
        throw new Error('offline');
      }) as typeof fetch,
      silent,
    );
    await expect(down.signInWithPassword('a@b.com', 'x')).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

describe('Gatilhos auth.users → users (banco do Supabase)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.db.execute(sql`CREATE SCHEMA IF NOT EXISTS auth`);
    await ctx.db.execute(sql`DROP TABLE IF EXISTS auth.users`);
    await ctx.db.execute(
      sql`CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb)`,
    );
  });
  afterAll(async () => {
    await ctx.db.execute(sql`DROP SCHEMA auth CASCADE`);
    await closeTestApp(ctx);
  });

  it('cria VIEWER, vincula por e-mail, acompanha troca de e-mail e desativa ao excluir', async () => {
    await resetDatabase(ctx.db);
    const existing = await usersRepository.create(ctx.db, {
      name: 'Lucas',
      email: 'lucas@unita.test',
      passwordHash: 'h',
      role: 'ADMIN',
    });
    // Created in Supabase before the triggers existed → backfill links it.
    await ctx.db.execute(
      sql`INSERT INTO auth.users VALUES (${AUTH_ID}, 'LUCAS@unita.test', '{}'::jsonb)`,
    );
    expect(await syncSupabaseAuthUsers(ctx.db, () => undefined)).toBe(true);
    expect((await usersRepository.findById(ctx.db, existing.id))?.authUserId).toBe(AUTH_ID);

    await ctx.db.execute(
      sql`INSERT INTO auth.users VALUES (${OTHER_ID}, 'maria@unita.test', '{"name":"Maria Souza"}'::jsonb)`,
    );
    const maria = await usersRepository.findByAuthUserId(ctx.db, OTHER_ID);
    expect(maria).toMatchObject({ name: 'Maria Souza', role: 'VIEWER', passwordHash: null });

    await ctx.db.execute(
      sql`UPDATE auth.users SET email = 'maria.s@unita.test' WHERE id = ${OTHER_ID}`,
    );
    expect((await usersRepository.findByAuthUserId(ctx.db, OTHER_ID))?.email).toBe(
      'maria.s@unita.test',
    );

    await ctx.db.execute(sql`DELETE FROM auth.users WHERE id = ${OTHER_ID}`);
    const removed = await usersRepository.findById(ctx.db, maria?.id ?? '');
    expect(removed).toMatchObject({ isActive: false, authUserId: null });

    // Idempotent: running again does not duplicate profiles.
    await syncSupabaseAuthUsers(ctx.db, () => undefined);
    const [count] = await queryRows<{ n: number }>(
      ctx.db,
      sql`SELECT count(*)::int AS n FROM users`,
    );
    expect(count?.n).toBe(2);
  });
});
