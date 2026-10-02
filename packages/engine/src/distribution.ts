import { allocateLargestRemainder } from './allocation.js';
import { Decimal, ZERO, sum } from './decimal.js';
import { issue } from './errors.js';
import type { Series, ValidationIssue } from './types.js';

/** Values of a series plus the positions typed by the user. */
export interface Distribution {
  values: Decimal[];
  manual: Set<number>;
}

/**
 * Keeps manual cells and spreads what is left of `total` over the remaining cells,
 * proportionally to `weights`. Guarantees Σ = total whenever at least one free cell exists.
 */
export function distribute(
  weights: readonly Decimal[],
  manual: ReadonlyMap<number, Decimal>,
  total: Decimal,
  scale: number,
  series: Series,
  issues: ValidationIssue[],
): Distribution {
  const manualSum = sum([...manual.values()]);
  if (manualSum.greaterThan(total)) {
    issues.push(
      issue(
        'MANUAL_EXCEEDS_TOTAL',
        `Os ajustes manuais (${manualSum.toString()}) ultrapassam o total da série ${series} (${total.toString()}).`,
        { series },
      ),
    );
    return { values: weights.map(() => ZERO), manual: new Set(manual.keys()) };
  }
  const freeIdx = weights.map((_, i) => i).filter((i) => !manual.has(i));
  const remaining = total.minus(manualSum);
  const values = weights.map((_, i) => manual.get(i) ?? ZERO);

  if (freeIdx.length === 0) {
    if (!remaining.isZero()) {
      issues.push(
        issue(
          'SERIES_TOTAL_MISMATCH',
          `Todos os períodos da série ${series} são manuais e somam ${manualSum.toString()} (esperado ${total.toString()}).`,
          { series },
          'WARNING',
        ),
      );
    }
    return { values, manual: new Set(manual.keys()) };
  }
  const freeWeights = freeIdx.map((i) => weights[i] ?? ZERO);
  if (sum(freeWeights).isZero() && remaining.greaterThan(0)) {
    issues.push(
      issue(
        'REDISTRIBUTION_UNIFORM',
        `A curva não possui peso nos períodos livres da série ${series}; o saldo foi distribuído igualmente.`,
        { series },
        'WARNING',
      ),
    );
  }
  allocateLargestRemainder(freeWeights, remaining, scale).forEach((v, k) => {
    const idx = freeIdx[k];
    if (idx !== undefined) values[idx] = v;
  });
  return { values, manual: new Set(manual.keys()) };
}
