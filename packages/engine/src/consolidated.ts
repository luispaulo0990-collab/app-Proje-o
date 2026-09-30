import { Decimal, MONEY_SCALE, PCT_SCALE, ZERO, toFixedString } from './decimal.js';
import { aggregatePortfolio, type PortfolioItem, type PortfolioMonth } from './portfolio.js';
import { monthDiff, parseIsoMonth } from './schedule.js';
import type { DecimalString, IsoMonth, ProjectionCell } from './types.js';

export interface ConsolidatedWorkSummary {
  workId: string;
  /** Σ fee of the work (R$). */
  feeProjected: DecimalString;
  /** Σ fee up to and including the reference month ("Taxa Recebida"). */
  feeRealized: DecimalString;
  /** Σ fee after the reference month ("Taxa A Receber"). */
  feeRemaining: DecimalString;
  /** Fee of the reference month. */
  feeAtReference: DecimalString;
  /** Physical cumulative at the reference month ("Avanço Ac."). */
  physicalAccumulated: DecimalString;
  /** Physical progress > 0 in the reference month. */
  activeAtReference: boolean;
}

export interface ConsolidatedMonth extends PortfolioMonth {
  isReference: boolean;
}

export interface ConsolidatedYear {
  year: number;
  feeTotal: DecimalString;
}

export interface ConsolidatedPanel {
  referenceMonth: IsoMonth;
  months: ConsolidatedMonth[];
  /** "Acumulado AAAA" — Σ fee per calendar year. */
  years: ConsolidatedYear[];
  works: ConsolidatedWorkSummary[];
  totals: {
    worksCount: number;
    activeWorksAtReference: number;
    feeProjected: DecimalString;
    feeRealized: DecimalString;
    feeRemaining: DecimalString;
    feeAtReference: DecimalString;
    feeYearToDateAtReference: DecimalString;
  };
}

function isUpTo(month: IsoMonth, referenceMonth: IsoMonth): boolean {
  return monthDiff(parseIsoMonth(month), parseIsoMonth(referenceMonth)) >= 0;
}

function summarize(item: PortfolioItem, referenceMonth: IsoMonth): ConsolidatedWorkSummary {
  let upTo = ZERO;
  let after = ZERO;
  let atRef = ZERO;
  for (const c of item.fee) {
    const v = new Decimal(c.current);
    if (isUpTo(c.month, referenceMonth)) upTo = upTo.plus(v);
    else after = after.plus(v);
    if (c.month === referenceMonth) atRef = atRef.plus(v);
  }
  const physicalUpTo = item.physical
    .filter((c: ProjectionCell) => isUpTo(c.month, referenceMonth))
    .reduce((acc, c) => acc.plus(c.current), ZERO);
  const activeAtReference = item.physical.some(
    (c) => c.month === referenceMonth && new Decimal(c.current).greaterThan(0),
  );
  return {
    workId: item.workId,
    feeProjected: toFixedString(upTo.plus(after), MONEY_SCALE),
    feeRealized: toFixedString(upTo, MONEY_SCALE),
    feeRemaining: toFixedString(after, MONEY_SCALE),
    feeAtReference: toFixedString(atRef, MONEY_SCALE),
    physicalAccumulated: toFixedString(physicalUpTo, PCT_SCALE),
    activeAtReference,
  };
}

/**
 * Consolidated portfolio panel (equivalent to the "Painel (2)" sheet): monthly fee totals,
 * year-to-date, active works per month, yearly totals and received/receivable split at the
 * reference month. Every figure is derived from the stored projections — no rule lives in
 * the UI.
 */
export function buildConsolidatedPanel(
  items: readonly PortfolioItem[],
  referenceMonth: IsoMonth,
): ConsolidatedPanel {
  const aggregate = aggregatePortfolio(items);
  const months = aggregate.months.map((m) => ({ ...m, isReference: m.month === referenceMonth }));

  const byYear = new Map<number, Decimal>();
  for (const m of months) {
    const year = Number(m.month.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? ZERO).plus(m.feeTotal));
  }
  const years = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, total]) => ({ year, feeTotal: toFixedString(total, MONEY_SCALE) }));

  const works = items.map((item) => summarize(item, referenceMonth));
  const add = (pick: (w: ConsolidatedWorkSummary) => DecimalString) =>
    toFixedString(
      works.reduce((acc, w) => acc.plus(pick(w)), ZERO),
      MONEY_SCALE,
    );

  // YTD at reference: last axis month ≤ reference in the same year.
  const refYear = referenceMonth.slice(0, 4);
  const ytdMonth = [...months]
    .reverse()
    .find((m) => m.month.slice(0, 4) === refYear && isUpTo(m.month, referenceMonth));

  return {
    referenceMonth,
    months,
    years,
    works,
    totals: {
      worksCount: items.length,
      activeWorksAtReference: works.filter((w) => w.activeAtReference).length,
      feeProjected: add((w) => w.feeProjected),
      feeRealized: add((w) => w.feeRealized),
      feeRemaining: add((w) => w.feeRemaining),
      feeAtReference: add((w) => w.feeAtReference),
      feeYearToDateAtReference: ytdMonth?.feeYearToDate ?? toFixedString(ZERO, MONEY_SCALE),
    },
  };
}
