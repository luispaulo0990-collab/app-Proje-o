import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { consolidatedDto, consolidatedQuery, errorResponse } from '@unita/contracts';
import { requireRole } from '../../middleware/auth.js';
import { createPortfolioService } from './portfolio.service.js';

export const portfolioRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createPortfolioService(app.deps);

  app.get(
    '/consolidated',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags: ['portfolio'],
        security: [{ bearerAuth: [] }],
        summary: 'Consolidado da carteira: taxa mensal, acumulados e recebido × a receber',
        querystring: consolidatedQuery,
        response: { 200: consolidatedDto, 400: errorResponse, 401: errorResponse },
      },
    },
    async (req) => service.consolidated(req.query),
  );
};
