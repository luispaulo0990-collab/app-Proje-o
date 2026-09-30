import { Decimal, MONEY_SCALE, PCT_SCALE, ZERO, toFixedString } from './decimal.js';
import { monthDiff, parseIsoMonth } from './schedule.js';
import type { DecimalString, IsoMonth, ProjectionCell, ProjectionResult } from './types.js';

export interface ProjectionKpis {
  referenceMonth: IsoMonth;
  /** Σ fee projected (R$). */
  feeProjected: DecimalString;
  /** Σ fee up to and including the reference month. */
  feeRealized: DecimalString;
  /** Σ fee after the reference month. */
  feeRemaining: DecimalString;
  /** Σ physical (should be 1.00000000). */
  physicalProjected: DecimalString;
  /** Physical cumulative at the reference month. */
  physicalAccumulated: DecimalString;
  durationMonths: number;
  /** Elapsed months at reference, clamped to [0, duration]. */
  elapsedMonths: number;
  endDate: string;
}

function splitAt(
  cells: readonly ProjectionCell[],
  referenceMonth: IsoMonth,
): { upTo: Decimal; after: Decimal } {
  const ref = parseIsoMonth(referenceMonth);
  return cells.reduce(
    (acc, c) => {
      const value = new Decimal(c.current);
      return monthDiff(parseIsoMonth(c.month), ref) >= 0
        ? { ...acc, upTo: acc.upTo.plus(value) }
        : { ...acc, after: acc.after.plus(value) };
    },
    { upTo: ZERO, after: ZERO },
  );
}

/**
 * KPIs are always derived from the engine result (single source of truth).
 * "Realizado" here means projected values up to the reference month (see ambiguity A3).
 */
export function computeKpis(result: ProjectionResult, referenceMonth: IsoMonth): ProjectionKpis {
  const fee = splitAt(result.fee, referenceMonth);
  const physical = splitAt(result.physical, referenceMonth);
  const start = parseIsoMonth(result.schedule.startDate);
  const elapsed = monthDiff(start, parseIsoMonth(referenceMonth)) + 1;
  const duration = result.schedule.durationMonths;
  return {
    referenceMonth,
    feeProjected: toFixedString(fee.upTo.plus(fee.after), MONEY_SCALE),
    feeRealized: toFixedString(fee.upTo, MONEY_SCALE),
    feeRemaining: toFixedString(fee.after, MONEY_SCALE),
    physicalProjected: toFixedString(physical.upTo.plus(physical.after), PCT_SCALE),
    physicalAccumulated: toFixedString(physical.upTo, PCT_SCALE),
    durationMonths: duration,
    elapsedMonths: Math.min(Math.max(elapsed, 0), duration),
    endDate: result.schedule.endDate,
  };
}
