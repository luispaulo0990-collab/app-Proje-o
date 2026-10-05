import type {
  AuthResponse,
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  UserDto,
} from '@unita/contracts';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import { tokensRepository } from '../../database/repositories/tokens.repository.js';
import { usersRepository, type UserRow } from '../../database/repositories/users.repository.js';
import type { AppDeps } from '../../types.js';
import type { SupabaseIdentity } from './supabase-auth.js';
import { AppError, conflict, forbidden, unauthorized } from '../../utils/errors.js';
import {
  generateOpaqueToken,
  getDummyHash,
  hashPassword,
  sha256,
  verifyPassword,
} from './crypto.js';

export interface SessionResult {
  response: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  };
}

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';

export const SUPABASE_MANAGED =
  'Os usuários são criados pelo administrador no Supabase (Authentication → Users).';

export function createAuthService({ db, env, jwt, mailer, supabaseAuth }: AppDeps) {
  const refreshTtlMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  async function openSession(user: UserRow, userAgent?: string): Promise<SessionResult> {
    const { token, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + refreshTtlMs);
    await tokensRepository.createRefresh(db, {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: userAgent ?? null,
    });
    const accessToken = await jwt.sign({ sub: user.id, role: user.role, name: user.name });
    return {
      response: { accessToken, expiresIn: jwt.expiresIn, user: toUserDto(user) },
      refreshToken: token,
      refreshExpiresAt: expiresAt,
    };
  }

  /**
   * Profile/role of a Supabase identity: linked by auth id, then by e-mail (users that existed
   * before Supabase Auth); created as VIEWER when missing (the database trigger normally does it).
   */
  async function profileFor(identity: SupabaseIdentity): Promise<UserRow> {
    const linked = await usersRepository.findByAuthUserId(db, identity.id);
    if (linked) return linked;
    const byEmail = await usersRepository.findByEmail(db, identity.email);
    if (byEmail) {
      const row = await usersRepository.update(db, byEmail.id, { authUserId: identity.id });
      return row ?? byEmail;
    }
    const user = await usersRepository.create(db, {
      name: identity.name ?? identity.email.split('@')[0] ?? identity.email,
      email: identity.email,
      passwordHash: null,
      role: 'VIEWER',
      authUserId: identity.id,
    });
    await auditRepository.insert(db, {
      userId: user.id,
      action: 'REGISTER',
      entity: 'user',
      entityId: user.id,
      newValue: 'VIEWER',
      origin: 'SUPABASE_AUTH',
    });
    return user;
  }

  return {
    /** Who checks passwords; the web hides "Criar conta" when registration is closed. */
    async config(): Promise<{ provider: 'local' | 'supabase'; registrationEnabled: boolean }> {
      if (supabaseAuth) return { provider: 'supabase', registrationEnabled: false };
      const open = env.ALLOW_PUBLIC_REGISTRATION || (await usersRepository.count(db)) === 0;
      return { provider: 'local', registrationEnabled: open };
    },

    async register(input: RegisterBody, userAgent?: string): Promise<SessionResult> {
      if (supabaseAuth) throw forbidden(SUPABASE_MANAGED);
      const total = await usersRepository.count(db);
      if (total > 0 && !env.ALLOW_PUBLIC_REGISTRATION) {
        throw forbidden('O cadastro público está desativado. Solicite acesso a um administrador.');
      }
      if (await usersRepository.findByEmail(db, input.email))
        throw conflict('Já existe um usuário com este e-mail.');
      // First user bootstraps the system as ADMIN; others start as VIEWER until promoted.
      const role = total === 0 ? 'ADMIN' : 'VIEWER';
      const user = await usersRepository.create(db, {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role,
      });
      await auditRepository.insert(db, {
        userId: user.id,
        action: 'REGISTER',
        entity: 'user',
        entityId: user.id,
        newValue: role,
      });
      return openSession(user, userAgent);
    },

    async login(input: LoginBody, userAgent?: string): Promise<SessionResult> {
      if (supabaseAuth) {
        const identity = await supabaseAuth.signInWithPassword(input.email, input.password);
        if (!identity) throw unauthorized(INVALID_CREDENTIALS);
        const profile = await profileFor(identity);
        if (!profile.isActive) throw forbidden('Usuário desativado.');
        await usersRepository.update(db, profile.id, { lastLoginAt: new Date() });
        return openSession(profile, userAgent);
      }
      const user = await usersRepository.findByEmail(db, input.email);
      if (!user) {
        await verifyPassword(await getDummyHash(), input.password); // timing equalisation
        throw unauthorized(INVALID_CREDENTIALS);
      }
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.password)))
        throw unauthorized(INVALID_CREDENTIALS);
      if (!user.isActive) throw forbidden('Usuário desativado.');
      await usersRepository.update(db, user.id, { lastLoginAt: new Date() });
      return openSession(user, userAgent);
    },

    /** Rotates the refresh token. Reuse of a revoked token revokes every session of the user. */
    async refresh(token: string | undefined, userAgent?: string): Promise<SessionResult> {
      if (!token) throw unauthorized('Sessão expirada.');
      const stored = await tokensRepository.findRefreshByHash(db, sha256(token));
      if (!stored) throw unauthorized('Sessão expirada.');
      if (stored.revokedAt) {
        await tokensRepository.revokeAllForUser(db, stored.userId);
        throw unauthorized('Sessão revogada. Faça login novamente.');
      }
      if (stored.expiresAt.getTime() <= Date.now()) throw unauthorized('Sessão expirada.');
      const user = await usersRepository.findById(db, stored.userId);
      if (!user?.isActive) throw unauthorized('Sessão expirada.');

      return db.transaction(async (tx) => {
        const { token: next, tokenHash } = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + refreshTtlMs);
        const created = await tokensRepository.createRefresh(tx, {
          userId: user.id,
          tokenHash,
          expiresAt,
          userAgent: userAgent ?? null,
        });
        await tokensRepository.revokeRefresh(tx, stored.id, created.id);
        const accessToken = await jwt.sign({ sub: user.id, role: user.role, name: user.name });
        return {
          response: { accessToken, expiresIn: jwt.expiresIn, user: toUserDto(user) },
          refreshToken: next,
          refreshExpiresAt: expiresAt,
        };
      });
    },

    async logout(token: string | undefined): Promise<void> {
      if (!token) return;
      const stored = await tokensRepository.findRefreshByHash(db, sha256(token));
      if (stored) await tokensRepository.revokeRefresh(db, stored.id);
    },

    /** Always resolves (never reveals whether the e-mail exists). */
    async forgotPassword(input: ForgotPasswordBody): Promise<void> {
      if (supabaseAuth) {
        const redirect = new URL('/redefinir-senha', env.APP_URL).toString();
        await supabaseAuth.sendPasswordRecovery(input.email, redirect);
        return;
      }
      const user = await usersRepository.findByEmail(db, input.email);
      if (!user?.isActive) return;
      const { token, tokenHash } = generateOpaqueToken(32);
      const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
      await tokensRepository.createPasswordReset(db, { userId: user.id, tokenHash, expiresAt });
      const url = new URL('/redefinir-senha', env.APP_URL);
      url.searchParams.set('token', token);
      await mailer.sendPasswordReset(user.email, user.name, url.toString());
    },

    async resetPassword(input: ResetPasswordBody): Promise<void> {
      if (supabaseAuth) {
        // input.token = access token from the Supabase recovery/invite link.
        const identity = await supabaseAuth.updatePassword(input.token, input.password);
        const profile = await profileFor(identity);
        await db.transaction(async (tx) => {
          await tokensRepository.revokeAllForUser(tx, profile.id);
          await auditRepository.insert(tx, {
            userId: profile.id,
            action: 'PASSWORD_RESET',
            entity: 'user',
            entityId: profile.id,
            origin: 'SUPABASE_AUTH',
          });
        });
        return;
      }
      const stored = await tokensRepository.findPasswordReset(db, sha256(input.token));
      if (!stored || stored.usedAt || stored.expiresAt.getTime() <= Date.now()) {
        throw new AppError(400, 'INVALID_TOKEN', 'Link de redefinição inválido ou expirado.');
      }
      await db.transaction(async (tx) => {
        await usersRepository.update(tx, stored.userId, {
          passwordHash: await hashPassword(input.password),
        });
        await tokensRepository.markPasswordResetUsed(tx, stored.id);
        await tokensRepository.revokeAllForUser(tx, stored.userId);
        await auditRepository.insert(tx, {
          userId: stored.userId,
          action: 'PASSWORD_RESET',
          entity: 'user',
          entityId: stored.userId,
        });
      });
    },

    async me(userId: string): Promise<UserDto> {
      const user = await usersRepository.findById(db, userId);
      if (!user?.isActive) throw unauthorized();
      return toUserDto(user);
    },
  };
}
