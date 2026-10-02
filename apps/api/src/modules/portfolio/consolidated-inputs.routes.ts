import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  economicIndicatorsBody,
  economicIndicatorsDto,
  errorResponse,
  idParams,
  progressIndicatorsBody,
  progressIndicatorsDto,
} from '@unita/contracts';
import { currentActor, requireRoleOrApiKey } from '../../middleware/auth.js';
import { createConsolidatedInputsService } from './consolidated-inputs.service.js';

const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  422: errorResponse,
};
const bearerOrKey: Record<string, string[]>[] = [{ bearerAuth: [] }, { integrationKey: [] }];

/** Inputs of the "Consolidado" for one work — mounted under /works/:id. */
export const consolidatedInputsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createConsolidatedInputsService(app.deps);
  const tags = ['portfolio'];

  app.get(
    '/:id/progress-indicators',
    {
      preHandler: requireRoleOrApiKey('VIEWER'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Indicadores de avanço da obra (realizado, replanejado cliente, meta)',
        params: idParams,
        response: { 200: progressIndicatorsDto, ...errors },
      },
    },
    async (req) => service.getProgress(req.params.id),
  );

  app.put(
    '/:id/progress-indicators',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Recebe os indicadores de avanço mensais da obra (substitui o histórico)',
        description:
          'Frações (0.169 = 16,9%). `realizedCumulative` = "Realizado Acumulado"; ' +
          '`clientReplannedCumulative` = "Replanejado Atual Acumulado - Cliente"; ' +
          '`targetCumulative` = "Meta Acumulada - Atual". Status cliente = ATRASADA quando ' +
          'replanejado cliente < meta no mês de referência.',
        params: idParams,
        body: progressIndicatorsBody,
        response: { 200: progressIndicatorsDto, ...errors },
      },
    },
    async (req) => service.putProgress(req.params.id, req.body, currentActor(req)),
  );

  app.get(
    '/:id/economic-indicators',
    {
      preHandler: requireRoleOrApiKey('VIEWER'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Fechamentos econômicos da obra (IEC Obra, resultado projetado)',
        params: idParams,
        response: { 200: economicIndicatorsDto, ...errors },
      },
    },
    async (req) => service.getEconomic(req.params.id),
  );

  app.put(
    '/:id/economic-indicators',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security: bearerOrKey,
        summary: 'Recebe os fechamentos econômicos mensais da obra (substitui o histórico)',
        description:
          '`iec` = "IEC Obra" (1.02 = 102%); `projectedResult` = "Resultado Projetado Obra" em R$ ' +
          '(negativo = prejuízo). O Consolidado mostra o último fechamento até o mês de referência; ' +
          'IEC 0 é tratado como "sem fechamento".',
        params: idParams,
        body: economicIndicatorsBody,
        response: { 200: economicIndicatorsDto, ...errors },
      },
    },
    async (req) => service.putEconomic(req.params.id, req.body, currentActor(req)),
  );
};
