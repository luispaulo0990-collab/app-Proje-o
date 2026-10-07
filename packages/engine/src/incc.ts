import { Decimal, ONE, PCT_SCALE, roundTo, toDecimal, toFixedString } from './decimal.js';
import { issue } from './errors.js';
import { addMonths, monthDiff, parseIsoMonth, toIsoMonth } from './schedule.js';
import type { InccIndex, InccPeriodicity, InccRate, IsoMonth, ValidationIssue } from './types.js';

/** INCC number-index (e.g. 1.123,456): kept with 6 decimals. */
export const INCC_INDEX_SCALE = 6;

/** Months covered by each correction (the INCC accumulated over the window is applied once). */
export const INCC_PERIOD_MONTHS: Readonly<Record<InccPeriodicity, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  FOUR_MONTHLY: 4,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export const INCC_PERIODICITIES = Object.keys(INCC_PERIOD_MONTHS) as InccPeriodicity[];

export const isInccPeriodicity = (value: unknown): value is InccPeriodicity =>
  typeof value === 'string' && value in INCC_PERIOD_MONTHS;

const shiftMonth = (month: IsoMonth, months: number) =>
  toIsoMonth(addMonths(parseIsoMonth(month), months));

/** `YYYY-MM-01` of any accepted month string, or null when it is not a valid month. */
export function canonicalMonth(value: string): IsoMonth | null {
  try {
    return toIsoMonth(parseIsoMonth(value));
  } catch {
    return null;
  }
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
    const previous = byMonth.get(shiftMonth(month, -1));
    if (!current || !previous || !previous.greaterThan(0)) return [];
    const rate = roundTo(current.div(previous).minus(ONE), PCT_SCALE);
    return [{ month, rate: toFixedString(rate, PCT_SCALE) }];
  });
}

/**
 * Accumulated INCC variation from the end of `fromMonth` to the end of `toMonth` (the window is
 * the months after `fromMonth` up to `toMonth`), 8 decimals; undefined when not published yet.
 */
export type InccVariation = (fromMonth: IsoMonth, toMonth: IsoMonth) => Decimal | undefined;

/** Parses the inputs and reports invalid entries (ERROR) — shared by indices and rates. */
function parseByMonth(
  items: readonly { month: string; value: string }[],
  isValid: (value: Decimal) => boolean,
  issues: ValidationIssue[],
): Map<IsoMonth, Decimal> {
  const byMonth = new Map<IsoMonth, Decimal>();
  for (const item of items) {
    const month = canonicalMonth(item.month);
    let value: Decimal | null = null;
    try {
      value = toDecimal(item.value, 'INCC');
    } catch {
      value = null;
    }
    if (!month || !value || !isValid(value)) {
      issues.push(
        issue('INVALID_INCC_RATE', `INCC inválido em "${item.month}".`, { month: item.month }),
      );
      continue;
    }
    byMonth.set(month, value);
  }
  return byMonth;
}

/**
 * Builds the variation lookup. Indices give the exact ratio for any window; monthly rates
 * (legacy input) are compounded month by month. For a one-month window both are identical to
 * `inccRatesFromIndices`.
 */
export function createInccVariation(
  input: { indices?: readonly InccIndex[]; rates?: readonly InccRate[] },
  issues: ValidationIssue[],
): InccVariation {
  if (input.indices && input.indices.length > 0) {
    const index = parseByMonth(
      input.indices.map((i) => ({ month: i.month, value: i.index })),
      (v) => v.greaterThan(0),
      issues,
    );
    return (from, to) => {
      const start = index.get(from);
      const end = index.get(to);
      return start && end ? roundTo(end.div(start).minus(ONE), PCT_SCALE) : undefined;
    };
  }
  const rate = parseByMonth(
    (input.rates ?? []).map((r) => ({ month: r.month, value: r.rate })),
    (v) => roundTo(v, PCT_SCALE).greaterThan(-1),
    issues,
  );
  return (from, to) => {
    let factor = ONE;
    for (let month = shiftMonth(from, 1); month <= to; month = shiftMonth(month, 1)) {
      const r = rate.get(month);
      if (!r) return undefined;
      factor = factor.times(ONE.plus(roundTo(r, PCT_SCALE)));
    }
    return roundTo(factor.minus(ONE), PCT_SCALE);
  };
}

/** Outcome of asking the corrector about one financial month. */
export type InccStep =
  | { status: 'NOT_DUE' }
  /** A correction is due but the INCC of its window is not published (yet). */
  | { status: 'MISSING' }
  | { status: 'APPLIED'; rate: Decimal; fromMonth: IsoMonth; toMonth: IsoMonth };

export interface InccCorrectorInput {
  variation: InccVariation;
  /** Periodicity in force in a financial month (it may change over time: fee terms). */
  periodicityAt: (month: IsoMonth) => InccPeriodicity;
  /** "Data-base": corrections fall every N months counted from it. */
  baseMonth: IsoMonth;
}

/**
 * Decides, month by month and in chronological order, when the balance is corrected and by
 * how much:
 * - MONTHLY: every month M is corrected by the INCC of M−1 (original rule);
 * - every N months (QUARTERLY = 3…): months M = data-base + k·N (k ≥ 1) are corrected by the
 *   INCC accumulated over the N months before M (e.g. data-base JAN, quarterly: APR is corrected
 *   by the variation of JAN..MAR).
 * The window always starts right after the last INCC month already applied, so a change of
 * periodicity (or a month published late) never counts a month twice nor skips one.
 */
export function createInccCorrector({ variation, periodicityAt, baseMonth }: InccCorrectorInput) {
  const base = parseIsoMonth(baseMonth);
  /** Last INCC month already used in a correction. */
  let lastApplied: IsoMonth | null = null;

  const isDue = (month: IsoMonth, months: number) => {
    if (months === 1) return true;
    const elapsed = monthDiff(base, parseIsoMonth(month));
    return elapsed > 0 && elapsed % months === 0;
  };

  return {
    at(month: IsoMonth): InccStep {
      const months = INCC_PERIOD_MONTHS[periodicityAt(month)];
      if (!isDue(month, months)) return { status: 'NOT_DUE' };
      const toMonth = shiftMonth(month, -1);
      const from = lastApplied ?? shiftMonth(month, -months - 1);
      if (from >= toMonth) return { status: 'NOT_DUE' }; // window already covered
      const rate = variation(from, toMonth);
      if (!rate) return { status: 'MISSING' };
      lastApplied = toMonth;
      return { status: 'APPLIED', rate, fromMonth: shiftMonth(from, 1), toMonth };
    },
  };
}

export type InccCorrector = ReturnType<typeof createInccCorrector>;
