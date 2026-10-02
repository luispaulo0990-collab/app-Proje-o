import { describe, expect, it } from 'vitest';
import {
  Decimal,
  EngineValidationError,
  calculateProjection,
  hydrateProjection,
  type ProjectionInput,
  type ProjectionResult,
} from '../src/index.js';
import { FLAT_4, UNITA_22, toPoints } from './fixtures.js';

/*
 * Base case: 4 months × 25%, budget 1.000.000,00 × 10% = taxa 100.000,00.
 * Competência M−1: JAN/27 avanço → FEV/27 recebimento, so the fee runs JAN..MAI (5 months).
 */
const flat: ProjectionInput = {
  startDate: '2027-01-01',
  durationMonths: 4,
  curve: FLAT_4,
  budget: '1000000.00',
  feeRate: '0.10',
};

const fees = (r: ProjectionResult) => r.fee.map((c) => c.current);
const origins = (r: ProjectionResult) => r.fee.map((c) => c.origin);
const codes = (r: ProjectionResult) => r.validations.map((v) => v.code);
const total = (r: ProjectionResult) =>
  r.fee.reduce((acc, c) => acc.plus(c.current), new Decimal(0)).toFixed(2);

describe('competência M−1', () => {
  it('receives each month of progress in the following month', () => {
    const r = calculateProjection(flat);
    expect(r.fee.map((c) => c.month)).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
      '2027-04-01',
      '2027-05-01',
    ]);
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '25000.00', '25000.00']);
    expect(r.parameters).toMatchObject({ feeLagMonths: 1, feeAdjustment: null });
  });
});

describe('fee issuances ("taxa emitida")', () => {
  it('uses the issued value and projects the balance over the next months by the curve', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: [{ month: '2027-02-01', amount: '20000.00' }],
    });
    // 100.000 − 20.000 = 80.000 over MAR..MAI (3 × 26.666,666…) by largest remainder.
    expect(fees(r)).toEqual(['0.00', '20000.00', '26666.67', '26666.67', '26666.66']);
    expect(origins(r)).toEqual(['CURVE', 'ISSUED', 'CURVE', 'CURVE', 'CURVE']);
    expect(r.fee[1]?.original).toBe('25000.00'); // curve value kept for traceability
    expect(r.totals).toMatchObject({ fee: '100000.00', expectedFee: '100000.00' });
    expect(r.parameters.feeAdjustment).toEqual({
      firstIssuedMonth: '2027-02-01',
      lastIssuedMonth: '2027-02-01',
      issuedTotal: '20000.00',
      inccCorrection: '0.00',
      balanceAfterIssued: '80000.00',
      expectedFee: '100000.00',
    });
  });

  it('keeps the regular distribution before the first issuance', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: [{ month: '2027-04-01', amount: '20000.00' }],
    });
    // JAN..MAR as projected (0 + 25.000 + 25.000); balance 50.000 − 20.000 → MAI.
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '20000.00', '30000.00']);
    expect(origins(r)).toEqual(['CURVE', 'CURVE', 'CURVE', 'ISSUED', 'CURVE']);
  });

  it('treats a month without issuance between issuances as not invoiced (0)', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: [
        { month: '2027-02-01', amount: '25000.00' },
        { month: '2027-04-01', amount: '30000.00' },
      ],
    });
    expect(fees(r)).toEqual(['0.00', '25000.00', '0.00', '30000.00', '45000.00']);
    expect(origins(r).slice(1, 4)).toEqual(['ISSUED', 'ISSUED', 'ISSUED']);
  });

  it('keeps manual fee cells after the last issuance and overrides those inside the window', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [
        { series: 'FEE', periodIndex: 2, value: '1000' },
        { series: 'FEE', periodIndex: 5, value: '10000' },
      ],
      feeIssuances: [{ month: '2027-02-01', amount: '25000.00' }],
    });
    // balance 75.000: MAI is manual (10.000) → 65.000 over MAR/ABR.
    expect(fees(r)).toEqual(['0.00', '25000.00', '32500.00', '32500.00', '10000.00']);
    expect(origins(r)).toEqual(['CURVE', 'ISSUED', 'CURVE', 'CURVE', 'MANUAL']);
    expect(codes(r)).toContain('FEE_MANUAL_SUPERSEDED');
    expect(r.parameters.manualCount).toBe(1);
  });
});

