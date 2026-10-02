import type { EconomicEntry } from '@unita/engine';
import type { ExternalEconomicSeries, ProviderReadIssue } from '../work-curve-provider.js';
import { normalizeWorkName } from '../work-curve-provider.js';
import { SheetLayoutError } from './fisico-geral.parser.js';
import { cellText, normalizeHeader, parseFractionCell, parseMonthCell } from './sheet-values.js';

/** Column names of the "BD_Econômico" sheet (configurable through the environment). */
export interface EconomicoColumns {
  work: string;
  item: string;
  month: string;
  iec: string;
  projectedResult: string;
  /** "Nome Cliente + Obra": used to tell the client apart (works with the same name). */
  clientAndWork?: string;
}

export const DEFAULT_ECONOMICO_COLUMNS: EconomicoColumns = {
  work: 'Nome da Obra',
  item: 'Item',
  month: 'Mês do Fechamento',
  iec: 'IEC Obra',
  projectedResult: 'Resultado Projetado Obra',
  clientAndWork: 'Nome Cliente + Obra',
};

/** Value of the "Item" column holding the work totals (the other rows are budget items). */
export const DEFAULT_ECONOMICO_TOTAL_ITEM = 'Geral';

const REQUIRED: (keyof EconomicoColumns)[] = ['work', 'item', 'month', 'iec', 'projectedResult'];

function locateColumns(rows: readonly unknown[][], columns: EconomicoColumns) {
  const wanted = Object.entries(columns).filter(([, v]) => Boolean(v)) as [
    keyof EconomicoColumns,
    string,
  ][];
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const headers = (rows[r] ?? []).map((c) => normalizeHeader(cellText(c)));
    const index = new Map(
      wanted.map(([key, name]) => [key, headers.indexOf(normalizeHeader(name))]),
    );
    if ((index.get('work') ?? -1) >= 0 && (index.get('month') ?? -1) >= 0) {
      const missing = REQUIRED.filter((k) => (index.get(k) ?? -1) < 0).map((k) => columns[k]);
      if (missing.length > 0) throw new SheetLayoutError(missing as string[]);
      return { headerRow: r, index };
    }
  }
  throw new SheetLayoutError([columns.work, columns.month]);
}

/** "Benx/Hines Viva Benx Klabin" with work "Viva Benx Klabin" → "Benx/Hines". */
function clientFrom(clientAndWork: string, workName: string): string | null {
  const full = clientAndWork.trim();
  if (!full || !full.toLowerCase().endsWith(workName.toLowerCase())) return null;
  const client = full.slice(0, full.length - workName.length).trim();
  return client || null;
}

/**
 * Turns the `usedRange.values` matrix of "BD_Econômico" into one series of monthly closings per
 * work. Only the rows whose "Item" is the total row ("Geral") are used: the others are budget
 * items. Values are kept as published; the engine decides what counts as a closing.
 */
export function parseEconomico(
  rows: readonly unknown[][],
  columns: EconomicoColumns = DEFAULT_ECONOMICO_COLUMNS,
  totalItem: string = DEFAULT_ECONOMICO_TOTAL_ITEM,
): { series: ExternalEconomicSeries[]; issues: ProviderReadIssue[]; headerRow: number } {
  const { headerRow, index } = locateColumns(rows, columns);
  const at = (row: unknown[], key: keyof EconomicoColumns) => {
    const i = index.get(key) ?? -1;
    return i >= 0 ? row[i] : undefined;
  };
  const total = normalizeHeader(totalItem);
  const byWork = new Map<string, ExternalEconomicSeries & { months: Map<string, EconomicEntry> }>();
  const issues: ProviderReadIssue[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const workName = cellText(at(row, 'work'));
    if (!workName || normalizeHeader(cellText(at(row, 'item'))) !== total) continue;
    const rawMonth = at(row, 'month');
    const month = parseMonthCell(rawMonth);
    if (!month) {
      issues.push({ row: r + 1, message: `${workName}: mês inválido ("${cellText(rawMonth)}").` });
      continue;
    }
    const read = (key: 'iec' | 'projectedResult') => {
      const raw = at(row, key);
      if (cellText(raw) === '') return null;
      const value = parseFractionCell(raw);
      if (value === null || (key === 'iec' && value.startsWith('-'))) {
        issues.push({
          row: r + 1,
          message: `${workName}: "${columns[key]}" inválido ("${cellText(raw)}").`,
        });
        return null;
      }
      return value;
    };
    const entry: EconomicEntry = {
      month,
      iec: read('iec'),
      projectedResult: read('projectedResult'),
    };
    const key = normalizeWorkName(workName);
    const series = byWork.get(key) ?? {
      workName,
      clientName: clientFrom(cellText(at(row, 'clientAndWork')), workName),
      entries: [],
      months: new Map<string, EconomicEntry>(),
    };
    if (series.months.has(month)) {
      issues.push({
        row: r + 1,
        message: `${workName}: mês ${month.slice(0, 7)} repetido (vale a última linha).`,
      });
    }
    series.months.set(month, entry);
    byWork.set(key, series);
  }

  const series = [...byWork.values()].map(({ months, ...s }) => ({
    ...s,
    entries: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
  }));
  return { series, issues, headerRow: headerRow + 1 };
}
