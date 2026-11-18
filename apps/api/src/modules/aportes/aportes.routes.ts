import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { aportesDto, errorResponse } from '@unita/contracts';
import { APORTES_SHEETS, parseAportes } from '../../integrations/microsoft-graph/aportes.parser.js';
import { SheetLayoutError } from '../../integrations/microsoft-graph/fisico-geral.parser.js';
import { GraphError } from '../../integrations/microsoft-graph/graph-client.js';
import { graphClientFromEnv } from '../../integrations/microsoft-graph/graph-work-curve-provider.js';
import { requireRole } from '../../middleware/auth.js';
import { AppError } from '../../utils/errors.js';

/** Today in São Paulo as `AAAA-MM-DD` (the cut-off of "aportes até hoje"). */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** "Aportes": contributions up to today, read live from "BD´s_JOY_EVANS.xlsx" (SharePoint). */
export const aportesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags: ['aportes'],
        security: [{ bearerAuth: [] }],
        summary: 'Aportes até hoje: Joy+ (transferências) e investidores (Recebidas)',
        response: {
          200: aportesDto,
          401: errorResponse,
          422: errorResponse,
          502: errorResponse,
        },
      },
    },
    async () => {
      const g = app.deps.env.graph;
      const client = graphClientFromEnv(app.deps.env);
      if (!g || !client)
        throw new AppError(
          422,
          'INTEGRATION_NOT_CONFIGURED',
          'Integração com o Microsoft Graph não configurada (variáveis MS_GRAPH_*).',
        );
      try {
        const [receipts, transfers] = await Promise.all([
          client.worksheetValues(g.driveId, g.aportesItemId, APORTES_SHEETS.receipts),
          client.worksheetValues(g.driveId, g.aportesItemId, APORTES_SHEETS.transfers),
        ]);
        return { ...parseAportes(receipts, transfers, today()), readAt: new Date().toISOString() };
      } catch (err) {
        if (err instanceof SheetLayoutError)
          throw new AppError(422, 'SHEET_LAYOUT', err.message, err.missing);
        if (err instanceof GraphError)
          throw new AppError(502, 'INTEGRATION_UNAVAILABLE', err.message);
        throw err;
      }
    },
  );
};
