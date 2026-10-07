import { Decimal, MONEY_SCALE, ONE, ZERO, roundTo, sum, toDecimal } from './decimal.js';
import { distribute, type Distribution } from './distribution.js';
import { issue } from './errors.js';
import { canonicalMonth, createInccCorrector, type InccCorrectorInput } from './incc.js';
import type { FeeAdjustment, FeeIssuance, Period, ValidationIssue } from './types.js';

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
  /** Lagged physical weights of each financial period, already multiplied by the rate in force. */
  weights: readonly Decimal[];
  /** Manual fee cells typed by the user, by position. */
  manual: ReadonlyMap<number, Decimal>;
  /** Contract fee: budget × fee rate(s) — see applyFeeRates. */
  feeTotal: Decimal;
  issuances: readonly FeeIssuance[];
  /** INCC variations, periodicity over time and data-base of the correction cycle. */
  incc: InccCorrectorInput;
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

/** Balance corrected by one INCC window (2 decimals, HALF_EVEN). Only positive balances. */
function correct(balance: Decimal, rate: Decimal): Decimal {
  if (!balance.greaterThan(0)) return balance;
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
 * 2. each month M in A..L: balance × (1 + INCC) when a correction is due in M (every month for
 *    MONTHLY, every N months from the data-base otherwise — see createInccCorrector), then
 *    fee(M) = amount issued in M (a month without issuance inside the window was not invoiced:
 *    0) and balance −= fee(M);
 * 3. corrections due after L whose INCC is already published correct the balance as well
 *    (up to the first one still unpublished);
 * 4. the balance is projected over the months after L by the physical curve (competência
 *    M−1), keeping manual fee cells.
 * An issuance always prevails: manual cells it replaces, or that no longer fit in the
 * balance, are dropped with a warning — a real invoice can always be recorded.
 */
export function buildFeeSchedule(input: FeeScheduleInput, issues: ValidationIssue[]): FeeSchedule {
  const { periods, weights, manual, feeTotal } = input;
  const issued = parseIssuances(input.issuances, periods, issues);
  if (issued.size === 0) {
    const regular = distribute(weights, manual, feeTotal, MONEY_SCALE, 'FEE', issues);
    return { ...regular, issued: new Set(), expected: feeTotal, adjustment: null };
  }

  const positions = [...issued.keys()];
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const corrector = createInccCorrector(input.incc);

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
  /** Corrects the balance when due in the period; returns false if its INCC is unpublished. */
  const applyIncc = (index: number): boolean => {
    const step = corrector.at(periods[index]?.month ?? '');
    if (step.status === 'APPLIED') {
      const corrected = correct(balance, step.rate);
      correction = correction.plus(corrected.minus(balance));
      balance = corrected;
    }
    return step.status !== 'MISSING';
  };

  for (let i = first; i <= last; i++) {
    applyIncc(i);
    const amount = issued.get(i) ?? ZERO;
    values.push(amount);
    balance = balance.minus(amount);
  }
  for (let i = last + 1; i < periods.length; i++) {
    if (!applyIncc(i)) break;
  }

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
