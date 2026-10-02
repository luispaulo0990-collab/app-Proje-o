import { Decimal, MONEY_SCALE, ONE, PCT_SCALE, ZERO, roundTo, sum, toDecimal } from './decimal.js';
import { distribute, type Distribution } from './distribution.js';
import { issue } from './errors.js';
import { addMonths, parseIsoMonth, toIsoMonth } from './schedule.js';
import type {
  FeeAdjustment,
  FeeIssuance,
  InccRate,
  IsoMonth,
  Period,
  ValidationIssue,
} from './types.js';

/**
 * Competência M-1: the fee invoiced in a month refers to the physical progress measured in the
 * previous month (progress of September is received in October). Fixed for every work.
 */
export const FEE_COMPETENCE_LAG_MONTHS = 1;

/** Fee series after issuances and INCC, plus which positions were invoiced. */
export interface FeeSchedule extends Distribution {
  issued: Set<number>;
  expected: Decimal;
  adjustment: FeeAdjustment | null;
}

export interface FeeScheduleInput {
  /** Financial horizon (physical schedule + competence lag). */
  periods: readonly Period[];
  /** Lagged physical weights of each financial period. */
  weights: readonly Decimal[];
  /** Manual fee cells typed by the user, by position. */
  manual: ReadonlyMap<number, Decimal>;
  /** Contract fee: round2(budget × fee rate). */
  feeTotal: Decimal;
  issuances: readonly FeeIssuance[];
  inccRates: readonly InccRate[];
}

const previousMonth = (month: IsoMonth) => toIsoMonth(addMonths(parseIsoMonth(month), -1));

function canonicalMonth(value: string): IsoMonth | null {
  try {
    return toIsoMonth(parseIsoMonth(value));
  } catch {
    return null;
  }
}

function parseIssuances(
  issuances: readonly FeeIssuance[],
  periods: readonly Period[],
  issues: ValidationIssue[],
): Map<number, Decimal> {
  const position = new Map(periods.map((p, i) => [p.month, i]));
  const byIndex = new Map<number, Decimal>();
  for (const item of issuances) {
    const month = canonicalMonth(item.month);
    const ctx = { month: item.month };
    if (!month) {
      issues.push(issue('INVALID_FEE_ISSUANCE', `Mês de emissão inválido: "${item.month}".`, ctx));
      continue;
    }
    let amount: Decimal;
    try {
      amount = toDecimal(item.amount, 'taxa emitida');
    } catch {
      issues.push(issue('INVALID_FEE_ISSUANCE', `Valor emitido inválido em ${month}.`, ctx));
      continue;
    }
    if (amount.isNegative() || amount.decimalPlaces() > MONEY_SCALE) {
      issues.push(
        issue('INVALID_FEE_ISSUANCE', 'A taxa emitida deve ser ≥ 0 com até 2 casas.', ctx),
      );
      continue;
    }
    const index = position.get(month);
    if (index === undefined) {
      // Kept as a warning: a later change of schedule must not block the work (the API
      // rejects new issuances outside the horizon before storing them).
      issues.push(
        issue(
          'FEE_ISSUANCE_OUT_OF_RANGE',
          `A emissão de ${month.slice(0, 7)} está fora do período de recebimento da obra e foi ignorada.`,
          ctx,
          'WARNING',
        ),
      );
      continue;
    }
    if (byIndex.has(index)) {
      issues.push(
        issue('FEE_ISSUANCE_DUPLICATED', `Emissão duplicada em ${month.slice(0, 7)}.`, ctx),
      );
      continue;
    }
    byIndex.set(index, amount);
  }
  return byIndex;
}

function parseInccRates(
  rates: readonly InccRate[],
  issues: ValidationIssue[],
): Map<IsoMonth, Decimal> {
  const byMonth = new Map<IsoMonth, Decimal>();
  for (const item of rates) {
    const month = canonicalMonth(item.month);
    let rate: Decimal | null = null;
    try {
      rate = roundTo(toDecimal(item.rate, 'INCC'), PCT_SCALE);
    } catch {
      rate = null;
    }
    if (!month || !rate || rate.lessThanOrEqualTo(-1)) {
      issues.push(
        issue('INVALID_INCC_RATE', `INCC inválido em "${item.month}".`, { month: item.month }),
      );
      continue;
    }
    byMonth.set(month, rate);
  }
  return byMonth;
}

/** Balance corrected by one month of INCC (2 decimals, HALF_EVEN). Only positive balances. */
function correct(balance: Decimal, rate: Decimal | undefined): Decimal {
  if (!rate || !balance.greaterThan(0)) return balance;
  return roundTo(balance.times(ONE.plus(rate)), MONEY_SCALE);
}

const only = (manual: ReadonlyMap<number, Decimal>, keep: (index: number) => boolean) =>
  new Map([...manual].filter(([i]) => keep(i)));

