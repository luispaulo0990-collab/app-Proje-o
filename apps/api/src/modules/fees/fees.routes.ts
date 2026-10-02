import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  errorResponse,
  feeIssuanceBody,
  feeIssuanceListResponse,
  feeIssuanceResponse,
  idParams,
  inccIndexBatchBody,
  inccIndexBatchResponse,
  inccIndexBody,
  inccIndexListResponse,
  inccIndexResponse,
  monthParams,
} from '@unita/contracts';
import { currentActor, requireRoleOrApiKey } from '../../middleware/auth.js';
import { createFeesService } from './fees.service.js';

const errors = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  422: errorResponse,
};
const security: Record<string, string[]>[] = [{ bearerAuth: [] }, { integrationKey: [] }];
const tags = ['fees'];
const workMonthParams = idParams.extend(monthParams.shape);

/** "Taxa emitida" of a work — mounted under /works. */
export const feeIssuancesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createFeesService(app.deps);

  app.get(
    '/:id/fee-issuances',
    {
      preHandler: requireRoleOrApiKey('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Taxas emitidas da obra, mês a mês',
        params: idParams,
        response: { 200: feeIssuanceListResponse, ...errors },
      },
    },
    async (req) => service.listIssuances(req.params.id),
  );

  app.put(
    '/:id/fee-issuances/:month',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Informa a taxa emitida no mês (competência M−1)',
        description:
          'O valor emitido substitui a projeção do mês; o saldo corrigido pelo INCC é ' +
          'projetado pela curva física nos meses seguintes. Gera nova versão da projeção.',
        params: workMonthParams,
        body: feeIssuanceBody,
        response: { 200: feeIssuanceResponse, ...errors },
      },
    },
    async (req) =>
      service.setIssuance(req.params.id, req.params.month, req.body, currentActor(req)),
  );

  app.delete(
    '/:id/fee-issuances/:month',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Remove a taxa emitida do mês',
        params: workMonthParams,
        response: { 200: feeIssuanceResponse, ...errors },
      },
    },
    async (req) => service.deleteIssuance(req.params.id, req.params.month, currentActor(req)),
  );
};

/** Monthly INCC number-index (global) — mounted under /incc-indices. */
export const inccIndicesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createFeesService(app.deps);

  app.get(
    '/',
    {
      preHandler: requireRoleOrApiKey('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Números-índice mensais do INCC (com a variação calculada pelo motor)',
        response: { 200: inccIndexListResponse, ...errors },
      },
    },
    async () => service.listIncc(),
  );

  app.put(
    '/',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Grava vários meses do INCC de uma vez (histórico / colar do Excel)',
        description:
          'Meses já cadastrados são sobrescritos. As obras com taxa emitida são recalculadas uma vez.',
        body: inccIndexBatchBody,
        response: { 200: inccIndexBatchResponse, ...errors },
      },
    },
    async (req) => service.setInccBatch(req.body, currentActor(req)),
  );

  app.put(
    '/:month',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Cadastra o número-índice do INCC do mês (ex.: 1296.889)',
        description:
          'A variação do mês M (índice M ÷ índice M−1 − 1) corrige o saldo de taxa a receber a ' +
          'partir de M+1. As projeções das obras com taxa emitida são recalculadas.',
        params: monthParams,
        body: inccIndexBody,
        response: { 200: inccIndexResponse, ...errors },
      },
    },
    async (req) => service.setIncc(req.params.month, req.body, currentActor(req)),
  );

  app.delete(
    '/:month',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Remove o INCC do mês',
        params: monthParams,
        response: { 200: inccIndexResponse, ...errors },
      },
    },
    async (req) => service.deleteIncc(req.params.month, currentActor(req)),
  );
};
