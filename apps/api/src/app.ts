import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from './config/env.js';
import type { Database } from './database/client.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { JwtService } from './modules/auth/jwt.js';
import { curvesRoutes } from './modules/curves/curves.routes.js';
import { integrationsRoutes } from './modules/integrations/integrations.routes.js';
import { consolidatedInputsRoutes } from './modules/portfolio/consolidated-inputs.routes.js';
import { portfolioRoutes } from './modules/portfolio/portfolio.routes.js';
import { projectionsRoutes } from './modules/projections/projections.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { actualCurveRoutes, workCurvesRoutes } from './modules/work-curves/work-curves.routes.js';
import { clientsRoutes, worksRoutes } from './modules/works/works.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import type { WorkCurveProvider } from './integrations/work-curve-provider.js';
import { createMailer, type Mailer } from './services/mailer.js';

export interface BuildAppOptions {
  env: Env;
  db: Database;
  mailer?: Mailer;
  /** Test seam for the own-curves integration (defaults to Microsoft Graph from env). */
  workCurveProvider?: WorkCurveProvider | null;
}

/** Composition root: wires infrastructure, security plugins and versioned routes. */
export async function buildApp({
  env,
  db,
  mailer,
  workCurveProvider,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      // Never log credentials or tokens.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordConfirmation',
          '*.token',
          '*.accessToken',
          '*.client_secret',
        ],
        censor: '[REDACTED]',
      },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('deps', {
    env,
    db,
    jwt: new JwtService(env.AUTH_SECRET, env.ACCESS_TOKEN_TTL_MINUTES * 60),
    mailer: mailer ?? createMailer(env, app.log),
  });

  registerErrorHandler(app, { spaFallback: Boolean(env.SERVE_WEB_DIR) });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Swagger UI needs inline styles/scripts on /api/docs only.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Painel de Obras Unità — API',
        version: '1.0.0',
        description: 'Projeção físico-financeira de obras. Valores decimais trafegam como string.',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          integrationKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // Single-process mode (demo): the API also serves the compiled web app.
  if (env.SERVE_WEB_DIR) {
    await app.register(fastifyStatic, { root: env.SERVE_WEB_DIR, wildcard: false });
  }

  await app.register(
    async (v1) => {
      v1.get(
        '/health',
        {
          schema: {
            tags: ['health'],
            response: { 200: z.object({ status: z.literal('ok'), database: z.boolean() }) },
          },
        },
        async () => {
          const database = await db
            .execute(sql`select 1`)
            .then(() => true)
            .catch(() => false);
          return { status: 'ok' as const, database };
        },
      );
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(usersRoutes, { prefix: '/users' });
      await v1.register(clientsRoutes, { prefix: '/clients' });
      await v1.register(worksRoutes, { prefix: '/works' });
      await v1.register(actualCurveRoutes, { prefix: '/works' });
      await v1.register(consolidatedInputsRoutes, { prefix: '/works' });
      await v1.register(workCurvesRoutes, { prefix: '/work-curves' });
      await v1.register(portfolioRoutes, { prefix: '/portfolio' });
      await v1.register(integrationsRoutes, {
        prefix: '/integrations',
        ...(workCurveProvider !== undefined ? { provider: workCurveProvider } : {}),
      });
      await v1.register(curvesRoutes, { prefix: '/curves' });
      await v1.register(projectionsRoutes, { prefix: '/projections' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
