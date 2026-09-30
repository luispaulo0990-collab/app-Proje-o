import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  calculateBody,
  calculateImpactDto,
  errorResponse,
  projectionDto,
  projectionQuery,
  projectionVersionDto,
  updateProjectionBody,
  workIdParams,
} from '@unita/contracts';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { createProjectionsService } from './projections.service.js';

export const projectionsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createProjectionsService(app.deps);
  const tags = ['projections'];
  const security = [{ bearerAuth: [] }];
  const errors = {
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    422: errorResponse,
  };

  app.get(
    '/:workId',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Projeção corrente com KPIs',
        params: workIdParams,
        querystring: projectionQuery,
        response: { 200: projectionDto, ...errors },
      },
    },
    async (req) => service.getCurrent(req.params.workId, req.query.referenceDate),
  );

  app.post(
    '/:workId/calculate',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Recalcula pela curva (dryRun informa ajustes manuais afetados)',
        params: workIdParams,
        body: calculateBody,
        response: { 200: z.union([calculateImpactDto, projectionDto]), ...errors },
      },
    },
    async (req) => service.calculate(req.params.workId, req.body, currentUser(req)),
  );

  app.put(
    '/:workId',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Ajustes manuais de células (nova versão)',
        params: workIdParams,
        body: updateProjectionBody,
        response: { 200: projectionDto, ...errors },
      },
    },
    async (req) => service.update(req.params.workId, req.body, currentUser(req)),
  );

  app.get(
    '/:workId/versions',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Histórico de versões',
        params: workIdParams,
        response: { 200: z.array(projectionVersionDto), ...errors },
      },
    },
    async (req) => service.versions(req.params.workId),
  );
};