/**
 * Fee series driven by the monthly invoices ("taxa emitida") and the INCC.
 *
 * Without issuances: the contract fee spread by the curve (manual cells kept). Otherwise, with
 * A = first and L = last month with an issuance:
 * 1. months before A keep the regular distribution; balance = fee total − Σ(those months);
 * 2. each month M in A..L: balance × (1 + INCC(M−1)), then fee(M) = amount issued in M
 *    (a month without issuance inside the window was not invoiced: 0) and balance −= fee(M);
 * 3. INCC already published for the months right after L corrects the balance as well;
 * 4. the balance is projected over the months after L by the physical curve (competência
 *    M−1), keeping manual fee cells.
 * An issuance always prevails: manual cells it replaces, or that no longer fit in the
 * balance, are dropped with a warning — a real invoice can always be recorded.
 */
export function buildFeeSchedule(input: FeeScheduleInput, issues: ValidationIssue[]): FeeSchedule {
  const { periods, weights, manual, feeTotal } = input;
  const issued = parseIssuances(input.issuances, periods, issues);
  const incc = parseInccRates(input.inccRates, issues);
  if (issued.size === 0) {
    const regular = distribute(weights, manual, feeTotal, MONEY_SCALE, 'FEE', issues);
    return { ...regular, issued: new Set(), expected: feeTotal, adjustment: null };
  }

  const positions = [...issued.keys()];
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const rateFor = (index: number) => {
    const period = periods[index];
    return period ? incc.get(previousMonth(period.month)) : undefined;
  };

  const before = distribute(
    weights,
    only(manual, (i) => i < first),
    feeTotal,
    MONEY_SCALE,
    'FEE',
    issues,
  );
  const values = before.values.slice(0, first);
  let balance = feeTotal.minus(sum(values));
  let correction = ZERO;
  const applyIncc = (index: number) => {
    const corrected = correct(balance, rateFor(index));
    correction = correction.plus(corrected.minus(balance));
    balance = corrected;
  };

  for (let i = first; i <= last; i++) {
    applyIncc(i);
    const amount = issued.get(i) ?? ZERO;
    values.push(amount);
    balance = balance.minus(amount);
  }
  for (let i = last + 1; i < periods.length && rateFor(i); i++) applyIncc(i);

  const superseded = only(manual, (i) => i >= first && i <= last);
  if (superseded.size > 0) {
    issues.push(
      issue(
        'FEE_MANUAL_SUPERSEDED',
        `${superseded.size} ajuste(s) manual(is) de taxa em meses com emissão foram substituídos pelo valor emitido.`,
        { series: 'FEE' },
        'WARNING',
      ),
    );
  }

  const balanceAfterIssued = balance;
  const projectedTotal = Decimal.max(balance, ZERO);
  if (balance.isNegative()) {
    issues.push(
      issue(
        'FEE_ISSUED_ABOVE_BALANCE',
        `As emissões ultrapassam a taxa corrigida em ${balance.negated().toFixed(2)}; nada resta a projetar.`,
        { series: 'FEE' },
        'WARNING',
      ),
    );
  }

  const windowStart = last + 1;
  const windowWeights = weights.slice(windowStart);
  let windowManual = new Map(
    [...only(manual, (i) => i >= windowStart)].map(([i, v]) => [i - windowStart, v]),
  );
  if (sum([...windowManual.values()]).greaterThan(projectedTotal)) {
    issues.push(
      issue(
        'FEE_MANUAL_DROPPED',
        `Os ajustes manuais de taxa após a última emissão ultrapassam o saldo a receber (${projectedTotal.toFixed(2)}) e foram descartados.`,
        { series: 'FEE' },
        'WARNING',
      ),
    );
    windowManual = new Map();
  }
  if (windowWeights.length === 0 && projectedTotal.greaterThan(0)) {
    issues.push(
      issue(
        'FEE_BALANCE_UNALLOCATED',
        `Saldo de ${projectedTotal.toFixed(2)} sem mês de recebimento restante na projeção.`,
        { series: 'FEE' },
        'WARNING',
      ),
    );
  }
  const projected = distribute(
    windowWeights,
    windowManual,
    projectedTotal,
    MONEY_SCALE,
    'FEE',
    issues,
  );
  values.push(...projected.values);

  const keptManual = [...before.manual].filter((i) => i < first);
  const projectedManual = [...projected.manual].map((i) => i + windowStart);
  // What the series really adds up to: contract fee + INCC, adjusted by the edge cases
  // reported above (issued above the balance, balance without a month left).
  const expected = sum(values);

  return {
    values,
    manual: new Set([...keptManual, ...projectedManual]),
    issued: new Set(Array.from({ length: last - first + 1 }, (_, k) => first + k)),
    expected,
    adjustment: {
      firstIssuedMonth: periods[first]?.month ?? '',
      lastIssuedMonth: periods[last]?.month ?? '',
      issuedTotal: sum([...issued.values()]).toFixed(MONEY_SCALE),
      inccCorrection: correction.toFixed(MONEY_SCALE),
      balanceAfterIssued: balanceAfterIssued.toFixed(MONEY_SCALE),
      expectedFee: expected.toFixed(MONEY_SCALE),
    },
  };
}
