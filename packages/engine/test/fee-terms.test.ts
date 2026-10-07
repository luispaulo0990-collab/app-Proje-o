import { describe, expect, it } from 'vitest';
import {
  EngineValidationError,
  calculateProjection,
  hydrateProjection,
  type InccIndex,
  type ProjectionInput,
  type ProjectionResult,
} from '../src/index.js';
import { FLAT_4 } from './fixtures.js';

/*
 * Same base case as fee-schedule.test.ts: 4 months × 25%, budget 1.000.000,00 × 10%.
 * Competência M−1: the fee runs JAN..MAI/27 (weights 0 · 25% · 25% · 25% · 25%).
 */
const flat: ProjectionInput = {
  startDate: '2027-01-01',
  durationMonths: 4,
  curve: FLAT_4,
  budget: '1000000.00',
  feeRate: '0.10',
};

const fees = (r: ProjectionResult) => r.fee.map((c) => c.current);
const codes = (r: ProjectionResult) => r.validations.map((v) => v.code);
const quarterly = (month: string, feeRate = '0.10') => ({
  month,
  feeRate,
  inccPeriodicity: 'QUARTERLY' as const,
});

/** Number-indices DEZ/26 = 100 → MAR/27 = 103,02 (JAN +1%, FEV ≈ +0,99%, MAR +1%). */
const INDICES: InccIndex[] = [
  { month: '2026-12-01', index: '100' },
  { month: '2027-01-01', index: '101' },
  { month: '2027-02-01', index: '102' },
  { month: '2027-03-01', index: '103.02' },
];
const issued = (...months: string[]) => months.map((month) => ({ month, amount: '25000.00' }));

describe('fee terms — new fee rate from a month on', () => {
  it('applies the new rate (not a variation) only to the fee received from that month', () => {
    const r = calculateProjection({
      ...flat,
      feeTerms: [{ month: '2027-04-01', feeRate: '0.08', inccPeriodicity: 'MONTHLY' }],
    });
    // JAN..MAR at 10%, ABR/MAI at 8%: 1.000.000 × (0,025 + 0,025 + 0,02 + 0,02) = 90.000
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '20000.00', '20000.00']);
    expect(r.totals).toMatchObject({ fee: '90000.00', expectedFee: '90000.00' });
    expect(r.parameters.feeTerms).toEqual([
      { month: '2027-04-01', feeRate: '0.08000000', inccPeriodicity: 'MONTHLY' },
    ]);
  });

  it('is identical to changing the work rate when the term covers the whole horizon', () => {
    const viaTerm = calculateProjection({
      ...flat,
      feeTerms: [{ month: '2026-06-01', feeRate: '0.08', inccPeriodicity: 'MONTHLY' }],
    });
    const viaWork = calculateProjection({ ...flat, feeRate: '0.08' });
    expect(fees(viaTerm)).toEqual(fees(viaWork));
  });

  it('keeps the issued months and projects the balance at the new rate', () => {
    const r = calculateProjection({
      ...flat,
      feeIssuances: issued('2027-02-01'),
      feeTerms: [{ month: '2027-04-01', feeRate: '0.12', inccPeriodicity: 'MONTHLY' }],
    });
    // contract fee 1.000.000 × (0,025 + 0,025 + 0,03 + 0,03) = 110.000; − 25.000 issued
    // = 85.000 over MAR (10%) / ABR, MAI (12%) → 25.000 · 30.000 · 30.000
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '30000.00', '30000.00']);
    expect(r.totals.expectedFee).toBe('110000.00');
  });

  it('applies the terms in chronological order whatever the input order', () => {
    const r = calculateProjection({
      ...flat,
      feeTerms: [
        { month: '2027-05-01', feeRate: '0.12', inccPeriodicity: 'MONTHLY' },
        { month: '2027-03-01', feeRate: '0.08', inccPeriodicity: 'MONTHLY' },
      ],
    });
    expect(fees(r)).toEqual(['0.00', '25000.00', '20000.00', '20000.00', '30000.00']);
    expect(r.parameters.feeTerms.map((t) => t.month)).toEqual(['2027-03-01', '2027-05-01']);
  });

  it('rejects an invalid or duplicated term and warns about a term after the horizon', () => {
    const fail = (input: ProjectionInput) => {
      try {
        calculateProjection(input);
      } catch (err) {
        return (err as EngineValidationError).issues.map((i) => i.code);
      }
      return [];
    };
    expect(fail({ ...flat, feeTerms: [quarterly('2027-03-01', '1.5')] })).toContain(
      'INVALID_FEE_TERM',
    );
    expect(
      fail({ ...flat, feeTerms: [quarterly('2027-03-01'), quarterly('2027-03-01')] }),
    ).toContain('FEE_TERM_DUPLICATED');
    const late = calculateProjection({ ...flat, feeTerms: [quarterly('2028-01-01')] });
    expect(codes(late)).toContain('FEE_TERM_OUT_OF_RANGE');
    expect(late.totals.fee).toBe('100000.00');
  });
});

