import { describe, expect, it } from 'vitest';
import { inccRatesFromIndices } from '../src/index.js';

describe('INCC variation from the number-index', () => {
  it('divides each index by the previous month (8 decimals)', () => {
    expect(
      inccRatesFromIndices([
        { month: '2026-07-01', index: '1100' },
        { month: '2026-06-01', index: '1000' },
        { month: '2026-08-01', index: '1094.5' },
      ]),
    ).toEqual([
      { month: '2026-07-01', rate: '0.10000000' },
      { month: '2026-08-01', rate: '-0.00500000' },
    ]);
  });

  it('has no variation for the first month or after a gap', () => {
    expect(
      inccRatesFromIndices([
        { month: '2026-01-01', index: '1000' },
        { month: '2026-03-01', index: '1010' },
        { month: '2026-04-01', index: '1012.345678' },
      ]),
    ).toEqual([{ month: '2026-04-01', rate: '0.00232245' }]);
  });
});
