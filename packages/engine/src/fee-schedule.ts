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
 * Fee series driven by the INCC and the monthly invoices ("taxa emitida") — rule of 07/10/2026:
 * the balance still to be received is corrected by the INCC from the data-base on, whether or
 * not there are issuances ("a receber" ≠ total − recebido: it is the corrected balance).
 *
 * Month by month, in order:
 * 1. a correction due in the month (every month for MONTHLY, every N months from the data-base
 *    otherwise — see createInccCorrector) with its INCC published: balance × (1 + INCC);
 * 2. months A..L (A = first, L = last issuance): fee = amount issued (a month without issuance
 *    inside the window was not invoiced: 0);
 * 3. other months: fee = their share of the balance projected by the physical curve
 *    (competência M−1), keeping manual fee cells. The projection is redone from each correction
 *    or issuance on, so the corrected balance is what the following months receive;
 * 4. balance −= fee.
 * Without INCC published nor issuances this is the original rule (contract fee by the curve).
 * An issuance always prevails: manual cells it replaces, or that no longer fit in the balance,
 * are dropped with a warning — a real invoice can always be recorded.
 */
export function buildFeeSchedule(input: FeeScheduleInput, issues: ValidationIssue[]): FeeSchedule {
  const { periods, weights, manual, feeTotal } = input;
  const issued = parseIssuances(input.issuances, periods, issues);
  const positions = [...issued.keys()];
  const first = positions.length > 0 ? Math.min(...positions) : -1;
  const last = positions.length > 0 ? Math.max(...positions) : -1;
  const inWindow = (i: number) => first >= 0 && i >= first && i <= last;
  const corrector = createInccCorrector(input.incc);

  const values: Decimal[] = [];
  const keptManual = new Set<number>();
  let balance = feeTotal;
  let correction = ZERO;
  let balanceAfterIssued: Decimal | null = null;
  /** Current projection of the balance over the months from `start` on (null = redo it). */
  let segment: { start: number; values: Decimal[]; manual: Set<number> } | null = null;

  /**
   * Projects the balance from `start` on by the curve. Before the first issuance only the manual
   * cells before it count (later ones must not move the months already invoiced); afterwards,
   * every manual cell from `start` on. Manual cells above a corrected balance are dropped.
   */
  const project = (start: number) => {
    const total = Decimal.max(balance, ZERO);
    const beforeWindow = first >= 0 && start < first;
    let free = new Map(
      [...manual]
        .filter(([i]) => i >= start && !inWindow(i) && (!beforeWindow || i < first))
        .map(([i, v]) => [i - start, v]),
    );
    if (start > 0 && sum([...free.values()]).greaterThan(total)) {
      issues.push(
        issue(
          'FEE_MANUAL_DROPPED',
          `Os ajustes manuais de taxa ultrapassam o saldo a receber (${total.toFixed(2)}) e foram descartados.`,
          { series: 'FEE' },
          'WARNING',
        ),
      );
      free = new Map();
    }
    const projected = distribute(weights.slice(start), free, total, MONEY_SCALE, 'FEE', issues);
    return { start, values: projected.values, manual: projected.manual };
  };

  for (let i = 0; i < periods.length; i++) {
    const step = corrector.at(periods[i]?.month ?? '');
    if (step.status === 'APPLIED') {
      const corrected = correct(balance, step.rate);
      correction = correction.plus(corrected.minus(balance));
      balance = corrected;
      segment = null; // the corrected balance is projected again from this month on
    }

    if (inWindow(i)) {
      const amount = issued.get(i) ?? ZERO;
      values.push(amount);
      balance = balance.minus(amount);
      segment = null;
      if (i === last) balanceAfterIssued = balance;
      continue;
    }

    segment ??= project(i);
    const offset = i - segment.start;
    const value = segment.values[offset] ?? ZERO;
    if (segment.manual.has(offset)) keptManual.add(i);
    values.push(value);
    balance = balance.minus(value);
  }

  const superseded = only(manual, inWindow);
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
  if (balanceAfterIssued?.isNegative()) {
    issues.push(
      issue(
        'FEE_ISSUED_ABOVE_BALANCE',
        `As emissões ultrapassam a taxa corrigida em ${balanceAfterIssued.negated().toFixed(2)}; nada resta a projetar.`,
        { series: 'FEE' },
        'WARNING',
      ),
    );
  }
  if (balance.greaterThan(0) && last === periods.length - 1) {
    issues.push(
      issue(
        'FEE_BALANCE_UNALLOCATED',
        `Saldo de ${balance.toFixed(2)} sem mês de recebimento restante na projeção.`,
        { series: 'FEE' },
        'WARNING',
      ),
    );
  }

  // What the series really adds up to: contract fee + INCC, adjusted by the edge cases
  // reported above (issued above the balance, balance without a month left).
  const expected = sum(values);
  const adjusted = issued.size > 0 || !correction.isZero();
  return {
    values,
    manual: keptManual,
    issued: new Set(first < 0 ? [] : Array.from({ length: last - first + 1 }, (_, k) => first + k)),
    expected,
    adjustment: adjusted
      ? {
          firstIssuedMonth: first < 0 ? null : (periods[first]?.month ?? null),
          lastIssuedMonth: last < 0 ? null : (periods[last]?.month ?? null),
          issuedTotal: sum([...issued.values()]).toFixed(MONEY_SCALE),
          inccCorrection: correction.toFixed(MONEY_SCALE),
          balanceAfterIssued: balanceAfterIssued?.toFixed(MONEY_SCALE) ?? null,
          expectedFee: expected.toFixed(MONEY_SCALE),
        }
      : null,
  };
}
