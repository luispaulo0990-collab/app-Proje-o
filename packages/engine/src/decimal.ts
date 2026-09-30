import DecimalBase from 'decimal.js';

/**
 * Isolated Decimal constructor for the engine. Using a clone guarantees that no other
 * library configuring the global Decimal can change the engine's precision or rounding.
 */
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_EVEN,
  toExpNeg: -30,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

/** Fractions (0.0147 = 1,47%) are kept with 8 decimals ≡ percentage with 6 decimals. */
export const PCT_SCALE = 8;
/** Monetary values are kept with 2 decimals (centavos). */
export const MONEY_SCALE = 2;
/** Tolerance used when checking that a curve sums to 100%. */
export const PCT_TOLERANCE = new Decimal('1e-8');

export type DecimalInput = string | number | Decimal;

export function toDecimal(value: DecimalInput, field = 'value'): Decimal {
  try {
    const d = new Decimal(value);
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw new TypeError(`Valor numérico inválido em "${field}": ${String(value)}`);
  }
}

export function roundTo(value: Decimal, scale: number): Decimal {
  return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
}

/** Serialises with a fixed number of decimals — the canonical wire/database format. */
export function toFixedString(value: Decimal, scale: number): string {
  return roundTo(value, scale).toFixed(scale);
}

export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
