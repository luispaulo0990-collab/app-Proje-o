import { Decimal, ONE, PCT_SCALE, ZERO, roundTo, toDecimal } from './decimal.js';
import { issue } from './errors.js';
import { addMonths, monthDiff, parseIsoMonth, toIsoMonth } from './schedule.js';
import type { DecimalString, IsoMonth, ValidationIssue } from './types.js';

/** Default tolerance to accept a cumulative series ending slightly off 100% (rounding noise). */
export const CUMULATIVE_END_TOLERANCE = '0.005';

export interface CumulativeEntry {
  month: IsoMonth;
  /** Cumulative fraction at the end of the month (0.29 = 29%). */
  cumulative: DecimalString | number;
}

export interface CumulativeSeriesResult {
  /** First month with progress (leading 0% months are dropped). */
  startMonth: IsoMonth;
  /** Month-keyed monthly fractions, contiguous, ready for `pointsFromMonths`. */
  months: { month: IsoMonth; monthlyPct: DecimalString }[];
  /** True when the final cumulative was within tolerance of 100% but not exact → normalize. */
  needsNormalization: boolean;
  issues: ValidationIssue[];
}

/**
 * Converts a month × cumulative series (as exported by planning spreadsheets) into monthly
 * fractions:
 *
 * 1. months are sorted; duplicates with different values are an error;
 * 2. gaps are filled with the previous cumulative (no progress in that month);
 * 3. leading months at 0% and trailing months after the series reaches its final value are
 *    dropped — the curve spans from the first to the last month with progress;
 * 4. cumulative must never decrease and must end at 100% (± tolerance → normalized later).
 */
export function curveFromCumulativeSeries(
  entries: readonly CumulativeEntry[],
  tolerance: DecimalString = CUMULATIVE_END_TOLERANCE,
): CumulativeSeriesResult {
  const issues: ValidationIssue[] = [];
  const empty = (): CumulativeSeriesResult => ({
    startMonth: '',
    months: [],
    needsNormalization: false,
    issues,
  });

  const byMonth = new Map<IsoMonth, Decimal>();
  for (const e of entries) {
    const month = toIsoMonth(parseIsoMonth(e.month));
    let value: Decimal;
    try {
      value = roundTo(toDecimal(e.cumulative), PCT_SCALE);
    } catch {
      issues.push(issue('CUMULATIVE_INVALID', `Valor acumulado inválido em ${month}.`, { month }));
      continue;
    }
    const previous = byMonth.get(month);
    if (previous && !previous.equals(value)) {
      issues.push(
        issue('CUMULATIVE_DUPLICATED', `Mês ${month} aparece com valores diferentes.`, { month }),
      );
    }
    byMonth.set(month, value);
  }
  if (issues.length > 0) return empty();
  if (byMonth.size === 0) {
    issues.push(issue('CUMULATIVE_EMPTY', 'Nenhum valor acumulado informado.'));
    return empty();
  }

  const sorted = [...byMonth.keys()].sort();
  const first = parseIsoMonth(sorted[0] as IsoMonth);
  const span = monthDiff(first, parseIsoMonth(sorted[sorted.length - 1] as IsoMonth)) + 1;

  // Contiguous series; missing months repeat the previous cumulative.
  const series: { month: IsoMonth; cumulative: Decimal }[] = [];
  let carry = ZERO;
  for (let i = 0; i < span; i++) {
    const month = toIsoMonth(addMonths(first, i));
    const value = byMonth.get(month) ?? carry;
    if (value.lessThan(carry)) {
      issues.push(
        issue('CUMULATIVE_DECREASING', `O acumulado diminui em ${month}.`, {
          month,
          previous: carry.toString(),
          value: value.toString(),
        }),
      );
    }
    carry = Decimal.max(carry, value);
    series.push({ month, cumulative: value });
  }
  if (issues.length > 0) return empty();

  const final = series[series.length - 1]?.cumulative ?? ZERO;
  const distance = final.minus(ONE).abs();
  if (distance.greaterThan(tolerance)) {
    issues.push(
      issue(
        'CUMULATIVE_NOT_100',
        `O acumulado termina em ${final.times(100).toFixed(2)}% (esperado 100%).`,
        { final: final.toString() },
      ),
    );
    return empty();
  }

  const startIdx = series.findIndex((s) => s.cumulative.greaterThan(0));
  const endIdx = series.findIndex((s) => s.cumulative.equals(final));
  const trimmed = series.slice(startIdx, endIdx + 1);
  let previous = startIdx > 0 ? (series[startIdx - 1]?.cumulative ?? ZERO) : ZERO;
  const months = trimmed.map((s) => {
    const monthly = s.cumulative.minus(previous);
    previous = s.cumulative;
    return { month: s.month, monthlyPct: monthly.toFixed() };
  });
  return {
    startMonth: trimmed[0]?.month ?? '',
    months,
    needsNormalization: !distance.isZero(),
    issues,
  };
}
