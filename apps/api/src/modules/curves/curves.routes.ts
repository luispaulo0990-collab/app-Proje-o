import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createCurveBody,
  curveDetailDto,
  curveListQuery,
  curveListResponse,
  curveVersionDto,
  errorResponse,
  idParams,
  updateCurveBody,
  validateCurveBody,
  validateCurveResponse,
} from '@unita/contracts';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { createCurvesService } from './curves.service.js';

export const curvesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createCurvesService(app.deps);
  const tags = ['curves'];
  const security = [{ bearerAuth: [] }];
  const errors = {
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    422: errorResponse,
  };

  app.get(
    '/',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Lista curvas',
        querystring: curveListQuery,
        response: { 200: curveListResponse },
      },
    },
    async (req) => service.list(req.query),
  );

  app.post(
    '/',
    {
      preHandler: requireRole('ADMIN'),
      schema: {
        tags,
        security,
        summary: 'Cria curva (V1)',
        body: createCurveBody,
        response: { 201: curveDetailDto, ...errors },
      },
    },
    async (req, reply) => reply.status(201).send(await service.create(req.body, currentUser(req))),
  );

  app.post(
    '/validate',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Valida pontos sem salvar',
        body: validateCurveBody,
        response: { 200: validateCurveResponse },
      },
    },
    async (req) => service.validate(req.body.points),
  );

  app.get(
    '/:id',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Detalhe com versão atual',
        params: idParams,
        response: { 200: curveDetailDto, ...errors },
      },
    },
    async (req) => service.detail(req.params.id),
  );

  app.put(
    '/:id',
    {
      preHandler: requireRole('ADMIN'),
      schema: {
        tags,
        security,
        summary: 'Atualiza metadados; `points` cria nova versão',
        params: idParams,
        body: updateCurveBody,
        response: { 200: curveDetailDto, ...errors },
      },
    },
    async (req) => service.update(req.params.id, req.body, currentUser(req)),
  );

  app.get(
    '/:id/versions/:version',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Versão específica',
        params: idParams.extend({ version: z.coerce.number().int().min(1) }),
        response: { 200: curveVersionDto, ...errors },
      },
    },
    async (req) => service.getVersion(req.params.id, req.params.version),
  );
};
