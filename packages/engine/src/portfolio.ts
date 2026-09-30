import { Decimal, MONEY_SCALE, ZERO, toFixedString } from './decimal.js';
import { buildPeriods, monthDiff, parseIsoMonth } from './schedule.js';
import type { DecimalString, IsoMonth, Period, ProjectionCell } from './types.js';

export interface PortfolioItem {
  workId: string;
  physical: readonly ProjectionCell[];
  fee: readonly ProjectionCell[];
}

export interface PortfolioMonth extends Period {
  feeTotal: DecimalString;
  /** Year-to-date fee — resets every January, as in the spreadsheet. */
  feeYearToDate: DecimalString;
  /** Works with physical progress > 0 in the month ("Qtd Obras"). */
  activeWorks: number;
}

export interface PortfolioAggregate {
  months: PortfolioMonth[];
  feeGrandTotal: DecimalString;
}

/** Aggregates many work projections on a common monthly axis (the horizontal grid totals). */
export function aggregatePortfolio(items: readonly PortfolioItem[]): PortfolioAggregate {
  const allMonths = items.flatMap((it) => [...it.physical, ...it.fee].map((c) => c.month));
  if (allMonths.length === 0)
    return { months: [], feeGrandTotal: toFixedString(ZERO, MONEY_SCALE) };

  const sorted = [...new Set(allMonths)].sort();
  const first = parseIsoMonth(sorted[0] as IsoMonth);
  const last = parseIsoMonth(sorted[sorted.length - 1] as IsoMonth);
  const axis = buildPeriods(first, monthDiff(first, last) + 1);

  const feeByMonth = new Map<IsoMonth, Decimal>();
  const activeByMonth = new Map<IsoMonth, number>();
  for (const item of items) {
    for (const c of item.fee)
      feeByMonth.set(c.month, (feeByMonth.get(c.month) ?? ZERO).plus(c.current));
    for (const c of item.physical) {
      if (new Decimal(c.current).greaterThan(0))
        activeByMonth.set(c.month, (activeByMonth.get(c.month) ?? 0) + 1);
    }
  }

  let ytd = ZERO;
  let grand = ZERO;
  const months = axis.map((p) => {
    const fee = feeByMonth.get(p.month) ?? ZERO;
    if (p.month.slice(5, 7) === '01') ytd = ZERO;
    ytd = ytd.plus(fee);
    grand = grand.plus(fee);
    return {
      ...p,
      feeTotal: toFixedString(fee, MONEY_SCALE),
      feeYearToDate: toFixedString(ytd, MONEY_SCALE),
      activeWorks: activeByMonth.get(p.month) ?? 0,
    };
  });
  return { months, feeGrandTotal: toFixedString(grand, MONEY_SCALE) };
}
