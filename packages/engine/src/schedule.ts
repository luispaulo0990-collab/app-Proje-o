import { EngineValidationError, issue } from './errors.js';
import type { IsoDate, IsoMonth, Period, Schedule } from './types.js';

const MONTH_LABELS = [
  'JAN',
  'FEV',
  'MAR',
  'ABR',
  'MAI',
  'JUN',
  'JUL',
  'AGO',
  'SET',
  'OUT',
  'NOV',
  'DEZ',
] as const;

export const MAX_DURATION_MONTHS = 600;

/** Calendar month expressed without time zones: month is 1..12. */
export interface YearMonth {
  year: number;
  month: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0');
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month = last day of `month`. UTC avoids DST/local offsets.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Strictly parses `YYYY-MM-DD`, rejecting impossible dates such as 2027-02-30. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new EngineValidationError([
      issue('INVALID_DATE', `Data inválida: "${value}". Use o formato AAAA-MM-DD.`),
    ]);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1900 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new EngineValidationError([issue('INVALID_DATE', `Data inexistente: "${value}".`)]);
  }
  return { year, month, day };
}

export function addMonths(ym: YearMonth, months: number): YearMonth {
  const zeroBased = ym.year * 12 + (ym.month - 1) + months;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function toIsoMonth(ym: YearMonth): IsoMonth {
  return `${pad(ym.year, 4)}-${pad(ym.month)}-01`;
}

export function parseIsoMonth(value: string): YearMonth {
  const { year, month } = parseIsoDate(value.length === 7 ? `${value}-01` : value);
  return { year, month };
}

export function monthLabel(ym: YearMonth): string {
  return `${MONTH_LABELS[ym.month - 1]}/${pad(ym.year % 100)}`;
}

/** Number of months from `a` to `b` (b − a). */
export function monthDiff(a: YearMonth, b: YearMonth): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export function buildPeriods(first: YearMonth, count: number): Period[] {
  return Array.from({ length: count }, (_, i) => {
    const ym = addMonths(first, i);
    return { index: i + 1, month: toIsoMonth(ym), label: monthLabel(ym) };
  });
}

export function validateDuration(durationMonths: number): void {
  if (
    !Number.isInteger(durationMonths) ||
    durationMonths < 1 ||
    durationMonths > MAX_DURATION_MONTHS
  ) {
    throw new EngineValidationError([
      issue(
        'INVALID_DURATION',
        `A duração deve ser um inteiro entre 1 e ${MAX_DURATION_MONTHS} meses.`,
        { durationMonths },
      ),
    ]);
  }
}

/**
 * Builds the monthly competence schedule.
 *
 * Rule: period 1 is the month of the start date; the project occupies `durationMonths`
 * consecutive competence months; the end date is the last calendar day of the last month.
 * Example: 2027-01-01 + 24 months → 2028-12-31.
 */
export function buildSchedule(startDate: IsoDate, durationMonths: number): Schedule {
  validateDuration(durationMonths);
  const { year, month } = parseIsoDate(startDate);
  const first: YearMonth = { year, month };
  const last = addMonths(first, durationMonths - 1);
  const endDate = `${pad(last.year, 4)}-${pad(last.month)}-${pad(daysInMonth(last.year, last.month))}`;
  return {
    startDate,
    endDate,
    durationMonths,
    periods: buildPeriods(first, durationMonths),
  };
}
