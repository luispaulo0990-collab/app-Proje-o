import { describe, expect, it } from 'vitest';
import {
  calculateProjection,
  computeProgressIndicators,
  monthsIncurred,
  projectedEndMonth,
  type ProjectionInput,
} from '../src/index.js';
import { FLAT_4, toPoints } from './fixtures.js';

const flat: ProjectionInput = {
  startDate: '2027-01-01',
  durationMonths: 4,
  curve: FLAT_4,
  budget: '1000000.00',
  feeRate: '0.10',
};

describe('progress indicators (Consolidado)', () => {
  const entries = [
    {
      month: '2026-07-01',
      realizedCumulative: '0.10',
      clientReplannedCumulative: '0.12',
      targetCumulative: '0.11',
    },
    {
      month: '2026-08-01',
      realizedCumulative: '0.141',
      clientReplannedCumulative: '0.15',
      targetCumulative: '0.25',
    },
    { month: '2026-09-01', realizedCumulative: '0.169' },
  ];

  it('is ATRASADA when replanned (client) < target, with the deviation', () => {
    const i = computeProgressIndicators(entries, '2026-09-01');
    expect(i.realizedMonth).toBe('2026-09-01');
    expect(i.realizedCumulative).toBe('0.16900000');
    expect(i.realizedMonthly).toBe('0.02800000');
    // September has no client/target yet → latest month with both (August).
    expect(i.statusMonth).toBe('2026-08-01');
    expect(i.clientStatus).toBe('ATRASADA');
    expect(i.deviation).toBe('-0.10000000');
  });

  it('is OK when replanned ≥ target (equal counts as OK)', () => {
    expect(computeProgressIndicators(entries, '2026-07-01').clientStatus).toBe('OK');
    const equal = computeProgressIndicators(
      [{ month: '2026-01-01', clientReplannedCumulative: '0.5', targetCumulative: '0.50000000' }],
      '2026-01-01',
    );
    expect(equal.clientStatus).toBe('OK');
    expect(equal.deviation).toBe('0.00000000');
  });

  it('ignores months after the reference and reports missing data', () => {
    const i = computeProgressIndicators(entries, '2026-06-01');
    expect(i.clientStatus).toBe('SEM_DADOS');
    expect(i.realizedCumulative).toBeNull();
    expect(i.realizedMonthly).toBeNull();
  });

  it('first month of the work: monthly = cumulative; otherwise a gap means unknown', () => {
    expect(computeProgressIndicators(entries, '2026-07-01', '2026-07-01').realizedMonthly).toBe(
      '0.10000000',
    );
    // History starting mid-work: the month alone is unknown.
    expect(
      computeProgressIndicators(entries, '2026-07-01', '2025-01-01').realizedMonthly,
    ).toBeNull();
    const gap = computeProgressIndicators(
      [
        { month: '2026-01-01', realizedCumulative: '0.1' },
        { month: '2026-03-01', realizedCumulative: '0.3' },
      ],
      '2026-03-01',
    );
    expect(gap.realizedMonthly).toBeNull();
  });
});

describe('schedule indicators', () => {
  it('projected end = first month the physical curve reaches 100%', () => {
    const r = calculateProjection({ ...flat, curve: toPoints(['0.5', '0.5', '0', '0']) });
    expect(projectedEndMonth(r.physical)).toBe('2027-02-01');
    const full = calculateProjection(flat);
    expect(projectedEndMonth(full.physical)).toBe('2027-04-01');
  });

  it('months incurred count the start month and are zero before it', () => {
    expect(monthsIncurred('2025-04-01', '2026-09-01')).toBe(18);
    expect(monthsIncurred('2025-04-01', '2025-04-01')).toBe(1);
    expect(monthsIncurred('2027-01-01', '2026-09-01')).toBe(0);
  });
});
