import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  actualCurveBody,
  actualCurveStateDto,
  errorResponse,
  idParams,
  importActualCurveResponse,
  syncWorkCurvesResponse,
  workCurvesQuery,
  workCurvesResponse,
} from '@unita/contracts';
import { currentActor, requireRole, requireRoleOrApiKey } from '../../middleware/auth.js';
import { createWorkCurvesService } from './work-curves.service.js';

const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  422: errorResponse,
};
const bearer: Record<string, string[]>[] = [{ bearerAuth: [] }];
const bearerOrKey: Record<string, string[]>[] = [{ bearerAuth: [] }, { integrationKey: [] }];

/** Own curve of one work — mounted under /works/:id/actual-curve. */
export const actualCurveRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createWorkCurvesService(app.deps);
  const tags = ['work-curves'];

  app.get(
    '/:id/actual-curve',
    {
      preHandler: requireRoleOrApiKey('VIEWER'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Curva própria da obra (versão atual, histórico e curva em vigor)',
        params: idParams,
        response: { 200: actualCurveStateDto, ...errors },
      },
    },
    async (req) => service.getActualCurve(req.params.id),
  );

  app.put(
    '/:id/actual-curve',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Recebe a curva própria da obra (integração ERP/planejamento) — nova versão',
        description:
          'Envie `points` (período 1..n a partir de `startMonth`) ou `months` (AAAA-MM). ' +
          'Percentuais em fração (0.035 = 3,5%). Se a obra já iniciou, a projeção é recalculada ' +
          '(ou marcada para revisão quando houver ajustes manuais).',
        params: idParams,
        body: actualCurveBody,
        response: { 200: importActualCurveResponse, ...errors },
      },
    },
    async (req) => service.importActualCurve(req.params.id, req.body, currentActor(req)),
  );
};

/** Portfolio-wide "Curvas das obras" — mounted under /work-curves. */
export const workCurvesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createWorkCurvesService(app.deps);
  const tags = ['work-curves'];

  app.get(
    '/',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security: bearer,
        summary: 'Curva em vigor de cada obra (paramétrica ou própria) no eixo mensal',
        querystring: workCurvesQuery,
        response: { 200: workCurvesResponse, ...errors },
      },
    },
    async (req) => service.list(req.query),
  );

  app.post(
    '/sync',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Recalcula projeções geradas com curva que não está mais em vigor',
        response: { 200: syncWorkCurvesResponse, ...errors },
      },
    },
    async (req) => service.sync(currentActor(req)),
  );
};
