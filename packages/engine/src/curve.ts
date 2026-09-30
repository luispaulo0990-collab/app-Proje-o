import { allocateLargestRemainder } from './allocation.js';
import {
  Decimal,
  ONE,
  PCT_SCALE,
  PCT_TOLERANCE,
  ZERO,
  sum,
  toDecimal,
  toFixedString,
} from './decimal.js';
import { EngineValidationError, issue } from './errors.js';
import type { CurvePoint, CurvePointInput, ValidationIssue } from './types.js';

export const MAX_CURVE_POINTS = 600;

function pct(d: Decimal): string {
  return `${d.times(100).toDecimalPlaces(6).toString().replace('.', ',')}%`;
}

function parsePoints(points: readonly CurvePointInput[]): {
  monthly: Decimal[];
  cumulative: (Decimal | undefined)[];
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const monthly: Decimal[] = [];
  const cumulative: (Decimal | undefined)[] = [];
  points.forEach((p, i) => {
    try {
      monthly.push(toDecimal(p.monthlyPct, `período ${p.period}`));
    } catch {
      issues.push(
        issue('CURVE_INVALID_NUMBER', `Percentual mensal inválido no período ${p.period}.`, {
          period: p.period,
        }),
      );
      monthly.push(ZERO);
    }
    if (p.cumulativePct === undefined) {
      cumulative.push(undefined);
    } else {
      try {
        cumulative.push(toDecimal(p.cumulativePct, `acumulado período ${p.period}`));
      } catch {
        issues.push(
          issue('CURVE_INVALID_NUMBER', `Percentual acumulado inválido no período ${p.period}.`, {
            period: p.period,
          }),
        );
        cumulative.push(undefined);
      }
    }
    if (p.period !== i + 1) {
      issues.push(
        issue(
          'CURVE_PERIOD_SEQUENCE',
          `Os períodos devem ser sequenciais a partir de 1 (esperado ${i + 1}, recebido ${p.period}).`,
          {
            expected: i + 1,
            received: p.period,
          },
        ),
      );
    }
  });
  return { monthly, cumulative, issues };
}

/**
 * Validates a curve against the domain rules:
 * R1 cumulative never decreases · R2 final cumulative = 100% · R3 monthly ≥ 0 ·
 * R4 Σ monthly = 100% (tolerance 1e-8) · periods contiguous 1..n · cumulative consistent.
 * Returns every issue found (does not throw).
 */
export function validateCurve(points: readonly CurvePointInput[]): ValidationIssue[] {
  if (points.length === 0)
    return [issue('CURVE_EMPTY', 'A curva precisa ter pelo menos um período.')];
  if (points.length > MAX_CURVE_POINTS) {
    return [issue('CURVE_TOO_LONG', `A curva pode ter no máximo ${MAX_CURVE_POINTS} períodos.`)];
  }
  const { monthly, cumulative, issues } = parsePoints(points);

  let running = ZERO;
  let previousCumulative = ZERO;
  monthly.forEach((m, i) => {
    const period = i + 1;
    if (m.isNegative()) {
      issues.push(
        issue('CURVE_NEGATIVE_MONTHLY', `Percentual mensal negativo no período ${period}.`, {
          period,
        }),
      );
    }
    running = running.plus(m);
    const informed = cumulative[i];
    if (informed !== undefined && informed.minus(running).abs().greaterThan(PCT_TOLERANCE)) {
      issues.push(
        issue(
          'CURVE_CUMULATIVE_MISMATCH',
          `Acumulado do período ${period} (${pct(informed)}) difere da soma dos mensais (${pct(running)}).`,
          { period },
        ),
      );
    }
    const current = informed ?? running;
    if (current.lessThan(previousCumulative.minus(PCT_TOLERANCE))) {
      issues.push(
        issue('CURVE_CUMULATIVE_DECREASING', `O acumulado diminui no período ${period}.`, {
          period,
        }),
      );
    }
    if (current.greaterThan(ONE.plus(PCT_TOLERANCE))) {
      issues.push(
        issue('CURVE_CUMULATIVE_ABOVE_100', `O acumulado ultrapassa 100% no período ${period}.`, {
          period,
        }),
      );
    }
    previousCumulative = current;
  });

  const total = sum(monthly);
  if (total.minus(ONE).abs().greaterThan(PCT_TOLERANCE)) {
    issues.push(
      issue('CURVE_SUM_NOT_100', `A soma dos percentuais mensais é ${pct(total)}; deve ser 100%.`, {
        total: total.toString(),
      }),
    );
  }
  const finalCumulative = cumulative[cumulative.length - 1] ?? running;
  if (
    finalCumulative.minus(ONE).abs().greaterThan(PCT_TOLERANCE) &&
    total.minus(ONE).abs().lessThanOrEqualTo(PCT_TOLERANCE)
  ) {
    issues.push(issue('CURVE_FINAL_NOT_100', 'O acumulado final deve ser 100%.'));
  }
  return issues;
}