describe('INCC correction', () => {
  it('corrects the balance in M by the INCC of M−1 before the issuance', () => {
    const r = calculateProjection({
      ...flat,
      inccRates: [{ month: '2027-01-01', rate: '0.01' }],
      feeIssuances: [{ month: '2027-02-01', amount: '25000.00' }],
    });
    // 100.000 × 1,01 = 101.000 − 25.000 = 76.000 → 25.333,34 · 25.333,33 · 25.333,33
    expect(fees(r)).toEqual(['0.00', '25000.00', '25333.34', '25333.33', '25333.33']);
    expect(r.totals).toMatchObject({ fee: '101000.00', expectedFee: '101000.00' });
    expect(r.parameters.feeAdjustment).toMatchObject({
      inccCorrection: '1000.00',
      balanceAfterIssued: '76000.00',
    });
  });

  it('compounds month by month on the balance still to be received', () => {
    const r = calculateProjection({
      ...flat,
      inccRates: [
        { month: '2027-01-01', rate: '0.01' },
        { month: '2027-02-01', rate: '0.005' },
      ],
      feeIssuances: [
        { month: '2027-02-01', amount: '25000.00' },
        { month: '2027-03-01', amount: '25000.00' },
      ],
    });
    // FEV: 100.000 × 1,01 = 101.000 − 25.000 = 76.000
    // MAR: 76.000 × 1,005 = 76.380 − 25.000 = 51.380 → ABR/MAI 25.690 each
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '25690.00', '25690.00']);
    expect(r.parameters.feeAdjustment?.inccCorrection).toBe('1380.00');
    expect(total(r)).toBe('101380.00');
  });

  it('applies INCC already published for the months right after the last issuance', () => {
    const r = calculateProjection({
      ...flat,
      inccRates: [{ month: '2027-02-01', rate: '0.02' }],
      feeIssuances: [{ month: '2027-02-01', amount: '25000.00' }],
    });
    // 75.000 × 1,02 = 76.500 → 25.500 × 3
    expect(fees(r).slice(2)).toEqual(['25500.00', '25500.00', '25500.00']);
  });

  it('ignores INCC when the work has no issuance yet', () => {
    const r = calculateProjection({ ...flat, inccRates: [{ month: '2027-01-01', rate: '0.01' }] });
    expect(r.totals.fee).toBe('100000.00');
    expect(r.parameters.feeAdjustment).toBeNull();
  });

  it('accepts a negative INCC (deflation)', () => {
    const r = calculateProjection({
      ...flat,
      inccRates: [{ month: '2027-01-01', rate: '-0.001' }],
      feeIssuances: [{ month: '2027-02-01', amount: '25000.00' }],
    });
    expect(r.parameters.feeAdjustment?.inccCorrection).toBe('-100.00');
    expect(r.totals.fee).toBe('99900.00');
  });

  it('adds up to the corrected fee to the cent on the real 22-month curve', () => {
    const r = calculateProjection({
      startDate: '2025-04-01',
      durationMonths: 22,
      curve: toPoints(UNITA_22),
      budget: '44187790.05',
      feeRate: '0.09',
      inccRates: [
        { month: '2026-07-01', rate: '0.0071' },
        { month: '2026-08-01', rate: '0.0052' },
        { month: '2026-09-01', rate: '0.0047' },
      ],
      feeIssuances: [
        { month: '2026-08-01', amount: '298267.58' },
        { month: '2026-09-01', amount: '280000.00' },
        { month: '2026-10-01', amount: '301234.56' },
      ],
    });
    expect(total(r)).toBe(r.totals.expectedFee);
    expect(r.validations).toEqual([]);
  });
});

