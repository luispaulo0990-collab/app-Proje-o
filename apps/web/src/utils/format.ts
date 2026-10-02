/**
 * Brazilian formatting/parsing helpers. Presentation only: values arrive from the API as
 * decimal strings and conversions here never feed a calculation (the engine is the source
 * of truth). Parsing uses string arithmetic to avoid floating point artefacts.
 */
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export function formatCurrency(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return currency.format(Number(value));
}

export function formatNumber(value: string | number, digits = 0): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

/** Fraction → "12,35%". */
export function formatPercent(fraction: string | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || fraction === '') return '—';
  const pct = shiftDecimal(fraction, 2);
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(pct))}%`;
}

/** `2027-01-01` → `01/01/2027` (no Date object → no time zone shifts). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** `2027-01-01` → `JAN/27`. */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]}/${(y ?? '').slice(2)}`;
}

/** Moves the decimal point of a decimal string (`places` > 0 multiplies by 10^places). */
export function shiftDecimal(value: string, places: number): string {
  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [intPart = '0', fracPart = ''] = raw.split('.');
  let digits = intPart + fracPart;
  let point = intPart.length + places;
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits = digits + '0'.repeat(point - digits.length);
  const int = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0';
  const frac = digits.slice(point).replace(/0+$/, '');
  const result = frac ? `${int}.${frac}` : int;
  return negative && result !== '0' ? `-${result}` : result;
}

/** "R$ 1.234.567,89" | "1234567,89" | "1234567.89" → "1234567.89"; invalid → null. */
export function parseDecimalInput(input: string): string | null {
  let s = input.replace(/R\$|\s|%/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return shiftDecimal(s, 0);
}

/**
 * Money typed in pt-BR: like parseDecimalInput, but dots followed by groups of 3 digits are
 * thousands separators ("150.000" = cento e cinquenta mil, never R$ 150,00).
 */
export function parseMoneyInput(input: string): string | null {
  const s = input.replace(/R\$|\s/g, '');
  return parseDecimalInput(/^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s);
}

/** "12,35" (percent typed by the user) → "0.1235" (fraction for the API). */
export function percentInputToFraction(input: string): string | null {
  const parsed = parseDecimalInput(input);
  return parsed === null ? null : shiftDecimal(parsed, -2);
}

/** "0.12350000" → "12,35" (for form inputs). */
export function fractionToPercentInput(fraction: string): string {
  return shiftDecimal(fraction, 2).replace('.', ',');
}

/** "1234567.89" → "1.234.567,89" (for form inputs). */
export function decimalToInput(value: string, digits = 2): string {
  return formatNumber(value, digits);
}
