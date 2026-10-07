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
  it('blends the plan with the realized pace: plan 15%, pace 3% → 10,2%', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-03-01',
      replanned: REPLANNED,
      realized: REALIZED,
    });
    expect(t?.startMonth).toBe('2026-01-01');
    const values = monthly(t?.points ?? []);
    // JAN..MAR = realized; ABR..AGO = 0,6 × 15% + 0,4 × 3%; SET = 0,6 × 16% + 0,4 × 3%.
    expect(values.slice(0, 9)).toEqual([
      '0.03000000',
      '0.03000000',
      '0.03000000',
      '0.10200000',
      '0.10200000',
      '0.10200000',
      '0.10200000',
      '0.10200000',
      '0.10800000',
    ]);
    // 29,2% left after SET at the 3% pace: 9 × 3% + 2,2% → 10 more months (end moves out).
    expect(values).toHaveLength(19);
    expect(values.at(-1)).toBe('0.02200000');
    expect(t?.points.at(-1)?.cumulativePct).toBe('1.00000000');
    expect(t?.info).toEqual({
      lastRealizedMonth: '2026-03-01',
      realizedCumulative: '0.09000000',
      averagePace: '0.03000000',
      windowMonths: 3,
      planWeight: '0.60',
      extensionMonths: 10,
    });
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
      expect(t?.points[3]?.monthlyPct).toBe('0.10200000');
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
    // MAI: 0,6 × 15% + 0,4 × 4% (pace of FEV..ABR) = 10,6%
    expect(t?.points[4]?.monthlyPct).toBe('0.10600000');
  });

  it('finishes earlier than the plan when the work is faster', () => {
    const t = buildTrendCurve({
      referenceMonth: '2026-01-01',
      replanned: { startMonth: '2026-01-01', points: FLAT_4 },
      realized: [{ month: '2026-01-01', realizedCumulative: '0.40' }],
    });
    // FEV/MAR: 0,6 × 25% + 0,4 × 40% = 31% → the 3rd month only needs the remaining 29%.
    expect(monthly(t?.points ?? [])).toEqual(['0.40000000', '0.31000000', '0.29000000']);
    expect(t?.info.extensionMonths).toBe(0);
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
      durationMonths: 19,
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
