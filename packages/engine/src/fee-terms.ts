import {
  Decimal,
  MONEY_SCALE,
  ONE,
  PCT_SCALE,
  ZERO,
  roundTo,
  sum,
  toDecimal,
  toFixedString,
} from './decimal.js';
import { issue } from './errors.js';
import { canonicalMonth, isInccPeriodicity } from './incc.js';
import type { FeeTerm, InccPeriodicity, IsoMonth, Period, ValidationIssue } from './types.js';

/**
 * Fee conditions over time: the work's own conditions (cadastro) plus the changes ("vigências")
 * typed later, each one valid from its month until the next one.
 */
export interface FeeTimeline {
  /** Canonical changes, sorted by month (what is persisted with the projection version). */
  terms: FeeTerm[];
  rateAt(month: IsoMonth): Decimal;
  periodicityAt(month: IsoMonth): InccPeriodicity;
}

/** The work's own conditions, valid until the first change. */
export interface BaseFeeConditions {
  feeRate: Decimal;
  inccPeriodicity: InccPeriodicity;
}

/** Rate between 0% and 100% with at most 8 decimals (same rule as the work's fee rate). */
function parseRate(value: string): Decimal | null {
  try {
    const rate = toDecimal(value, 'taxa');
    if (rate.isNegative() || rate.greaterThan(ONE) || rate.decimalPlaces() > PCT_SCALE) return null;
    return rate;
  } catch {
    return null;
  }
}

/**
 * Validates the fee terms (invalid month, rate or periodicity, duplicated month → ERROR) and
 * builds the lookups used by the fee schedule. A term after the last financial month has no
 * effect and is reported as a warning.
 */
export function buildFeeTimeline(
  base: BaseFeeConditions,
  terms: readonly FeeTerm[],
  periods: readonly Period[],
  issues: ValidationIssue[],
): FeeTimeline {
  const parsed: { month: IsoMonth; rate: Decimal; periodicity: InccPeriodicity }[] = [];
  const seen = new Set<IsoMonth>();
  for (const term of terms) {
    const month = canonicalMonth(term.month);
    const rate = parseRate(term.feeRate);
    const ctx = { month: term.month };
    if (!month || !rate || !isInccPeriodicity(term.inccPeriodicity)) {
      issues.push(
        issue(
          'INVALID_FEE_TERM',
          `Vigência inválida em "${term.month}": informe o mês, a taxa (0% a 100%) e a periodicidade do INCC.`,
          ctx,
        ),
      );
      continue;
    }
    if (seen.has(month)) {
      issues.push(
        issue('FEE_TERM_DUPLICATED', `Há mais de uma vigência em ${month.slice(0, 7)}.`, ctx),
      );
      continue;
    }
    seen.add(month);
    parsed.push({ month, rate, periodicity: term.inccPeriodicity });
  }
  parsed.sort((a, b) => (a.month < b.month ? -1 : 1));

  const lastMonth = periods[periods.length - 1]?.month;
  for (const term of parsed) {
    if (lastMonth && term.month > lastMonth) {
      issues.push(
        issue(
          'FEE_TERM_OUT_OF_RANGE',
          `A vigência de ${term.month.slice(0, 7)} começa depois do último mês de recebimento e não altera a projeção.`,
          { month: term.month },
          'WARNING',
        ),
      );
    }
  }

  /** Last term with month ≤ `month`; undefined = the work's own conditions. */
  const termAt = (month: IsoMonth) => parsed.findLast((t) => t.month <= month);

  return {
    terms: parsed.map((t) => ({
      month: t.month,
      feeRate: toFixedString(t.rate, PCT_SCALE),
      inccPeriodicity: t.periodicity,
    })),
    rateAt: (month) => termAt(month)?.rate ?? base.feeRate,
    periodicityAt: (month) => termAt(month)?.periodicity ?? base.inccPeriodicity,
  };
}

/** Fee weights and contract fee once the rate in force in each financial month is applied. */
export interface RatedFee {
  weights: Decimal[];
  total: Decimal;
}

/**
 * "Taxa mensal = %físico × orçamento × %taxa vigente no mês".
 * - Single rate over the whole horizon: total = round2(budget × rate), weights unchanged — the
 *   exact original rule.
 * - Rate changes: each month weighs `%físico × rate`, and total = round2(budget × Σ(%físico ×
 *   rate) ÷ Σ%físico). Months before a change keep the old rate; months from it on use the new
 *   one (a change typed "from now on" never rewrites the past).
 */
export function applyFeeRates(
  weights: readonly Decimal[],
  periods: readonly Period[],
  timeline: Pick<FeeTimeline, 'rateAt'>,
  budget: Decimal,
): RatedFee {
  const rates = periods.map((p) => timeline.rateAt(p.month));
  const first = rates[0] ?? ZERO;
  if (rates.every((r) => r.equals(first))) {
    return { weights: [...weights], total: roundTo(budget.times(first), MONEY_SCALE) };
  }
  const rated = weights.map((w, i) => w.times(rates[i] ?? ZERO));
  const weightSum = sum([...weights]);
  const average = weightSum.isZero() ? first : sum(rated).div(weightSum);
  return { weights: rated, total: roundTo(budget.times(average), MONEY_SCALE) };
}
