import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  authResponse,
  errorResponse,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  userDto,
} from '@unita/contracts';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { createAuthService, type SessionResult } from './auth.service.js';

export const REFRESH_COOKIE = 'unita_rt';
const COOKIE_PATH = '/api/v1/auth';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createAuthService(app.deps);
  const { env } = app.deps;
  const authRateLimit = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  function setSession(reply: FastifyReply, session: SessionResult) {
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
    return session.response;
  }

  function clearSession(reply: FastifyReply) {
    reply.clearCookie(REFRESH_COOKIE, {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'strict',
    });
  }

  const tags = ['auth'];
  const errors = { 400: errorResponse, 401: errorResponse, 403: errorResponse, 409: errorResponse };

  app.post(
    '/register',
    {
      config: authRateLimit,
      schema: {
        tags,
        summary: 'Cadastro de usuário',
        body: registerBody,
        response: { 201: authResponse, ...errors },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(setSession(reply, await service.register(req.body, req.headers['user-agent']))),
  );

  app.post(
    '/login',
    {
      config: authRateLimit,
      schema: {
        tags,
        summary: 'Login',
        body: loginBody,
        response: { 200: authResponse, ...errors },
      },
    },
    async (req, reply) =>
      setSession(reply, await service.login(req.body, req.headers['user-agent'])),
  );

  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Renova a sessão (cookie HttpOnly)',
        response: { 200: authResponse, 401: errorResponse },
      },
    },
    async (req, reply) => {
      try {
        return setSession(
          reply,
          await service.refresh(req.cookies[REFRESH_COOKIE], req.headers['user-agent']),
        );
      } catch (err) {
        clearSession(reply);
        throw err;
      }
    },
  );

  app.post(
    '/logout',
    { schema: { tags, summary: 'Logout', response: { 204: z.null() } } },
    async (req, reply) => {
      await service.logout(req.cookies[REFRESH_COOKIE]);
      clearSession(reply);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/forgot-password',
    {
      config: authRateLimit,
      schema: {
        tags,
        summary: 'Solicita link de redefinição',
        body: forgotPasswordBody,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await service.forgotPassword(req.body);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/reset-password',
    {
      config: authRateLimit,
      schema: {
        tags,
        summary: 'Redefine a senha',
        body: resetPasswordBody,
        response: { 204: z.null(), 400: errorResponse },
      },
    },
    async (req, reply) => {
      await service.resetPassword(req.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me',
    {
      preHandler: requireRole(),
      schema: {
        tags,
        summary: 'Usuário autenticado',
        security: [{ bearerAuth: [] }],
        response: { 200: userDto, 401: errorResponse },
      },
    },
    async (req) => service.me(currentUser(req).id),
  );
};