describe('edge cases and validation', () => {
  it('warns and projects nothing when the issuances exceed the corrected fee', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: [{ month: '2027-02-01', amount: '120000.00' }],
    });
    expect(fees(r).slice(2)).toEqual(['0.00', '0.00', '0.00']);
    expect(codes(r)).toContain('FEE_ISSUED_ABOVE_BALANCE');
    // "Taxa prevista" is what the series really adds up to: received + receivable match it.
    expect(r.totals).toMatchObject({ fee: '120000.00', expectedFee: '120000.00' });
    expect(r.parameters.feeAdjustment?.balanceAfterIssued).toBe('-20000.00');
  });

  it('records an issuance even when a manual cell in the same month exceeded the fee', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [{ series: 'FEE', periodIndex: 2, value: '150000' }],
      feeIssuances: [{ month: '2027-02-01', amount: '25000.00' }],
    });
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '25000.00', '25000.00']);
    expect(codes(r)).toContain('FEE_MANUAL_SUPERSEDED');
  });

  it('does not let manual cells after the last issuance change the months before it', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [
        { series: 'FEE', periodIndex: 4, value: '10' },
        { series: 'FEE', periodIndex: 5, value: '10' },
      ],
      feeIssuances: [{ month: '2027-03-01', amount: '25000.00' }],
    });
    // JAN/FEV exactly as the curve gives them (no longer distorted by the ABR/MAI manual cells).
    expect(fees(r).slice(0, 3)).toEqual(['0.00', '25000.00', '25000.00']);
    expect(origins(r).slice(3)).toEqual(['MANUAL', 'MANUAL']);
  });

  it('drops future manual cells that no longer fit in the balance instead of failing', () => {
    const r = calculateProjection({
      ...flat,
      manualCells: [{ series: 'FEE', periodIndex: 5, value: '60000' }],
      feeIssuances: [{ month: '2027-02-01', amount: '50000.00' }],
    });
    // balance 50.000 < manual 60.000 → curve again over MAR..MAI
    expect(fees(r)).toEqual(['0.00', '50000.00', '16666.67', '16666.67', '16666.66']);
    expect(codes(r)).toContain('FEE_MANUAL_DROPPED');
    expect(r.parameters.manualCount).toBe(0);
  });

  it('warns when a balance is left after the last month of the horizon', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: [{ month: '2027-05-01', amount: '10000.00' }],
    });
    expect(codes(r)).toContain('FEE_BALANCE_UNALLOCATED');
  });

  it('ignores, with a warning, an issuance outside the fee horizon (e.g. after a schedule change)', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: [{ month: '2026-12-01', amount: '1.00' }],
    });
    expect(codes(r)).toContain('FEE_ISSUANCE_OUT_OF_RANGE');
    expect(r.totals.fee).toBe('100000.00');
    expect(r.parameters.feeAdjustment).toBeNull();
  });

  it.each([
    [[{ month: '2027-02-01', amount: '-1' }], /≥ 0/],
    [[{ month: '2027-02-01', amount: '1.001' }], /2 casas/],
    [
      [
        { month: '2027-02-01', amount: '1' },
        { month: '2027-02-01', amount: '2' },
      ],
      /duplicada/,
    ],
  ])('rejects issuances %o', (feeIssuances, message) => {
    expect(() => calculateProjection({ ...flat, feeIssuances })).toThrow(message);
  });

  it('rejects an INCC of −100% or less', () => {
    expect(() =>
      calculateProjection({
        ...flat,
        inccRates: [{ month: '2027-01-01', rate: '-1' }],
        feeIssuances: [{ month: '2027-02-01', amount: '1.00' }],
      }),
    ).toThrow(EngineValidationError);
  });
});

describe('hydrateProjection with issuances', () => {
  it('rebuilds the stored version with its origins and the corrected total', () => {
    const r = calculateProjection({
      ...flat,
      inccRates: [{ month: '2027-01-01', rate: '0.01' }],
      feeIssuances: [{ month: '2027-02-01', amount: '25000.00' }],
    });
    const toStored = (cells: ProjectionResult['fee']) =>
      cells.map(({ periodIndex, original, current, origin }) => ({
        periodIndex,
        original,
        current,
        origin,
      }));
    const h = hydrateProjection({
      startDate: flat.startDate,
      durationMonths: 4,
      budget: flat.budget,
      feeRate: flat.feeRate,
      feeLagMonths: r.parameters.feeLagMonths,
      feeAdjustment: r.parameters.feeAdjustment,
      physical: toStored(r.physical),
      fee: toStored(r.fee),
    });
    expect(h.fee).toEqual(r.fee);
    expect(h.totals).toEqual(r.totals);
    expect(h.parameters.feeAdjustment).toEqual(r.parameters.feeAdjustment);
    expect(h.validations).toEqual([]);
  });
});
