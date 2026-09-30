import { describe, expect, it } from 'vitest';
import { EngineValidationError, buildSchedule } from '../src/index.js';

describe('buildSchedule', () => {
  it('computes end date and periods for the spec example (01/01/2027 + 24 months)', () => {
    const s = buildSchedule('2027-01-01', 24);
    expect(s.endDate).toBe('2028-12-31');
    expect(s.periods).toHaveLength(24);
    expect(s.periods[0]).toEqual({ index: 1, month: '2027-01-01', label: 'JAN/27' });
    expect(s.periods[23]).toEqual({ index: 24, month: '2028-12-01', label: 'DEZ/28' });
  });

  it('treats a mid-month start as the first competence month', () => {
    const s = buildSchedule('2027-03-15', 1);
    expect(s.periods[0]?.month).toBe('2027-03-01');
    expect(s.endDate).toBe('2027-03-31');
  });

  it('handles leap years and year boundaries', () => {
    expect(buildSchedule('2027-12-01', 3).endDate).toBe('2028-02-29');
    expect(buildSchedule('2026-11-10', 4).periods.map((p) => p.label)).toEqual([
      'NOV/26',
      'DEZ/26',
      'JAN/27',
      'FEV/27',
    ]);
  });

  it.each([0, -1, 1.5, 601])('rejects invalid duration %s', (d) => {
    expect(() => buildSchedule('2027-01-01', d)).toThrow(EngineValidationError);
  });

  it.each(['2027-02-30', '27-01-01', '2027-13-01', ''])('rejects invalid date "%s"', (date) => {
    expect(() => buildSchedule(date, 12)).toThrow(EngineValidationError);
  });
});
