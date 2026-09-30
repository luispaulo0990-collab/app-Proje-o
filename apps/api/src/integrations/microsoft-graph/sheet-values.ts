import { Decimal } from '@unita/engine';
import { normalizeWorkName } from '../work-curve-provider.js';

/** Excel serial day 0 (1900 date system, with the Lotus leap-year bug) = 1899-12-30. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Header comparison: case/accent/space-insensitive ("Replanejado Atual  Acumulado" has 2 spaces). */
export const normalizeHeader = normalizeWorkName;

/**
 * Parses a month cell from a Graph `usedRange.values` matrix into `YYYY-MM-01`.
 *
 * - numbers are Excel serial dates (what Graph returns for date cells);
 * - ISO strings (`2026-01-01`, `2026-01-01T00:00:00`) are read directly;
 * - `a/b/yyyy` strings: closing dates are always day 1, so the part that is not `1` is the
 *   month (works for both `1/3/2026` BR and `3/1/2026` US); `1/1/yyyy` is January.
 */
export function parseMonthCell(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const d = new Date(EXCEL_EPOCH_UTC + Math.floor(value) * DAY_MS);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const month = a === 1 ? b : b === 1 ? a : null;
    if (!month || month > 12) return null;
    return `${slash[3]}-${pad(month)}-01`;
  }
  if (/^\d+(\.\d+)?$/.test(text)) return parseMonthCell(Number(text));
  return null;
}

/**
 * Parses a fraction cell. Graph returns numbers (0.29); strings like "29,07%" or "0,2907"
 * are accepted too. Numbers are converted with their shortest round-trip representation, so
 * no binary noise enters the Decimal engine. Empty → null.
 */
export function parseFractionCell(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/\s/g, '');
  if (text === '') return null;
  const percent = text.endsWith('%');
  text = text.replace('%', '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text)) return null;
  return percent ? new Decimal(text).div(100).toString() : text;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
