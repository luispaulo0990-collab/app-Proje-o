import { describe, expect, it } from 'vitest';
import {
  Decimal,
  EngineValidationError,
  calculateProjection,
  computeProgressIndicators,
  hydrateProjection,
  monthsIncurred,
  projectedEndMonth,
  type ProjectionInput,
} from '../src/index.js';
import { FLAT_4, UNITA_22, toPoints } from './fixtures.js';

const sumOf = (cells: { current: string }[]) =>
  cells.reduce((a, c) => a.plus(c.current), new Decimal(0)).toFixed(2);
const sumFrom = (cells: { month: string; current: string }[], from: string) =>
  sumOf(cells.filter((c) => c.month >= from));

const flat: ProjectionInput = {
  startDate: '2027-01-01',
  durationMonths: 4,
  curve: FLAT_4,
  budget: '1000000.00',
  feeRate: '0.10',
  feeLagMonths: 0,
};

describe('fee recalibration ("Ajuste projeção de taxa")', () => {
  it('keeps months before the adjustment and spreads the new remaining by the curve', () => {
    const r = calculateProjection({
      ...flat,
      feeRecalibration: { fromMonth: '2027-03-01', remainingTotal: '60000.00' },
    });
    expect(r.fee.map((c) => c.current)).toEqual(['25000.00', '25000.00', '30000.00', '30000.00']);
    // `original` keeps what the curve alone produced (traceability of the recalibration).
    expect(r.fee.map((c) => c.original)).toEqual(['25000.00', '25000.00', '25000.00', '25000.00']);
    expect(r.fee.every((c) => c.origin === 'CURVE')).toBe(true);
    expect(r.totals.fee).toBe('110000.00');
    expect(r.totals.expectedFee).toBe('110000.00');
    expect(r.parameters.feeRecalibration).toEqual({
      fromMonth: '2027-03-01',
      remainingTotal: '60000.00',
    });
  });

  it('sums exactly to the informed value with the real 22-month curve and fee lag', () => {
    const r = calculateProjection({
      startDate: '2025-04-01',
      durationMonths: 22,
      curve: toPoints(UNITA_22),
      budget: '44187790.05',
      feeRate: '0.09',
      feeLagMonths: 3,
      feeRecalibration: { fromMonth: '2026-10-01', remainingTotal: '1234567.89' },
    });
    expect(sumFrom(r.fee, '2026-10-01')).toBe('1234567.89');
    const before = r.fee.filter((c) => c.month < '2026-10-01');
    expect(before.every((c) => c.current === c.original)).toBe(true);
    expect(r.validations).toEqual([]);
  });

  it('accepts reducing the remaining to zero', () => {
    const r = calculateProjection({
      ...flat,
      feeRecalibration: { fromMonth: '2027-02-01', remainingTotal: '0' },
    });
    expect(r.fee.map((c) => c.current)).toEqual(['25000.00', '0.00', '0.00', '0.00']);
  });

  it('keeps manual fee cells inside the window and distributes the rest', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [{ series: 'FEE', periodIndex: 4, value: '10000' }],
      feeRecalibration: { fromMonth: '2027-03-01', remainingTotal: '50000.00' },
    });
    expect(r.fee.map((c) => c.current).slice(2)).toEqual(['40000.00', '10000.00']);
    expect(r.fee[3]?.origin).toBe('MANUAL');
  });

  it('rejects a window after the end of the fee horizon', () => {
    expect(() =>
      calculateProjection({
        ...flat,
        feeRecalibration: { fromMonth: '2027-05-01', remainingTotal: '1.00' },
      }),
    ).toThrow(EngineValidationError);
  });

  it('rejects negative values, more than 2 decimals and manual cells above the value', () => {
    for (const remainingTotal of ['-1', '1.001']) {
      expect(() =>
        calculateProjection({
          ...flat,
          feeRecalibration: { fromMonth: '2027-02-01', remainingTotal },
        }),
      ).toThrow(EngineValidationError);
    }
    expect(() =>
      calculateProjection({
        ...flat,
        manualCells: [{ series: 'FEE', periodIndex: 4, value: '20000' }],
        feeRecalibration: { fromMonth: '2027-03-01', remainingTotal: '10000.00' },
      }),
    ).toThrow(/ultrapassam o valor informado/);
  });

  it('hydrates a recalibrated projection without total mismatch warnings', () => {
    const feeRecalibration = { fromMonth: '2027-03-01', remainingTotal: '60000.00' };
    const r = calculateProjection({ ...flat, feeRecalibration });
    const toStored = (cells: typeof r.fee) =>
      cells.map((c) => ({
        periodIndex: c.periodIndex,
        original: c.original,
        current: c.current,
        origin: c.origin,
      }));
    const h = hydrateProjection({
      startDate: flat.startDate,
      durationMonths: 4,
      budget: flat.budget,
      feeRate: flat.feeRate,
      feeLagMonths: 0,
      feeRecalibration,
      physical: toStored(r.physical),
      fee: toStored(r.fee),
    });
    expect(h.totals.expectedFee).toBe('110000.00');
    expect(h.validations).toEqual([]);
  });
});

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
