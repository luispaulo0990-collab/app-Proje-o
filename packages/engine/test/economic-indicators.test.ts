import { describe, expect, it } from 'vitest';
import { canonicalEconomicEntry, computeEconomicIndicators } from '../src/index.js';

describe('economic indicators (IEC Obra)', () => {
  const entries = [
    { month: '2026-06-01', iec: '1.02', projectedResult: '-2345642' },
    { month: '2026-07-01', iec: '0.987654321', projectedResult: '150000.555' },
    // Published before the closing: zeros = no data.
    { month: '2026-08-01', iec: '0', projectedResult: '0' },
    { month: '2026-10-01', iec: '1.1', projectedResult: '10' },
  ];

  it('uses the latest closing at or before the reference month', () => {
    expect(computeEconomicIndicators(entries, '2026-07-01')).toEqual({
      month: '2026-07-01',
      iec: '0.987654',
      projectedResult: '150000.56',
    });
  });

  it('skips months whose IEC and result are zero (not closed yet)', () => {
    const i = computeEconomicIndicators(entries, '2026-09-01');
    expect(i.month).toBe('2026-07-01');
  });

  it('ignores closings after the reference month', () => {
    expect(computeEconomicIndicators(entries, '2026-05-01')).toEqual({
      month: null,
      iec: null,
      projectedResult: null,
    });
  });

  it('keeps a month with result but IEC 0 (IEC treated as missing)', () => {
    const i = computeEconomicIndicators(
      [{ month: '2026-03-01', iec: '0', projectedResult: '-10.5' }],
      '2026-03-01',
    );
    expect(i).toEqual({ month: '2026-03-01', iec: null, projectedResult: '-10.50' });
  });

  it('canonicalizes values without binary noise', () => {
    expect(
      canonicalEconomicEntry({ month: '2026-01-01', iec: '1.0000005', projectedResult: null }),
    ).toEqual({ month: '2026-01-01', iec: '1.000000', projectedResult: null });
  });
});
