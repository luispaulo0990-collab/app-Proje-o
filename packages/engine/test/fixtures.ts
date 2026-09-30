import type { CurvePointInput } from '../src/types.js';

/** Standard 22-month curve used in "Painel de obras.xlsx" (Vila das Belezas, Mooca, Tucuruvi). */
export const UNITA_22 = [
  '0.004',
  '0.012',
  '0.02',
  '0.025',
  '0.03',
  '0.03',
  '0.04',
  '0.045',
  '0.05',
  '0.07',
  '0.07',
  '0.07',
  '0.07',
  '0.075',
  '0.075',
  '0.07',
  '0.07',
  '0.07',
  '0.05',
  '0.03',
  '0.02',
  '0.004',
];

export function toPoints(values: readonly string[]): CurvePointInput[] {
  return values.map((monthlyPct, i) => ({ period: i + 1, monthlyPct }));
}

export const FLAT_4 = toPoints(['0.25', '0.25', '0.25', '0.25']);
