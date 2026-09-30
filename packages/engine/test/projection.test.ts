import { describe, expect, it } from 'vitest';
import {
  Decimal,
  EngineValidationError,
  allocateLargestRemainder,
  calculateProjection,
  hydrateProjection,
  listManualCells,
  type ProjectionInput,
} from '../src/index.js';
import { FLAT_4, UNITA_22, toPoints } from './fixtures.js';

const sumOf = (cells: { current: string }[]) =>
  cells.reduce((a, c) => a.plus(c.current), new Decimal(0)).toString();

const base: ProjectionInput = {
  startDate: '2027-01-01',
  durationMonths: 22,
  curve: toPoints(UNITA_22),
  budget: '44187790.05',
  feeRate: '0.09',
  feeLagMonths: 0,
};

describe('allocateLargestRemainder', () => {
  it('splits R$ 100,00 in 3 exact parts', () => {
    const parts = allocateLargestRemainder(
      [1, 1, 1].map((n) => new Decimal(n)),
      new Decimal(100),
      2,
    );
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
  });

  it('is deterministic on ties (lowest index wins)', () => {
    const parts = allocateLargestRemainder(
      [1, 1].map((n) => new Decimal(n)),
      new Decimal('0.01'),
      2,
    );
    expect(parts.map((p) => p.toFixed(2))).toEqual(['0.01', '0.00']);
  });

  it('rejects a total not representable at the scale', () => {
    expect(() => allocateLargestRemainder([new Decimal(1)], new Decimal('0.001'), 2)).toThrow(
      RangeError,
    );
  });
});

describe('calculateProjection — automatic', () => {
  const r = calculateProjection(base);

  it('applies the curve month by month', () => {
    expect(r.physical).toHaveLength(22);
    expect(r.physical[0]).toMatchObject({
      month: '2027-01-01',
      label: 'JAN/27',
      current: '0.00400000',
      origin: 'CURVE',
    });
    expect(r.physical[13]?.current).toBe('0.07500000');
    expect(r.physical.at(-1)?.cumulative).toBe('1.00000000');
    expect(r.schedule.endDate).toBe('2028-10-31');
  });

  it('fee total = budget × rate, rounded to cents, and the months add up exactly', () => {
    // 44.187.790,05 × 9% = 3.976.901,1045 → 3.976.901,10
    expect(r.totals.expectedFee).toBe('3976901.10');
    expect(r.totals.fee).toBe('3976901.10');
    expect(sumOf(r.fee)).toBe('3976901.1');
    expect(r.fee[0]?.current).toBe('15907.60'); // 0.4% × 3.976.901,10 = 15.907,6044
  });

  it('is deterministic', () => {
    expect(calculateProjection(base)).toEqual(r);
  });

  it('keeps original = current when there are no manual cells', () => {
    expect(r.physical.every((c) => c.original === c.current)).toBe(true);
    expect(r.fee.every((c) => c.original === c.current)).toBe(true);
  });
});

describe('calculateProjection — fee lag', () => {
  it('shifts receipts by the configured months and extends the financial horizon', () => {
    const r = calculateProjection({ ...base, feeLagMonths: 2 });
    expect(r.physical).toHaveLength(22);
    expect(r.fee).toHaveLength(24);
    expect(r.fee.slice(0, 2).map((c) => c.current)).toEqual(['0.00', '0.00']);
    expect(r.fee[2]?.current).toBe('15907.60');
    expect(r.fee.at(-1)?.month).toBe('2028-12-01');
    expect(r.totals.fee).toBe('3976901.10');
  });
});

describe('calculateProjection — resampling', () => {
  it('stretches the 22-month curve to a 30-month work keeping 100%', () => {
    const r = calculateProjection({ ...base, durationMonths: 30 });
    expect(r.physical).toHaveLength(30);
    expect(r.totals.physical).toBe('1.00000000');
    expect(r.totals.fee).toBe(r.totals.expectedFee);
  });
});

