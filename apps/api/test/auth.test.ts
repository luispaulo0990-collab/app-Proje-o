import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../src/database/schema/index.js';
import {
  PASSWORD,
  auth,
  closeTestApp,
  createTestApp,
  refreshCookie,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDatabase(ctx.db));

describe('auth — register', () => {
  it('first user becomes ADMIN, next ones VIEWER; password stored as argon2id', async () => {
    const first = await registerUser(ctx.app, 'admin@unita.com.br');
    expect(first.res.statusCode).toBe(201);
    expect(first.body.user.role).toBe('ADMIN');
    expect(refreshCookie(first.res)).toBeTruthy();
    const cookie = first.res.cookies.find((c) => c.name === 'unita_rt');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });

    const second = await registerUser(ctx.app, 'viewer@unita.com.br');
    expect(second.body.user.role).toBe('VIEWER');

    const rows = await ctx.db.select({ hash: users.passwordHash }).from(users);
    rows.forEach((r) => expect(r.hash).toMatch(/^\$argon2id\$/));
  });

  it('rejects duplicated e-mail (case-insensitive) and invalid payloads', async () => {
    await registerUser(ctx.app, 'a@unita.com.br');
    expect((await registerUser(ctx.app, 'A@UNITA.com.br')).res.statusCode).toBe(409);
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'X', email: 'nope', password: '123', passwordConfirmation: '456' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('can disable public registration after bootstrap', async () => {
    const closed = await createTestApp({ ALLOW_PUBLIC_REGISTRATION: 'false' });
    try {
      expect((await registerUser(closed.app, 'boot@unita.com.br')).res.statusCode).toBe(201);
      expect((await registerUser(closed.app, 'other@unita.com.br')).res.statusCode).toBe(403);
    } finally {
      await closeTestApp(closed);
    }
  });
});

describe('auth — session', () => {
  it('logs in, reads /me, and rejects wrong credentials with a generic message', async () => {
    await registerUser(ctx.app, 'u@unita.com.br', 'Maria');
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u@unita.com.br', password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: auth(ok.json().accessToken),
    });
    expect(me.json()).toMatchObject({ name: 'Maria', email: 'u@unita.com.br' });

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u@unita.com.br', password: 'errada123456' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'x@unita.com.br', password: 'errada123456' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('rejects missing or tampered access tokens', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const { token } = await registerUser(ctx.app, 'u@unita.com.br');
    const tampered = `${token.slice(0, -2)}xx`;
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(tampered) }))
        .statusCode,
    ).toBe(401);
  });

  it('rotates refresh tokens and revokes everything on reuse', async () => {
    const { res } = await registerUser(ctx.app, 'u@unita.com.br');
    const first = refreshCookie(res);
    const r1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { unita_rt: first ?? '' },
    });
    expect(r1.statusCode).toBe(200);
    const second = refreshCookie(r1);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    // Reusing the old token (theft scenario) → 401 and the new one is revoked too.
    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { unita_rt: first ?? '' },
    });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { unita_rt: second ?? '' },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const { res } = await registerUser(ctx.app, 'u@unita.com.br');
    const token = refreshCookie(res) ?? '';
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          cookies: { unita_rt: token },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          cookies: { unita_rt: token },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('auth — password recovery', () => {
  it('sends a reset link, resets the password once, and never reveals unknown e-mails', async () => {
    await registerUser(ctx.app, 'u@unita.com.br');
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nobody@unita.com.br' },
    });
    expect(unknown.statusCode).toBe(204);
    expect(ctx.mailer.sent).toHaveLength(0);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'u@unita.com.br' },
    });
    const link = ctx.mailer.sent.at(-1)?.resetUrl ?? '';
    const token = new URL(link).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(20);

    const payload = { token, password: 'NovaSenha2026', passwordConfirmation: 'NovaSenha2026' };
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload }))
        .statusCode,
    ).toBe(204);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload }))
        .statusCode,
    ).toBe(400);

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u@unita.com.br', password: 'NovaSenha2026' },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('users — administration', () => {
  it('lets an ADMIN promote a VIEWER and blocks non-admins', async () => {
    const admin = await registerUser(ctx.app, 'admin@unita.com.br');
    const viewer = await registerUser(ctx.app, 'viewer@unita.com.br');
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: auth(viewer.token),
    });
    expect(forbidden.statusCode).toBe(403);

    const promote = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${viewer.body.user.id}`,
      headers: auth(admin.token),
      payload: { role: 'EDITOR' },
    });
    expect(promote.json().role).toBe('EDITOR');
  });
});

describe('security — rate limiting', () => {
  it('limits brute force on login', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'x@unita.com.br', password: 'errada123456' },
        });
      for (let i = 0; i < 3; i += 1) expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await closeTestApp(limited);
    }
  });
});
