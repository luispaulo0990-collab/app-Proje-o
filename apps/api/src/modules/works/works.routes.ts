import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  auditListQuery,
  auditListResponse,
  clientListResponse,
  errorResponse,
  idParams,
  workBody,
  workDto,
  workListQuery,
  workListResponse,
} from '@unita/contracts';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { createProjectionsService } from '../projections/projections.service.js';
import { createWorksService } from './works.service.js';

export const worksRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createWorksService(app.deps);
  const projections = createProjectionsService(app.deps);
  const tags = ['works'];
  const security = [{ bearerAuth: [] }];
  const errors = {
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  };

  app.get(
    '/',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Lista obras (paginada)',
        querystring: workListQuery,
        response: { 200: workListResponse },
      },
    },
    async (req) => service.list(req.query),
  );

  app.post(
    '/',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Cria obra e gera a projeção V1',
        body: workBody,
        response: { 201: workDto, ...errors },
      },
    },
    async (req, reply) => reply.status(201).send(await service.create(req.body, currentUser(req))),
  );

  app.get(
    '/:id',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Detalhe da obra',
        params: idParams,
        response: { 200: workDto, ...errors },
      },
    },
    async (req) => service.get(req.params.id),
  );

  app.put(
    '/:id',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Atualiza obra',
        params: idParams,
        body: workBody,
        response: { 200: workDto, ...errors },
      },
    },
    async (req) => service.update(req.params.id, req.body, currentUser(req)),
  );

  app.delete(
    '/:id',
    {
      preHandler: requireRole('ADMIN'),
      schema: {
        tags,
        security,
        summary: 'Exclui obra sem ajustes manuais',
        params: idParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (req, reply) => {
      await service.remove(req.params.id, currentUser(req));
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/:id/duplicate',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Duplica obra (rascunho)',
        params: idParams,
        response: { 201: workDto, ...errors },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await service.duplicate(req.params.id, currentUser(req))),
  );

  app.post(
    '/:id/archive',
    {
      preHandler: requireRole('EDITOR'),
      schema: {
        tags,
        security,
        summary: 'Arquiva obra',
        params: idParams,
        response: { 200: workDto, ...errors },
      },
    },
    async (req) => service.archive(req.params.id, currentUser(req)),
  );

  app.get(
    '/:id/audit',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags,
        security,
        summary: 'Histórico de alterações da obra',
        params: idParams,
        querystring: auditListQuery,
        response: { 200: auditListResponse, ...errors },
      },
    },
    async (req) => projections.audit(req.params.id, req.query.page, req.query.pageSize),
  );
};

export const clientsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createWorksService(app.deps);
  app.get(
    '/',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags: ['works'],
        security: [{ bearerAuth: [] }],
        summary: 'Clientes (autocomplete)',
        response: { 200: clientListResponse },
      },
    },
    async () => ({ items: await service.listClients() }),
  );
};
