import type { Env } from '../../config/env.js';
import type { WorkCurveProvider } from '../work-curve-provider.js';
import {
  DEFAULT_FISICO_GERAL_COLUMNS,
  parseFisicoGeral,
  type FisicoGeralColumns,
} from './fisico-geral.parser.js';
import { GraphClient } from './graph-client.js';

export interface GraphWorkbookConfig {
  driveId: string;
  itemId: string;
  sheet: string;
  columns: FisicoGeralColumns;
}

/**
 * Adapter: reads the "BD_Infos Gerais" sheet of "Consolidado Físico - Obras.xlsx" (SharePoint)
 * through Microsoft Graph. Only this sheet is used — "BD_Físico por atividade" (per activity)
 * and "BD_Orc" (budget, not validated yet) are deliberately ignored.
 */
export class GraphWorkCurveProvider implements WorkCurveProvider {
  readonly source = 'BD_FISICO_GERAL';

  constructor(
    private readonly client: GraphClient,
    private readonly config: GraphWorkbookConfig,
  ) {}

  get description(): string {
    return `SharePoint · aba "${this.config.sheet}" · coluna "${this.config.columns.cumulative}"`;
  }

  async fetchCurves() {
    const { driveId, itemId, sheet, columns } = this.config;
    const rows = await this.client.worksheetValues(driveId, itemId, sheet);
    const { curves, issues, missingOptionalColumns, headerRow } = parseFisicoGeral(rows, columns);
    const columnIssues = missingOptionalColumns.map((name) => ({
      row: headerRow,
      message: `Coluna "${name}" não encontrada — o Consolidado ficará sem esse dado.`,
    }));
    return { curves, issues: [...columnIssues, ...issues] };
  }
}

/** Builds the provider from the environment, or null when the integration is not configured. */
export function graphProviderFromEnv(
  env: Env,
  fetchImpl?: typeof fetch,
): GraphWorkCurveProvider | null {
  const g = env.graph;
  if (!g) return null;
  const client = new GraphClient(
    { tenantId: g.tenantId, clientId: g.clientId, clientSecret: g.clientSecret },
    fetchImpl,
  );
  return new GraphWorkCurveProvider(client, {
    driveId: g.driveId,
    itemId: g.itemId,
    sheet: g.sheet,
    columns: {
      ...DEFAULT_FISICO_GERAL_COLUMNS,
      cumulative: g.cumulativeColumn,
      realized: g.realizedColumn,
      clientReplanned: g.clientReplannedColumn,
      target: g.targetColumn,
    },
  });
}
