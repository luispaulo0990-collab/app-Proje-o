import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  curveSyncBody,
  curveSyncReportDto,
  errorResponse,
  integrationStatusDto,
} from '@unita/contracts';
import { SheetLayoutError } from '../../integrations/microsoft-graph/fisico-geral.parser.js';
import { GraphError } from '../../integrations/microsoft-graph/graph-client.js';
import {
  graphEconomicProviderFromEnv,
  graphProviderFromEnv,
} from '../../integrations/microsoft-graph/graph-work-curve-provider.js';
import type {
  EconomicIndicatorProvider,
  WorkCurveProvider,
} from '../../integrations/work-curve-provider.js';
import { currentActor, requireRole, requireRoleOrApiKey } from '../../middleware/auth.js';
import { AppError } from '../../utils/errors.js';
import { createCurveSyncService } from './curve-sync.service.js';

export interface IntegrationsRoutesOptions {
  /** Test seam: replaces the provider built from the environment. */
  provider?: WorkCurveProvider | null;
  /** Test seam: replaces the "BD_Econômico" provider built from the environment. */
  economicProvider?: EconomicIndicatorProvider | null;
}

const security: Record<string, string[]>[] = [{ bearerAuth: [] }, { integrationKey: [] }];

export const integrationsRoutes: FastifyPluginAsyncZod<IntegrationsRoutesOptions> = async (
  app,
  opts,
) => {
  const provider = opts.provider !== undefined ? opts.provider : graphProviderFromEnv(app.deps.env);
  const economicProvider =
    opts.economicProvider !== undefined
      ? opts.economicProvider
      : graphEconomicProviderFromEnv(app.deps.env);
  const service = createCurveSyncService(app.deps);

  app.get(
    '/status',
    {
      preHandler: requireRole('VIEWER'),
      schema: {
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
        summary: 'Integrações configuradas',
        response: { 200: integrationStatusDto, 401: errorResponse },
      },
    },
    async () => ({
      microsoftGraph: { configured: Boolean(provider), description: provider?.description ?? null },
    }),
  );

  app.post(
    '/work-curves/sync',
    {
      preHandler: requireRoleOrApiKey('EDITOR'),
      schema: {
        tags: ['integrations'],
        security,
        summary: 'Importa as curvas próprias da planilha BD_Infos Gerais (SharePoint)',
        description:
          'Lê a coluna "Replanejado Atual Acumulado - Obra" por obra e mês, casa pelo nome da ' +
          'obra cadastrado e cria nova versão da curva própria quando ela mudou. Na mesma execução ' +
          'lê o "IEC Obra" da aba BD_Econômico (linha "Geral"). `dryRun` só simula.',
        body: curveSyncBody,
        response: {
          200: curveSyncReportDto,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          502: errorResponse,
        },
      },
    },
    async (req) => {
      if (!provider)
        throw new AppError(
          422,
          'INTEGRATION_NOT_CONFIGURED',
          'Integração com o Microsoft Graph não configurada (variáveis MS_GRAPH_*).',
        );
      try {
        return await service.sync(provider, currentActor(req), {
          dryRun: req.body.dryRun,
          economicProvider,
        });
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
