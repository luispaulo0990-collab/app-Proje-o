import { describe, expect, it } from 'vitest';
import { aggregatePortfolio, calculateProjection, computeKpis } from '../src/index.js';
import { FLAT_4 } from './fixtures.js';

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

describe('computeKpis', () => {
  it('splits realized and remaining at the reference month', () => {
    const k = computeKpis(a, '2026-12-01');
    expect(k).toMatchObject({
      feeProjected: '100000.00',
      feeRealized: '50000.00',
      feeRemaining: '50000.00',
      physicalAccumulated: '0.50000000',
      physicalProjected: '1.00000000',
      elapsedMonths: 2,
      durationMonths: 4,
      endDate: '2027-02-28',
    });
  });

  it('clamps elapsed months before start and after end', () => {
    expect(computeKpis(a, '2026-01-01').elapsedMonths).toBe(0);
    expect(computeKpis(a, '2030-01-01').elapsedMonths).toBe(4);
  });
});

describe('aggregatePortfolio', () => {
  const p = aggregatePortfolio([
    { workId: 'a', physical: a.physical, fee: a.fee },
    { workId: 'b', physical: b.physical, fee: b.fee },
  ]);

  it('builds a continuous monthly axis covering every work', () => {
    expect(p.months.map((m) => m.label)).toEqual([
      'NOV/26',
      'DEZ/26',
      'JAN/27',
      'FEV/27',
      'MAR/27',
      'ABR/27',
      'MAI/27',
    ]);
  });

  it('totals fee per month and resets year-to-date in January', () => {
    expect(p.months.map((m) => m.feeTotal)).toEqual([
      '25000.00',
      '25000.00',
      '25000.00',
      '35000.00',
      '10000.00',
      '10000.00',
      '10000.00',
    ]);
    expect(p.months.map((m) => m.feeYearToDate)).toEqual([
      '25000.00',
      '50000.00',
      '25000.00',
      '60000.00',
      '70000.00',
      '80000.00',
      '90000.00',
    ]);
    expect(p.feeGrandTotal).toBe('140000.00');
  });

  it('counts active works per month', () => {
    expect(p.months.map((m) => m.activeWorks)).toEqual([1, 1, 2, 2, 1, 1, 0]);
  });

  it('returns an empty aggregate for no works', () => {
    expect(aggregatePortfolio([])).toEqual({ months: [], feeGrandTotal: '0.00' });
  });
});
