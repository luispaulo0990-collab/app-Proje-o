import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatMonth,
  formatPercent,
  fractionToPercentInput,
  parseDecimalInput,
  parseMoneyInput,
  percentInputToFraction,
  shiftDecimal,
} from './format';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('format (pt-BR)', () => {
  it('formats currency, percent, dates and months', () => {
    expect(nbsp(formatCurrency('1234567.89'))).toBe('R$ 1.234.567,89');
    expect(formatPercent('0.1235')).toBe('12,35%');
    expect(formatDate('2026-09-01')).toBe('01/09/2026');
    expect(formatMonth('2026-03-01')).toBe('MAR/26');
  });
});

describe('parsing without floating point', () => {
  it('shifts decimals exactly', () => {
    expect(shiftDecimal('0.1', -2)).toBe('0.001');
    expect(shiftDecimal('12.35', -2)).toBe('0.1235');
    expect(shiftDecimal('0.12350000', 2)).toBe('12.35');
    expect(shiftDecimal('0.07', 2)).toBe('7');
    expect(shiftDecimal('5', -3)).toBe('0.005');
  });

  it('parses Brazilian inputs', () => {
    expect(parseDecimalInput('R$ 1.234.567,89')).toBe('1234567.89');
    expect(parseDecimalInput('1234567.89')).toBe('1234567.89');
    expect(parseDecimalInput('abc')).toBeNull();
    expect(percentInputToFraction('12,35%')).toBe('0.1235');
    expect(percentInputToFraction('0,1')).toBe('0.001');
    expect(fractionToPercentInput('0.09000000')).toBe('9');
  });

  it('reads pt-BR thousands separators in money inputs', () => {
    expect(parseMoneyInput('150.000')).toBe('150000');
    expect(parseMoneyInput('1.234.567')).toBe('1234567');
    expect(parseMoneyInput('R$ 150.000,00')).toBe('150000');
    expect(parseMoneyInput('1234.56')).toBe('1234.56');
    expect(parseMoneyInput('150000')).toBe('150000');
    expect(parseMoneyInput('abc')).toBeNull();
  });
});
