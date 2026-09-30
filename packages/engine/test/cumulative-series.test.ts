import { describe, expect, it } from 'vitest';
import { canonicalizeCurve, curveFromCumulativeSeries, pointsFromMonths } from '../src/index.js';

const series = (values: (string | number)[], start = 2026) =>
  values.map((cumulative, i) => ({
    month: `${start + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
    cumulative,
  }));

describe('curveFromCumulativeSeries', () => {
  it('converts cumulative to monthly and trims leading zeros and trailing 100%', () => {
    const r = curveFromCumulativeSeries(series([0, 0, 0.2, 0.5, 1, 1, 1]));
    expect(r.issues).toEqual([]);
    expect(r.startMonth).toBe('2026-03-01');
    expect(r.months).toEqual([
      { month: '2026-03-01', monthlyPct: '0.2' },
      { month: '2026-04-01', monthlyPct: '0.3' },
      { month: '2026-05-01', monthlyPct: '0.5' },
    ]);
    expect(r.needsNormalization).toBe(false);
  });

  it('accepts unsorted input and fills gaps with the previous cumulative', () => {
    const r = curveFromCumulativeSeries([
      { month: '2026-04-01', cumulative: '1' },
      { month: '2026-01-01', cumulative: '0.4' },
    ]);
    expect(r.months.map((m) => m.monthlyPct)).toEqual(['0.4', '0', '0', '0.6']);
  });

  it('flags values within tolerance of 100% for normalization', () => {
    const r = curveFromCumulativeSeries(series([0.3, 0.9985]));
    expect(r.issues).toEqual([]);
    expect(r.needsNormalization).toBe(true);
  });

  it('rejects series that decrease, do not reach 100% or repeat months', () => {
    expect(curveFromCumulativeSeries(series([0.5, 0.4, 1])).issues[0]?.code).toBe(
      'CUMULATIVE_DECREASING',
    );
    expect(curveFromCumulativeSeries(series([0.5, 0.8])).issues[0]?.code).toBe(
      'CUMULATIVE_NOT_100',
    );
    expect(
      curveFromCumulativeSeries([
        { month: '2026-01-01', cumulative: 0.5 },
        { month: '2026-01-01', cumulative: 0.6 },
      ]).issues[0]?.code,
    ).toBe('CUMULATIVE_DUPLICATED');
    expect(curveFromCumulativeSeries([]).issues[0]?.code).toBe('CUMULATIVE_EMPTY');
  });

  it('produces a valid canonical curve end-to-end (real-world noise)', () => {
    const r = curveFromCumulativeSeries(
      series([0.290771973, 0.413853614, 0.424275584, 0.708240684, 1]),
    );
    const { points } = pointsFromMonths(r.months);
    const canonical = canonicalizeCurve(points);
    expect(canonical.at(-1)?.cumulativePct).toBe('1.00000000');
    expect(canonical[0]?.monthlyPct).toBe('0.29077197');
  });
});
