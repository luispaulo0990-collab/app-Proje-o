import type { Env } from '../../config/env.js';
import type { EconomicIndicatorProvider, WorkCurveProvider } from '../work-curve-provider.js';
import {
  DEFAULT_ECONOMICO_COLUMNS,
  parseEconomico,
  type EconomicoColumns,
} from './economico.parser.js';
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

export interface GraphEconomicConfig {
  driveId: string;
  itemId: string;
  sheet: string;
  columns: EconomicoColumns;
  totalItem: string;
}

/** Adapter: "IEC Obra" / "Resultado Projetado Obra" from the "BD_Econômico" sheet (row "Geral"). */
export class GraphEconomicProvider implements EconomicIndicatorProvider {
  readonly source = 'BD_ECONOMICO';

  constructor(
    private readonly client: GraphClient,
    private readonly config: GraphEconomicConfig,
  ) {}

  get description(): string {
    return `SharePoint · aba "${this.config.sheet}" · coluna "${this.config.columns.iec}" (item "${this.config.totalItem}")`;
  }

  async fetchEconomic() {
    const { driveId, itemId, sheet, columns, totalItem } = this.config;
    const rows = await this.client.worksheetValues(driveId, itemId, sheet);
    const { series, issues } = parseEconomico(rows, columns, totalItem);
    return { series, issues };
  }
}

/** One client (and one cached token) per environment and fetch implementation. */
const clients = new WeakMap<Env, Map<typeof fetch | undefined, GraphClient>>();

function graphClientFromEnv(env: Env, fetchImpl?: typeof fetch): GraphClient | null {
  const g = env.graph;
  if (!g) return null;
  const byFetch = clients.get(env) ?? new Map<typeof fetch | undefined, GraphClient>();
  clients.set(env, byFetch);
  const existing = byFetch.get(fetchImpl);
  if (existing) return existing;
  const client = new GraphClient(
    { tenantId: g.tenantId, clientId: g.clientId, clientSecret: g.clientSecret },
    fetchImpl,
  );
  byFetch.set(fetchImpl, client);
  return client;
}

/** Builds the economic provider from the environment (null when not configured). */
export function graphEconomicProviderFromEnv(
  env: Env,
  fetchImpl?: typeof fetch,
): GraphEconomicProvider | null {
  const g = env.graph;
  const client = graphClientFromEnv(env, fetchImpl);
  if (!g?.economic || !client) return null;
  return new GraphEconomicProvider(client, {
    driveId: g.driveId,
    itemId: g.itemId,
    sheet: g.economic.sheet,
    columns: {
      ...DEFAULT_ECONOMICO_COLUMNS,
      iec: g.economic.iecColumn,
      projectedResult: g.economic.projectedResultColumn,
    },
    totalItem: g.economic.totalItem,
  });
}

/** Builds the provider from the environment, or null when the integration is not configured. */
export function graphProviderFromEnv(
  env: Env,
  fetchImpl?: typeof fetch,
): GraphWorkCurveProvider | null {
  const g = env.graph;
  const client = graphClientFromEnv(env, fetchImpl);
  if (!g || !client) return null;
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
