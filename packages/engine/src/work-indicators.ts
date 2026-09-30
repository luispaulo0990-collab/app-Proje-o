import { Decimal, ONE, PCT_SCALE, PCT_TOLERANCE, roundTo, toFixedString } from './decimal.js';
import { addMonths, monthDiff, parseIsoMonth, toIsoMonth } from './schedule.js';
import type { DecimalString, IsoMonth, ProjectionCell } from './types.js';

/**
 * Monthly progress figures of a work as reported by the planning system
 * (SharePoint "BD_Infos Gerais" or the generic API). Fractions: 0.29 = 29%.
 */
export interface ProgressEntry {
  month: IsoMonth;
  /** "Realizado Acumulado". */
  realizedCumulative?: DecimalString | null;
  /** "Replanejado Atual Acumulado - Cliente". */
  clientReplannedCumulative?: DecimalString | null;
  /** "Meta Acumulada - Atual". */
  targetCumulative?: DecimalString | null;
}

export type ClientStatus = 'OK' | 'ATRASADA' | 'SEM_DADOS';

export interface ProgressIndicators {
  /** Month whose "Realizado Acumulado" is shown (latest ≤ reference). */
  realizedMonth: IsoMonth | null;
  realizedCumulative: DecimalString | null;
  /** Realized in `realizedMonth` alone (cumulative − previous month's cumulative). */
  realizedMonthly: DecimalString | null;
  /** Month used to compare client replanning × target (latest ≤ reference with both). */
  statusMonth: IsoMonth | null;
  clientReplannedCumulative: DecimalString | null;
  targetCumulative: DecimalString | null;
  /** clientReplanned − target (negative = behind). */
  deviation: DecimalString | null;
  clientStatus: ClientStatus;
}

const pct = (v: Decimal) => toFixedString(v, PCT_SCALE);
const dec = (v: DecimalString) => roundTo(new Decimal(v), PCT_SCALE);
const present = (v: DecimalString | null | undefined): v is DecimalString =>
  v !== null && v !== undefined && v !== '';

/**
 * Status cliente (rule defined 30/09/2026): at the reference month, if the cumulative
 * "Replanejado Atual Acumulado - Cliente" is LOWER than the "Meta Acumulada - Atual" the work
 * is ATRASADA, otherwise OK. Values are compared at 8 decimals. When the reference month has
 * no data yet (closing not published), the latest earlier month with both values is used.
 */
export function computeProgressIndicators(
  entries: readonly ProgressEntry[],
  referenceMonth: IsoMonth,
  /** First month of the work's curve: there the monthly realized equals the cumulative. */
  startMonth?: IsoMonth | null,
): ProgressIndicators {
  const sorted = [...entries]
    .filter((e) => e.month <= referenceMonth)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const byMonth = new Map(sorted.map((e) => [e.month, e]));

  const realized = [...sorted].reverse().find((e) => present(e.realizedCumulative));
  let realizedMonthly: DecimalString | null = null;
  if (realized && present(realized.realizedCumulative)) {
    const previousMonth = toIsoMonth(addMonths(parseIsoMonth(realized.month), -1));
    const previous = byMonth.get(previousMonth);
    if (previous && present(previous.realizedCumulative)) {
      realizedMonthly = pct(
        dec(realized.realizedCumulative).minus(dec(previous.realizedCumulative)),
      );
    } else if (startMonth && realized.month <= startMonth) {
      realizedMonthly = pct(dec(realized.realizedCumulative));
    }
  }

  const compared = [...sorted]
    .reverse()
    .find((e) => present(e.clientReplannedCumulative) && present(e.targetCumulative));
  let status: Pick<
    ProgressIndicators,
    'statusMonth' | 'clientReplannedCumulative' | 'targetCumulative' | 'deviation' | 'clientStatus'
  > = {
    statusMonth: null,
    clientReplannedCumulative: null,
    targetCumulative: null,
    deviation: null,
    clientStatus: 'SEM_DADOS',
  };
  if (
    compared &&
    present(compared.clientReplannedCumulative) &&
    present(compared.targetCumulative)
  ) {
    const replanned = dec(compared.clientReplannedCumulative);
    const target = dec(compared.targetCumulative);
    status = {
      statusMonth: compared.month,
      clientReplannedCumulative: pct(replanned),
      targetCumulative: pct(target),
      deviation: pct(replanned.minus(target)),
      clientStatus: replanned.lessThan(target) ? 'ATRASADA' : 'OK',
    };
  }

  return {
    realizedMonth: realized?.month ?? null,
    realizedCumulative:
      realized && present(realized.realizedCumulative)
        ? pct(dec(realized.realizedCumulative))
        : null,
    realizedMonthly,
    ...status,
  };
}

/**
 * "Término projetado": first month in which the physical curve reaches 100% (within the
 * curve tolerance). Trailing months with no progress are ignored.
 */
export function projectedEndMonth(physical: readonly ProjectionCell[]): IsoMonth | null {
  const full = ONE.minus(PCT_TOLERANCE);
  const hit = physical.find((c) => new Decimal(c.cumulative).greaterThanOrEqualTo(full));
  if (hit) return hit.month;
  const last = [...physical].reverse().find((c) => new Decimal(c.current).greaterThan(0));
  return last?.month ?? null;
}

/** Months incurred from `startMonth` through `referenceMonth` (inclusive); 0 before start. */
export function monthsIncurred(startMonth: IsoMonth, referenceMonth: IsoMonth): number {
  const diff = monthDiff(parseIsoMonth(startMonth), parseIsoMonth(referenceMonth));
  return diff < 0 ? 0 : diff + 1;
}

/** Number of months from `startMonth` to `endMonth`, both inclusive. */
export function monthsBetween(startMonth: IsoMonth, endMonth: IsoMonth): number {
  return monthDiff(parseIsoMonth(startMonth), parseIsoMonth(endMonth)) + 1;
}

/** `YYYY-MM-01` shifted by `months` (may be negative). */
export function addMonthsIso(month: IsoMonth, months: number): IsoMonth {
  return toIsoMonth(addMonths(parseIsoMonth(month), months));
}

/** "Início de obra": first month in which the physical curve has progress. */
export function firstProgressMonth(physical: readonly ProjectionCell[]): IsoMonth | null {
  return physical.find((c) => new Decimal(c.current).greaterThan(0))?.month ?? null;
}