export function assertValidCurve(points: readonly CurvePointInput[]): void {
  const errors = validateCurve(points).filter((i) => i.severity === 'ERROR');
  if (errors.length > 0) throw new EngineValidationError(errors);
}

/**
 * Canonical storage form of a valid curve: monthly fractions at 8 decimals summing exactly
 * to 1 (largest remainder) and the derived cumulative column.
 */
export function canonicalizeCurve(points: readonly CurvePointInput[]): CurvePoint[] {
  assertValidCurve(points);
  const monthly = points.map((p) => toDecimal(p.monthlyPct));
  const rounded = allocateLargestRemainder(monthly, ONE, PCT_SCALE);
  let running = ZERO;
  return rounded.map((m, i) => {
    running = running.plus(m);
    return {
      period: i + 1,
      monthlyPct: toFixedString(m, PCT_SCALE),
      cumulativePct: toFixedString(running, PCT_SCALE),
    };
  });
}

/**
 * Scales arbitrary non-negative monthly weights so they sum to 100% — used by the UI's
 * "normalizar" action when a user-typed curve sums to e.g. 99,9999%.
 */
export function normalizeCurveWeights(weights: readonly (string | number)[]): CurvePoint[] {
  const values = weights.map((w, i) => toDecimal(w, `período ${i + 1}`));
  if (values.length === 0 || values.some((v) => v.isNegative()) || sum(values).isZero()) {
    throw new EngineValidationError([
      issue(
        'CURVE_CANNOT_NORMALIZE',
        'Informe pelo menos um percentual positivo e nenhum negativo.',
      ),
    ]);
  }
  return canonicalizeCurve(
    allocateLargestRemainder(values, ONE, PCT_SCALE).map((m, i) => ({
      period: i + 1,
      monthlyPct: m.toString(),
    })),
  );
}

/** Builds monthly points from a cumulative column (as usually typed in spreadsheets). */
export function curveFromCumulative(cumulative: readonly (string | number)[]): CurvePointInput[] {
  let previous = ZERO;
  return cumulative.map((c, i) => {
    const current = toDecimal(c, `acumulado período ${i + 1}`);
    const monthly = current.minus(previous);
    previous = current;
    return { period: i + 1, monthlyPct: monthly.toString(), cumulativePct: current.toString() };
  });
}

/**
 * Adapts a curve of `n` points to a work of `durationMonths` months.
 *
 * The curve is treated as a continuous cumulative function F(t), t ∈ [0,1], linear between
 * points (F(i/n) = cumulative_i, F(0) = 0). Month k receives F(k/D) − F((k−1)/D).
 * When n = D the curve is reproduced exactly. Output weights are unrounded.
 */
export function resampleCurve(
  points: readonly CurvePointInput[],
  durationMonths: number,
): Decimal[] {
  const monthly = points.map((p) => toDecimal(p.monthlyPct));
  const n = monthly.length;
  if (n === durationMonths) return monthly;

  const cumulative: Decimal[] = [ZERO];
  monthly.forEach((m, i) => cumulative.push((cumulative[i] ?? ZERO).plus(m)));

  const F = (k: number): Decimal => {
    const x = new Decimal(k).times(n).div(durationMonths);
    const i = x.floor().toNumber();
    if (i >= n) return cumulative[n] ?? ONE;
    const lower = cumulative[i] ?? ZERO;
    const upper = cumulative[i + 1] ?? lower;
    return lower.plus(upper.minus(lower).times(x.minus(i)));
  };

  return Array.from({ length: durationMonths }, (_, idx) => F(idx + 1).minus(F(idx)));
}