describe('calculateProjection — manual adjustments', () => {
  const flat: ProjectionInput = {
    startDate: '2027-01-01',
    durationMonths: 4,
    curve: FLAT_4,
    budget: '1000000.00',
    feeRate: '0.10',
  };

  it('marks manual cells and redistributes the balance proportionally (PRESERVE_MANUAL)', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [{ series: 'PHYSICAL', periodIndex: 3, value: '0.40' }],
    });
    expect(r.physical.map((c) => c.current)).toEqual([
      '0.20000000',
      '0.20000000',
      '0.40000000',
      '0.20000000',
    ]);
    expect(r.physical[2]).toMatchObject({ origin: 'MANUAL', original: '0.25000000' });
    expect(r.totals.physical).toBe('1.00000000');
    // fee follows the adjusted physical series
    expect(r.fee.map((c) => c.current)).toEqual(['20000.00', '20000.00', '40000.00', '20000.00']);
    expect(r.parameters.manualCount).toBe(1);
  });

  it('discards manual cells on REPLACE_MANUAL', () => {
    const r = calculateProjection({
      ...flat,
      mode: 'REPLACE_MANUAL',
      manualCells: [{ series: 'PHYSICAL', periodIndex: 3, value: '0.40' }],
    });
    expect(r.physical.every((c) => c.origin === 'CURVE' && c.current === '0.25000000')).toBe(true);
  });

  it('keeps manual fee cells and spreads the remaining fee', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [{ series: 'FEE', periodIndex: 1, value: '10000' }],
    });
    expect(r.fee.map((c) => c.current)).toEqual(['10000.00', '30000.00', '30000.00', '30000.00']);
    expect(r.totals.fee).toBe('100000.00');
  });

  it('rejects manual values that exceed 100%', () => {
    expect(() =>
      calculateProjection({
        ...flat,
        manualCells: [
          { series: 'PHYSICAL', periodIndex: 1, value: '0.7' },
          { series: 'PHYSICAL', periodIndex: 2, value: '0.4' },
        ],
      }),
    ).toThrow(EngineValidationError);
  });

  it('rejects out-of-range, duplicated and negative manual cells', () => {
    const run = (manualCells: ProjectionInput['manualCells']) => () =>
      calculateProjection({ ...flat, manualCells });
    expect(run([{ series: 'PHYSICAL', periodIndex: 5, value: '0.1' }])).toThrow(
      /fora do cronograma/,
    );
    expect(run([{ series: 'PHYSICAL', periodIndex: 1, value: '-0.1' }])).toThrow(/negativo/);
    expect(
      run([
        { series: 'PHYSICAL', periodIndex: 1, value: '0.1' },
        { series: 'PHYSICAL', periodIndex: 1, value: '0.2' },
      ]),
    ).toThrow(/duplicado/);
  });

  it('warns when every cell is manual and the total is not 100%', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [1, 2, 3, 4].map((i) => ({
        series: 'PHYSICAL' as const,
        periodIndex: i,
        value: '0.2',
      })),
    });
    expect(r.validations.map((v) => v.code)).toContain('SERIES_TOTAL_MISMATCH');
    expect(r.totals.physical).toBe('0.80000000');
  });

  it('lists manual cells so the UI can warn before recalculating', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [{ series: 'PHYSICAL', periodIndex: 2, value: '0.1' }],
    });
    expect(listManualCells(r)).toEqual([
      { series: 'PHYSICAL', periodIndex: 2, value: '0.10000000' },
    ]);
  });
});

describe('calculateProjection — input validation', () => {
  it.each([
    [{ budget: '-1' }, /negativo/],
    [{ budget: '10.123' }, /2 casas/],
    [{ feeRate: '1.5' }, /entre 0% e 100%/],
    [{ feeLagMonths: -1 }, /defasagem/],
    [{ curve: toPoints(['0.5']) }, /100%/],
  ])('rejects %o', (patch, message) => {
    expect(() => calculateProjection({ ...base, ...patch })).toThrow(message);
  });

  it('accepts zero fee rate', () => {
    const r = calculateProjection({ ...base, feeRate: '0' });
    expect(r.totals.fee).toBe('0.00');
  });
});

describe('hydrateProjection', () => {
  it('rebuilds exactly the calculated result from stored values', () => {
    const calculated = calculateProjection({
      ...base,
      feeLagMonths: 1,
      manualCells: [{ series: 'PHYSICAL', periodIndex: 5, value: '0.05' }],
    });
    const strip = (cells: typeof calculated.physical) =>
      cells.map(({ periodIndex, original, current, origin }) => ({
        periodIndex,
        original,
        current,
        origin,
      }));
    const hydrated = hydrateProjection({
      startDate: base.startDate,
      durationMonths: base.durationMonths,
      budget: base.budget,
      feeRate: base.feeRate,
      feeLagMonths: 1,
      physical: strip(calculated.physical),
      fee: strip(calculated.fee),
    });
    expect(hydrated.physical).toEqual(calculated.physical);
    expect(hydrated.fee).toEqual(calculated.fee);
    expect(hydrated.totals).toEqual(calculated.totals);
    expect(hydrated.validations).toEqual([]);
    expect(hydrated.parameters.manualCount).toBe(1);
  });
});
