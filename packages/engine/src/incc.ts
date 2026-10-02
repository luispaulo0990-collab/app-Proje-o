import { Decimal, ONE, PCT_SCALE, roundTo, toFixedString } from './decimal.js';
import { addMonths, parseIsoMonth, toIsoMonth } from './schedule.js';
import type { DecimalString, InccRate, IsoMonth } from './types.js';

/** INCC number-index (e.g. 1.123,456): kept with 6 decimals. */
export const INCC_INDEX_SCALE = 6;

/** Published INCC number-index of a month (e.g. FGV INCC-M of AGO/26). */
export interface InccIndex {
  month: IsoMonth;
  index: DecimalString;
}

/**
 * Monthly INCC variation derived from the number-index (rule defined 02/10/2026):
 * `rate(M) = index(M) ÷ index(M−1) − 1`, rounded to 8 decimals (HALF_EVEN). A month whose
 * previous month has no index yields no variation (the first month of the history, or a gap):
 * the engine then does not correct the balance with it.
 */
export function inccRatesFromIndices(indices: readonly InccIndex[]): InccRate[] {
  const byMonth = new Map(indices.map((i) => [i.month, new Decimal(i.index)]));
  return [...byMonth.keys()].sort().flatMap((month) => {
    const current = byMonth.get(month);
    const previous = byMonth.get(toIsoMonth(addMonths(parseIsoMonth(month), -1)));
    if (!current || !previous || !previous.greaterThan(0)) return [];
    const rate = roundTo(current.div(previous).minus(ONE), PCT_SCALE);
    return [{ month, rate: toFixedString(rate, PCT_SCALE) }];
  });
}
