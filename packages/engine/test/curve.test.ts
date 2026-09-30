import { describe, expect, it } from 'vitest';
import {
  Decimal,
  canonicalizeCurve,
  curveFromCumulative,
  normalizeCurveWeights,
  resampleCurve,
  validateCurve,
} from '../src/index.js';
import { FLAT_4, UNITA_22, toPoints } from './fixtures.js';

const codes = (points: Parameters<typeof validateCurve>[0]) =>
  validateCurve(points).map((i) => i.code);

describe('validateCurve', () => {
  it('accepts the standard spreadsheet curve', () => {
    expect(validateCurve(toPoints(UNITA_22))).toEqual([]);
  });

  it('R3 — rejects negative monthly percentages', () => {
    expect(codes(toPoints(['0.6', '-0.1', '0.5']))).toContain('CURVE_NEGATIVE_MONTHLY');
  });

  it('R1 — rejects decreasing cumulative', () => {
    const points = [
      { period: 1, monthlyPct: '0.5', cumulativePct: '0.5' },
      { period: 2, monthlyPct: '0', cumulativePct: '0.4' },
      { period: 3, monthlyPct: '0.5', cumulativePct: '1' },
    ];
    expect(codes(points)).toEqual(
      expect.arrayContaining(['CURVE_CUMULATIVE_DECREASING', 'CURVE_CUMULATIVE_MISMATCH']),
    );
  });

  it('R4 — rejects sums different from 100%', () => {
    expect(codes(toPoints(['0.333333', '0.333333', '0.333333']))).toContain('CURVE_SUM_NOT_100');
    expect(codes(toPoints(['0.5', '0.6']))).toEqual(
      expect.arrayContaining(['CURVE_SUM_NOT_100', 'CURVE_CUMULATIVE_ABOVE_100']),
    );
  });

  it('rejects empty curves and non-sequential periods', () => {
    expect(codes([])).toEqual(['CURVE_EMPTY']);
    expect(codes([{ period: 2, monthlyPct: '1' }])).toContain('CURVE_PERIOD_SEQUENCE');
  });

  it('accepts float noise within tolerance (0.0199999999999 from Excel)', () => {
    const excel = [...UNITA_22];
    excel[20] = '0.0199999999999';
    expect(validateCurve(toPoints(excel))).toEqual([]);
  });
});

describe('canonicalizeCurve', () => {
  it('stores 8-decimal fractions that sum exactly to 1 and derives cumulative', () => {
    const excel = [...UNITA_22];
    excel[20] = '0.0199999999999';
    const c = canonicalizeCurve(toPoints(excel));
    expect(c[20]?.monthlyPct).toBe('0.02000000');
    expect(c.at(-1)?.cumulativePct).toBe('1.00000000');
    expect(c.reduce((a, p) => a.plus(p.monthlyPct), new Decimal(0)).toString()).toBe('1');
  });
});

describe('normalizeCurveWeights', () => {
  it('turns 3 × 33,3333% into a valid 100% curve', () => {
    const c = normalizeCurveWeights(['0.333333', '0.333333', '0.333333']);
    expect(c.map((p) => p.monthlyPct)).toEqual(['0.33333334', '0.33333333', '0.33333333']);
    expect(c.at(-1)?.cumulativePct).toBe('1.00000000');
  });
});

describe('curveFromCumulative', () => {
  it('derives monthly values from a cumulative column', () => {
    const points = curveFromCumulative(['0.02', '0.05', '0.10', '1']);
    expect(points.map((p) => new Decimal(p.monthlyPct).toString())).toEqual([
      '0.02',
      '0.03',
      '0.05',
      '0.9',
    ]);
    expect(validateCurve(points)).toEqual([]);
  });
});

describe('resampleCurve', () => {
  it('reproduces the curve when duration equals the number of points', () => {
    expect(resampleCurve(toPoints(UNITA_22), 22).map((d) => d.toString())).toEqual(
      UNITA_22.map((v) => new Decimal(v).toString()),
    );
  });

  it('stretches a flat curve to a longer duration keeping it flat', () => {
    const w = resampleCurve(FLAT_4, 8);
    expect(w.map((d) => d.toString())).toEqual(Array(8).fill('0.125'));
  });

  it('compresses a flat curve to a shorter duration', () => {
    expect(resampleCurve(FLAT_4, 2).map((d) => d.toString())).toEqual(['0.5', '0.5']);
  });

  it('always keeps the total at 100% for arbitrary durations', () => {
    for (const d of [1, 7, 13, 24, 36, 60]) {
      const total = resampleCurve(toPoints(UNITA_22), d).reduce(
        (a, b) => a.plus(b),
        new Decimal(0),
      );
      expect(total.minus(1).abs().lessThan('1e-30')).toBe(true);
    }
  });
});