describe('INCC correction periodicity', () => {
  it('monthly from the number-indices gives the same result as the monthly rates', () => {
    const fromIndices = calculateProjection({
      ...flat,
      inccIndices: INDICES,
      feeIssuances: issued('2027-02-01', '2027-03-01', '2027-04-01'),
    });
    const fromRates = calculateProjection({
      ...flat,
      inccRates: [
        { month: '2027-01-01', rate: '0.01' },
        { month: '2027-02-01', rate: '0.00990099' },
        { month: '2027-03-01', rate: '0.01' },
      ],
      feeIssuances: issued('2027-02-01', '2027-03-01', '2027-04-01'),
    });
    expect(fees(fromIndices)).toEqual(fees(fromRates));
  });

  it('quarterly: corrects once per quarter by the INCC accumulated in it', () => {
    const r = calculateProjection({
      ...flat,
      inccPeriodicity: 'QUARTERLY',
      inccIndices: INDICES,
      feeIssuances: issued('2027-02-01', '2027-03-01', '2027-04-01'),
    });
    // Data-base JAN (start): FEV and MAR are not corrected; ABR is corrected by JAN..MAR
    // (103,02 ÷ 100 − 1 = 3,02%): 50.000 × 1,0302 = 51.510 − 25.000 = 26.510 → MAI.
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '25000.00', '26510.00']);
    expect(r.parameters.feeAdjustment).toMatchObject({
      inccCorrection: '1510.00',
      expectedFee: '101510.00',
    });
    expect(r.parameters).toMatchObject({
      inccPeriodicity: 'QUARTERLY',
      inccBaseMonth: '2027-01-01',
    });
  });

  it('counts the cycle from the data-base and waits for the INCC of the whole window', () => {
    const input: ProjectionInput = {
      ...flat,
      inccPeriodicity: 'QUARTERLY',
      inccBaseMonth: '2027-02-01',
      inccIndices: INDICES,
      feeIssuances: issued('2027-02-01', '2027-03-01', '2027-04-01'),
    };
    // Data-base FEV → correction due in MAI (window FEV..ABR); ABR not published → none.
    expect(calculateProjection(input).totals.expectedFee).toBe('100000.00');

    const published = calculateProjection({
      ...input,
      inccIndices: [...INDICES, { month: '2027-04-01', index: '104.04' }],
    });
    // 25.000 × (104,04 ÷ 101 − 1 = 3,0099…%) = 25.752,48 received in MAI
    expect(fees(published)[4]).toBe('25752.48');
  });

  it('never counts a month twice when the periodicity changes (monthly → quarterly)', () => {
    const r = calculateProjection({
      ...flat,
      inccIndices: INDICES,
      feeIssuances: issued('2027-02-01', '2027-03-01', '2027-04-01'),
      feeTerms: [quarterly('2027-03-01')],
    });
    // FEV (monthly): JAN 1% → 101.000 − 25.000 = 76.000; MAR: not due → 51.000;
    // ABR (quarterly): only FEV..MAR, already-used JAN excluded (103,02 ÷ 101 − 1 = 2%)
    // → 52.020 − 25.000 = 27.020 → MAI.
    expect(fees(r)).toEqual(['0.00', '25000.00', '25000.00', '25000.00', '27020.00']);
    expect(r.parameters.feeAdjustment?.inccCorrection).toBe('2020.00');
  });

  it('rejects an unknown periodicity', () => {
    expect(() => calculateProjection({ ...flat, inccPeriodicity: 'WEEKLY' as never })).toThrow(
      EngineValidationError,
    );
  });
});

describe('hydrateProjection with fee terms', () => {
  it('uses the stored expected fee instead of budget × base rate', () => {
    const r = calculateProjection({
      ...flat,
      feeTerms: [{ month: '2027-04-01', feeRate: '0.08', inccPeriodicity: 'MONTHLY' }],
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
      expectedFee: r.totals.expectedFee,
      feeTerms: r.parameters.feeTerms,
      physical: toStored(r.physical),
      fee: toStored(r.fee),
    });
    expect(h.totals).toEqual(r.totals);
    expect(h.parameters.feeTerms).toEqual(r.parameters.feeTerms);
    expect(h.validations).toEqual([]);
  });
});
