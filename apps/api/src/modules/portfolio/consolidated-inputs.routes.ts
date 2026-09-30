import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  errorResponse,
  feeRecalibrationBody,
  feeRecalibrationResponse,
  idParams,
  progressIndicatorsBody,
  progressIndicatorsDto,
} from '@unita/contracts';
import {
  currentActor,
  currentUser,
  requireRole,
  requireRoleOrApiKey,
} from '../../middleware/auth.js';
import { createConsolidatedInputsService } from './consolidated-inputs.service.js';

const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  422: errorResponse,
};
const bearer: Record<string, string[]>[] = [{ bearerAuth: [] }];
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

  app.put(
    '/:id/fee-recalibration',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security: bearer,
        summary: 'Ajuste projeção de taxa: novo total a receber após o mês de referência',
        description:
          'O valor é distribuído pela curva nos meses seguintes ao mês de referência; ' +
          'gera nova versão da projeção preservando ajustes manuais.',
        params: idParams,
        body: feeRecalibrationBody,
        response: { 200: feeRecalibrationResponse, ...errors },
      },
    },
    async (req) => service.setRecalibration(req.params.id, req.body, currentUser(req)),
  );

  app.delete(
    '/:id/fee-recalibration',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security: bearer,
        summary: 'Remove o ajuste de taxa (volta a orçamento × taxa pela curva)',
        params: idParams,
        response: { 200: feeRecalibrationResponse, ...errors },
      },
    },
    async (req) => service.clearRecalibration(req.params.id, currentUser(req)),
  );
};
