import { describe, expect, it } from 'vitest';
import { buildTrendCurve, resolveEffectiveCurve, type RealizedEntry } from '../src/index.js';
import { FLAT_4, toPoints } from './fixtures.js';

/*
 * Replanned ("Replanejado Atual Acumulado - Obra") from JAN/26: 3% · 3% · 3%, then the plan
 * asks 15% a month (ABR..AGO) and 16% in SET = 100%.
 */
const REPLANNED = {
  startMonth: '2026-01-01',
  points: toPoints(['0.03', '0.03', '0.03', '0.15', '0.15', '0.15', '0.15', '0.15', '0.16']),
};
/** "Realizado Acumulado": the work did exactly 3% a month in JAN..MAR. */
const REALIZED: RealizedEntry[] = [
  { month: '2026-01-01', realizedCumulative: '0.03' },
  { month: '2026-02-01', realizedCumulative: '0.06' },
  { month: '2026-03-01', realizedCumulative: '0.09' },
];
const monthly = (points: { monthlyPct: string }[]) => points.map((p) => p.monthlyPct);

describe('trend curve (realized + trend)', () => {
  it('blends plan and pace and keeps the replanned deadline', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-03-01',
      replanned: REPLANNED,
      realized: REALIZED,
    });
    expect(t?.startMonth).toBe('2026-01-01');
    // On schedule (3% a month, as planned): 91% left over ABR..SET in proportion to
    // 0,6 × plan + 0,4 × 3% (10,2% × 5 · 10,8%; Σ 61,8%) → ≈ the replanned curve, same end.
    const values = monthly(t?.points ?? []);
    expect(values).toHaveLength(9);
    expect(values[3]).toBe('0.15019418'); // 91% × 10,2 ÷ 61,8
    expect(values[8]).toBe('0.15902913'); // 91% × 10,8 ÷ 61,8
    expect(t?.points.at(-1)?.cumulativePct).toBe('1.00000000');
    expect(t?.info).toEqual({
      lastRealizedMonth: '2026-03-01',
      realizedCumulative: '0.09000000',
      averagePace: '0.03000000',
      windowMonths: 3,
      planWeight: '0.60',
      endMonth: '2026-09-01',
    });
  });

  it('makes a behind-schedule work absorb the backlog up to the deadline, flattened', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-03-01',
      // Plan: 5% · 5% · 5% then 15% a month and 10% in SET; the work did only 3% a month.
      replanned: {
        startMonth: '2026-01-01',
        points: toPoints(['0.05', '0.05', '0.05', '0.15', '0.15', '0.15', '0.15', '0.15', '0.10']),
      },
      realized: REALIZED,
    });
    // 91% left; weights 10,2% × 5 and 7,2% (Σ 58,2%) → 15,95% where the plan asks 15% and
    // 11,26% where it asks 10%: still ends in SET/26.
    expect(monthly(t?.points ?? [])).toEqual([
      '0.03000000',
      '0.03000000',
      '0.03000000',
      '0.15948454',
      '0.15948454',
      '0.15948454',
      '0.15948453',
      '0.15948453',
      '0.11257732',
    ]);
  });

  it('treats the current month without progress as the first trend month', () => {
    const withoutProgress = buildTrendCurve({
      referenceMonth: '2026-04-01',
      replanned: REPLANNED,
      realized: [...REALIZED, { month: '2026-04-01', realizedCumulative: '0.09' }],
    });
    const notPublished = buildTrendCurve({
      referenceMonth: '2026-04-01',
      replanned: REPLANNED,
      realized: REALIZED,
    });
    for (const t of [withoutProgress, notPublished]) {
      expect(t?.info.lastRealizedMonth).toBe('2026-03-01');
      expect(t?.points).toHaveLength(9);
      expect(t?.points[2]?.cumulativePct).toBe('0.09000000');
    }
  });

  it('uses the progress of the current month when it is already published', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-04-01',
      replanned: REPLANNED,
      realized: [...REALIZED, { month: '2026-04-01', realizedCumulative: '0.15' }],
    });
    expect(t?.info).toMatchObject({ lastRealizedMonth: '2026-04-01', averagePace: '0.04000000' });
    expect(t?.points[3]?.monthlyPct).toBe('0.06000000');
    expect(t?.points.at(-1)?.cumulativePct).toBe('1.00000000');
  });

  it('spreads the rest up to the deadline even when the work is faster', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-01-01',
      replanned: { startMonth: '2026-01-01', points: FLAT_4 },
      realized: [{ month: '2026-01-01', realizedCumulative: '0.40' }],
    });
    expect(monthly(t?.points ?? [])).toEqual([
      '0.40000000',
      '0.20000000',
      '0.20000000',
      '0.20000000',
    ]);
  });

  it('puts the rest in the next month when the deadline has already passed', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-06-01',
      replanned: { startMonth: '2026-01-01', points: FLAT_4 },
      realized: [{ month: '2026-04-01', realizedCumulative: '0.80' }],
    });
    expect(monthly(t?.points ?? []).slice(-2)).toEqual(['0.80000000', '0.20000000']);
    expect(t?.issues.map((i) => i.code)).toContain('TREND_PAST_DEADLINE');
  });

  it('never produces a negative month when the realized is corrected downwards', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-03-01',
      replanned: REPLANNED,
      realized: [...REALIZED.slice(0, 2), { month: '2026-03-01', realizedCumulative: '0.05' }],
    });
    expect(t?.issues.map((i) => i.code)).toContain('REALIZED_DECREASING');
    expect(t?.points.every((p) => !p.monthlyPct.startsWith('-'))).toBe(true);
  });

  it('returns null without realized progress', () => {
    expect(
      buildTrendCurve({ referenceMonth: '2026-03-01', replanned: REPLANNED, realized: [] }),
    ).toBeNull();
  });
});

describe('resolveEffectiveCurve with realized progress', () => {
  const base = {
    startDate: '2026-01-01',
    durationMonths: 4,
    referenceMonth: '2026-03-01',
    parametric: FLAT_4,
    actual: REPLANNED,
  };

  it('uses realized + trend for a started work with own curve and realized data', () => {
    const e = resolveEffectiveCurve({ ...base, realized: REALIZED });
    expect(e).toMatchObject({
      source: 'WORK_ACTUAL',
      status: 'STARTED_ACTUAL',
      durationMonths: 9,
    });
    expect(e.trend?.lastRealizedMonth).toBe('2026-03-01');
  });

  it('keeps the replanned curve as received while no realized progress exists', () => {
    const e = resolveEffectiveCurve(base);
    expect(e).toMatchObject({ durationMonths: 9, trend: null });
  });

  it('changes the fingerprint when a new realized month arrives', () => {
    const before = resolveEffectiveCurve({ ...base, realized: REALIZED });
    const after = resolveEffectiveCurve({
      ...base,
      referenceMonth: '2026-04-01',
      realized: [...REALIZED, { month: '2026-04-01', realizedCumulative: '0.12' }],
    });
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(resolveEffectiveCurve({ ...base, realized: REALIZED }).fingerprint).toBe(
      before.fingerprint,
    );
  });
});
