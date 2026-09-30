import type { ProgressEntry } from '@unita/engine';
import type { ExternalWorkCurve, ProviderReadIssue } from '../work-curve-provider.js';
import { normalizeWorkName } from '../work-curve-provider.js';
import { cellText, normalizeHeader, parseFractionCell, parseMonthCell } from './sheet-values.js';

/** Column names of the "BD_Infos Gerais" sheet (configurable through the environment). */
export interface FisicoGeralColumns {
  work: string;
  month: string;
  cumulative: string;
  externalRef?: string;
  client?: string;
  /** Optional progress columns shown in the Consolidado. */
  realized?: string;
  clientReplanned?: string;
  target?: string;
}

const INDICATOR_KEYS = ['realized', 'clientReplanned', 'target'] as const;
type IndicatorKey = (typeof INDICATOR_KEYS)[number];
const INDICATOR_FIELD: Record<
  IndicatorKey,
  'realizedCumulative' | 'clientReplannedCumulative' | 'targetCumulative'
> = {
  realized: 'realizedCumulative',
  clientReplanned: 'clientReplannedCumulative',
  target: 'targetCumulative',
};

export const DEFAULT_FISICO_GERAL_COLUMNS: FisicoGeralColumns = {
  work: 'Nome da Obra',
  month: 'Mês do Fechamento',
  // Decision (29/09/2026): the work's reality is the current replanning.
  cumulative: 'Replanejado Atual Acumulado - Obra',
  externalRef: 'Nº Obra UAU',
  client: 'Cliente',
  realized: 'Realizado Acumulado',
  clientReplanned: 'Replanejado Atual Acumulado - Cliente',
  target: 'Meta Acumulada - Atual',
};

export class SheetLayoutError extends Error {
  constructor(readonly missing: string[]) {
    super(`Colunas não encontradas na planilha: ${missing.join(', ')}.`);
    this.name = 'SheetLayoutError';
  }
}

/** Finds the header row (within the first 10 rows) and the index of each configured column. */
function locateColumns(rows: readonly unknown[][], columns: FisicoGeralColumns) {
  const wanted = Object.entries(columns).filter(([, v]) => Boolean(v)) as [
    keyof FisicoGeralColumns,
    string,
  ][];
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const headers = (rows[r] ?? []).map((c) => normalizeHeader(cellText(c)));
    const index = new Map(
      wanted.map(([key, name]) => [key, headers.indexOf(normalizeHeader(name))]),
    );
    if ((index.get('work') ?? -1) >= 0 && (index.get('month') ?? -1) >= 0) {
      const missing = wanted
        .filter(([key]) => key === 'work' || key === 'month' || key === 'cumulative')
        .filter(([key]) => (index.get(key) ?? -1) < 0)
        .map(([, name]) => name);
      if (missing.length > 0) throw new SheetLayoutError(missing);
      return { headerRow: r, index };
    }
  }
  throw new SheetLayoutError([columns.work, columns.month]);
}

/**
 * Turns the `usedRange.values` matrix of "BD_Infos Gerais" into one cumulative series per
 * work. Rows without work name or with empty cumulative are skipped silently; rows whose month
 * or cumulative cannot be read are reported with the raw value.
 */
export function parseFisicoGeral(
  rows: readonly unknown[][],
  columns: FisicoGeralColumns = DEFAULT_FISICO_GERAL_COLUMNS,
): {
  curves: ExternalWorkCurve[];
  issues: ProviderReadIssue[];
  /** Optional Consolidado columns absent from the sheet (reported by the provider). */
  missingOptionalColumns: string[];
  headerRow: number;
} {
  const { headerRow, index } = locateColumns(rows, columns);
  const at = (row: unknown[], key: keyof FisicoGeralColumns) => {
    const i = index.get(key) ?? -1;
    return i >= 0 ? row[i] : undefined;
  };
  const byWork = new Map<string, ExternalWorkCurve>();
  const indicatorsByWork = new Map<string, Map<string, ProgressEntry>>();
  const issues: ProviderReadIssue[] = [];
  const indicatorKeys = INDICATOR_KEYS.filter((k) => (index.get(k) ?? -1) >= 0);
  const missingOptionalColumns = INDICATOR_KEYS.filter((k) => !indicatorKeys.includes(k))
    .map((k) => columns[k])
    .filter((name): name is string => Boolean(name));

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const workName = cellText(at(row, 'work'));
    if (!workName) continue;
    const rawMonth = at(row, 'month');
    const rawCumulative = at(row, 'cumulative');
    const month = parseMonthCell(rawMonth);
    const cumulative = parseFractionCell(rawCumulative);
    const key = normalizeWorkName(workName);
    if (month) readIndicators(row, r, workName, key, month);
    // Empty cumulative = month not planned (e.g. after the end of the work): silently skipped.
    if (cellText(rawCumulative) === '' && cellText(rawMonth) !== '') continue;
    if (!month || cumulative === null) {
      const what = !month
        ? `mês inválido ("${cellText(rawMonth)}")`
        : `acumulado inválido ("${cellText(rawCumulative)}")`;
      issues.push({ row: r + 1, message: `${workName}: ${what}.` });
      continue;
    }
    const curve = byWork.get(key) ?? {
      workName,
      externalRef: cellText(at(row, 'externalRef')) || null,
      clientName: cellText(at(row, 'client')) || null,
      entries: [],
    };
    curve.entries.push({ month, cumulative });
    byWork.set(key, curve);
  }
  const curves = [...byWork.entries()].map(([key, curve]) => {
    const indicators = [...(indicatorsByWork.get(key)?.values() ?? [])].sort((a, b) =>
      a.month < b.month ? -1 : 1,
    );
    return indicators.length > 0 ? { ...curve, indicators } : curve;
  });
  return { curves, issues, missingOptionalColumns, headerRow: headerRow + 1 };

  function readIndicators(row: unknown[], r: number, workName: string, key: string, month: string) {
    const entry: ProgressEntry = { month };
    let any = false;
    for (const k of indicatorKeys) {
      const raw = at(row, k);
      if (cellText(raw) === '') continue;
      const value = parseFractionCell(raw);
      if (value === null || value.startsWith('-')) {
        issues.push({
          row: r + 1,
          message: `${workName}: "${columns[k] ?? k}" inválido ("${cellText(raw)}").`,
        });
        continue;
      }
      entry[INDICATOR_FIELD[k]] = value;
      any = true;
    }
    if (!any) return;
    const months = indicatorsByWork.get(key) ?? new Map<string, ProgressEntry>();
    months.set(month, { ...months.get(month), ...entry });
    indicatorsByWork.set(key, months);
  }
}
