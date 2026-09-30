import { Decimal, ZERO, sum } from './decimal.js';

/**
 * Splits `total` proportionally to `weights`, rounding each share to `scale` decimals while
 * guaranteeing that the rounded shares add up to `total` exactly (largest remainder / Hamilton).
 *
 * Determinism: ties on the remainder are resolved by the lowest index.
 * `total` must already be representable at `scale`; weights must be ≥ 0.
 * If every weight is zero the total is split evenly.
 */
export function allocateLargestRemainder(
  weights: readonly Decimal[],
  total: Decimal,
  scale: number,
): Decimal[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w.isNegative())) {
    throw new RangeError('Pesos de alocação não podem ser negativos.');
  }
  const unit = new Decimal(10).pow(-scale);
  const totalUnits = total.div(unit);
  if (!totalUnits.isInteger()) {
    throw new RangeError(`Total ${total.toString()} não é representável com ${scale} casas.`);
  }
  if (total.isNegative()) throw new RangeError('Total de alocação não pode ser negativo.');

  const weightSum = sum(weights);
  const effective = weightSum.isZero() ? weights.map(() => new Decimal(1)) : weights;
  const effectiveSum = weightSum.isZero() ? new Decimal(weights.length) : weightSum;

  const exactUnits = effective.map((w) => totalUnits.times(w).div(effectiveSum));
  const floors = exactUnits.map((u) => u.floor());
  let leftover = totalUnits.minus(sum(floors)).toNumber();

  const order = exactUnits
    .map((u, i) => ({ i, remainder: u.minus(floors[i] ?? ZERO) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i);

  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] = (floors[i] ?? ZERO).plus(1);
    leftover -= 1;
  }
  return floors.map((units) => units.times(unit));
}
