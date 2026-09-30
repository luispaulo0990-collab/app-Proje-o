import { describe, expect, it } from 'vitest';
import {
  EngineValidationError,
  buildConsolidatedPanel,
  buildCurveSeries,
  calculateProjection,
  hasWorkStarted,
  pointsFromMonths,
  resolveEffectiveCurve,
} from '../src/index.js';
import { FLAT_4, UNITA_22, toPoints } from './fixtures.js';

const OWN_3 = toPoints(['0.2', '0.5', '0.3']);

describe('hasWorkStarted', () => {
  it('is true from the start month on (competence)', () => {
    expect(hasWorkStarted('2026-09-15', '2026-08-01')).toBe(false);
    expect(hasWorkStarted('2026-09-15', '2026-09-01')).toBe(true);
    expect(hasWorkStarted('2026-09-15', '2027-01-01')).toBe(true);
  });
});

describe('resolveEffectiveCurve', () => {
  const base = { startDate: '2026-09-01', durationMonths: 4, parametric: FLAT_4 };

  it('uses the parametric curve for works not started, even with an own curve', () => {
    const r = resolveEffectiveCurve({
      ...base,
      referenceMonth: '2026-08-01',
      actual: { startMonth: '2026-09-01', points: OWN_3 },
    });
    expect(r).toMatchObject({ source: 'PARAMETRIC', status: 'NOT_STARTED', durationMonths: 4 });
    expect(r.issues.map((i) => i.code)).toEqual(['ACTUAL_CURVE_NOT_IN_FORCE']);
  });

  it('uses the own curve (own start and length) for started works', () => {
    const r = resolveEffectiveCurve({
      ...base,
      referenceMonth: '2026-10-01',
      actual: { startMonth: '2026-10-01', points: OWN_3 },
    });
    expect(r).toMatchObject({
      source: 'WORK_ACTUAL',
      status: 'STARTED_ACTUAL',
      startDate: '2026-10-01',
      durationMonths: 3,
    });
    expect(r.curve.map((p) => p.cumulativePct)).toEqual(['0.20000000', '0.70000000', '1.00000000']);
    expect(r.issues).toEqual([]);
  });

  it('falls back to parametric with a warning when a started work has no own curve', () => {
    const r = resolveEffectiveCurve({ ...base, referenceMonth: '2026-09-01', actual: null });
    expect(r).toMatchObject({ source: 'PARAMETRIC', status: 'STARTED_AWAITING_ACTUAL' });
    expect(r.issues[0]).toMatchObject({ code: 'ACTUAL_CURVE_MISSING', severity: 'WARNING' });
  });

  it('rejects an invalid own curve', () => {
    expect(() =>
      resolveEffectiveCurve({
        ...base,
        referenceMonth: '2026-10-01',
        actual: { startMonth: '2026-09-01', points: toPoints(['0.5', '0.4']) },
      }),
    ).toThrow(EngineValidationError);
  });
});

describe('buildCurveSeries', () => {
  it('matches the original physical values of the ProjectionEngine (resampled)', () => {
    const series = buildCurveSeries('2027-01-01', 24, toPoints(UNITA_22));
    const projection = calculateProjection({
      startDate: '2027-01-01',
      durationMonths: 24,
      curve: toPoints(UNITA_22),
      budget: '1000000.00',
      feeRate: '0.1',
    });
    expect(series.map((c) => c.monthly)).toEqual(projection.physical.map((c) => c.original));
    expect(series.at(-1)?.cumulative).toBe('1.00000000');
    expect(series[0]?.label).toBe('JAN/27');
  });
});

describe('pointsFromMonths', () => {
  it('sorts months and builds contiguous points', () => {
    const r = pointsFromMonths([
      { month: '2026-12-01', monthlyPct: '0.5' },
      { month: '2026-11-01', monthlyPct: '0.5' },
    ]);
    expect(r.startMonth).toBe('2026-11-01');
    expect(r.points).toEqual([
      { period: 1, monthlyPct: '0.5' },
      { period: 2, monthlyPct: '0.5' },
    ]);
    expect(r.issues).toEqual([]);
  });

  it('reports gaps (across year boundary) and duplicates', () => {
    const gap = pointsFromMonths([
      { month: '2026-12-01', monthlyPct: '0.5' },
      { month: '2027-02-01', monthlyPct: '0.5' },
    ]);
    expect(gap.issues[0]).toMatchObject({ code: 'CURVE_MONTH_GAP' });
    expect(gap.issues[0]?.message).toContain('2027-01-01');
    const dup = pointsFromMonths([
      { month: '2026-12-01', monthlyPct: '0.5' },
      { month: '2026-12-01', monthlyPct: '0.5' },
    ]);
    expect(dup.issues[0]).toMatchObject({ code: 'CURVE_MONTH_DUPLICATED' });
  });
});

describe('buildConsolidatedPanel', () => {
  const a = calculateProjection({
    startDate: '2026-11-01',
    durationMonths: 4,
    curve: FLAT_4,
    budget: '1000000.00',
    feeRate: '0.10',
  });
  const b = calculateProjection({
    startDate: '2027-01-01',
    durationMonths: 4,
    curve: FLAT_4,
    budget: '400000.00',
    feeRate: '0.10',
    feeLagMonths: 1,
  });
  const panel = buildConsolidatedPanel(
    [
      { workId: 'a', physical: a.physical, fee: a.fee },
      { workId: 'b', physical: b.physical, fee: b.fee },
    ],
    '2027-01-01',
  );

  it('flags the reference month and totals per year', () => {
    expect(panel.months.filter((m) => m.isReference).map((m) => m.label)).toEqual(['JAN/27']);
    expect(panel.years).toEqual([
      { year: 2026, feeTotal: '50000.00' },
      { year: 2027, feeTotal: '90000.00' },
    ]);
  });

  it('splits received / receivable per work and in total', () => {
    expect(panel.works).toEqual([
      {
        workId: 'a',
        feeProjected: '100000.00',
        feeRealized: '75000.00',
        feeRemaining: '25000.00',
        feeAtReference: '25000.00',
        physicalAccumulated: '0.75000000',
        activeAtReference: true,
      },
      {
        workId: 'b',
        feeProjected: '40000.00',
        feeRealized: '0.00',
        feeRemaining: '40000.00',
        feeAtReference: '0.00',
        physicalAccumulated: '0.25000000',
        activeAtReference: true,
      },
    ]);
    expect(panel.totals).toEqual({
      worksCount: 2,
      activeWorksAtReference: 2,
      feeProjected: '140000.00',
      feeRealized: '75000.00',
      feeRemaining: '65000.00',
      feeAtReference: '25000.00',
      feeYearToDateAtReference: '25000.00',
    });
  });

  it('sum of received + receivable always equals projected', () => {
    for (const ref of ['2026-10-01', '2026-12-01', '2027-03-01', '2028-01-01']) {
      const p = buildConsolidatedPanel([{ workId: 'a', physical: a.physical, fee: a.fee }], ref);
      const t = p.totals;
      expect(Number(t.feeRealized) * 100 + Number(t.feeRemaining) * 100).toBe(
        Number(t.feeProjected) * 100,
      );
    }
  });
});
