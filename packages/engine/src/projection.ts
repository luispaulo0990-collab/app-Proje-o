import { allocateLargestRemainder } from './allocation.js';
import { assertValidCurve, resampleCurve } from './curve.js';
import {
  Decimal,
  MONEY_SCALE,
  ONE,
  PCT_SCALE,
  ZERO,
  roundTo,
  sum,
  toDecimal,
  toFixedString,
} from './decimal.js';
import { EngineValidationError, issue } from './errors.js';
import {
  buildPeriods,
  buildSchedule,
  parseIsoDate,
  parseIsoMonth,
  toIsoMonth,
} from './schedule.js';
import type {
  CellOrigin,
  FeeRecalibration,
  ManualCell,
  Period,
  ProjectionCell,
  ProjectionInput,
  ProjectionResult,
  RecalcMode,
  Series,
  ValidationIssue,
} from './types.js';

export const MAX_FEE_LAG_MONTHS = 36;

interface Distribution {
  values: Decimal[];
  manual: Set<number>;
}

function validateScalars(input: ProjectionInput): {
  budget: Decimal;
  feeRate: Decimal;
  lag: number;
} {
  const issues: ValidationIssue[] = [];
  let budget = ZERO;
  let feeRate = ZERO;
  try {
    budget = toDecimal(input.budget, 'orçamento');
    if (budget.isNegative())
      issues.push(issue('INVALID_BUDGET', 'O orçamento não pode ser negativo.'));
    if (budget.decimalPlaces() > MONEY_SCALE)
      issues.push(issue('INVALID_BUDGET', 'O orçamento aceita no máximo 2 casas decimais.'));
  } catch {
    issues.push(issue('INVALID_BUDGET', 'Orçamento inválido.'));
  }
  try {
    feeRate = toDecimal(input.feeRate, 'taxa');
    if (feeRate.isNegative() || feeRate.greaterThan(ONE)) {
      issues.push(issue('INVALID_FEE_RATE', 'A taxa deve estar entre 0% e 100%.'));
    }
  } catch {
    issues.push(issue('INVALID_FEE_RATE', 'Taxa inválida.'));
  }
  const lag = input.feeLagMonths ?? 0;
  if (!Number.isInteger(lag) || lag < 0 || lag > MAX_FEE_LAG_MONTHS) {
    issues.push(
      issue(
        'INVALID_FEE_LAG',
        `A defasagem da taxa deve ser um inteiro entre 0 e ${MAX_FEE_LAG_MONTHS} meses.`,
      ),
    );
  }
  if (issues.length > 0) throw new EngineValidationError(issues);
  return { budget, feeRate, lag };
}

function collectManual(
  cells: readonly ManualCell[],
  series: Series,
  length: number,
  scale: number,
  issues: ValidationIssue[],
): Map<number, Decimal> {
  const map = new Map<number, Decimal>();
  for (const cell of cells.filter((c) => c.series === series)) {
    const ctx = { series, periodIndex: cell.periodIndex };
    if (!Number.isInteger(cell.periodIndex) || cell.periodIndex < 1 || cell.periodIndex > length) {
      issues.push(
        issue(
          'MANUAL_OUT_OF_RANGE',
          `Ajuste manual fora do cronograma (período ${cell.periodIndex}).`,
          ctx,
        ),
      );
      continue;
    }
    if (map.has(cell.periodIndex - 1)) {
      issues.push(
        issue('MANUAL_DUPLICATED', `Ajuste manual duplicado no período ${cell.periodIndex}.`, ctx),
      );
      continue;
    }
    let value: Decimal;
    try {
      value = roundTo(toDecimal(cell.value), scale);
    } catch {
      issues.push(
        issue('MANUAL_INVALID', `Valor manual inválido no período ${cell.periodIndex}.`, ctx),
      );
      continue;
    }
    if (value.isNegative()) {
      issues.push(
        issue('MANUAL_NEGATIVE', `Valor manual negativo no período ${cell.periodIndex}.`, ctx),
      );
      continue;
    }
    map.set(cell.periodIndex - 1, value);
  }
  return map;
}

/**
 * Keeps manual cells and spreads what is left of `total` over the remaining cells,
 * proportionally to `weights`. Guarantees Σ = total whenever at least one free cell exists.
 */
function distribute(
  weights: readonly Decimal[],
  manual: Map<number, Decimal>,
  total: Decimal,
  scale: number,
  series: Series,
  issues: ValidationIssue[],
): Distribution {
  const manualSum = sum([...manual.values()]);
  if (manualSum.greaterThan(total)) {
    issues.push(
      issue(
        'MANUAL_EXCEEDS_TOTAL',
        `Os ajustes manuais (${manualSum.toString()}) ultrapassam o total da série ${series} (${total.toString()}).`,
        {
          series,
        },
      ),
    );
    return { values: weights.map(() => ZERO), manual: new Set(manual.keys()) };
  }
  const freeIdx = weights.map((_, i) => i).filter((i) => !manual.has(i));
  const remaining = total.minus(manualSum);
  const values = weights.map((_, i) => manual.get(i) ?? ZERO);

  if (freeIdx.length === 0) {
    if (!remaining.isZero()) {
      issues.push(
        issue(
          'SERIES_TOTAL_MISMATCH',
          `Todos os períodos da série ${series} são manuais e somam ${manualSum.toString()} (esperado ${total.toString()}).`,
          { series },
          'WARNING',
        ),
      );
    }
    return { values, manual: new Set(manual.keys()) };
  }
  const freeWeights = freeIdx.map((i) => weights[i] ?? ZERO);
  if (sum(freeWeights).isZero() && remaining.greaterThan(0)) {
    issues.push(
      issue(
        'REDISTRIBUTION_UNIFORM',
        `A curva não possui peso nos períodos livres da série ${series}; o saldo foi distribuído igualmente.`,
        { series },
        'WARNING',
      ),
    );
  }
  allocateLargestRemainder(freeWeights, remaining, scale).forEach((v, k) => {
    const idx = freeIdx[k];
    if (idx !== undefined) values[idx] = v;
  });
  return { values, manual: new Set(manual.keys()) };
}

function parseRecalibration(
  recal: FeeRecalibration,
  issues: ValidationIssue[],
): { fromMonth: string; remaining: Decimal } | null {
  let fromMonth: string | null = null;
  let remaining: Decimal | null = null;
  try {
    fromMonth = toIsoMonth(parseIsoMonth(recal.fromMonth));
  } catch {
    issues.push(
      issue(
        'INVALID_FEE_RECALIBRATION',
        `Mês inicial do ajuste de taxa inválido: "${recal.fromMonth}".`,
      ),
    );
  }
  try {
    remaining = toDecimal(recal.remainingTotal, 'ajuste de taxa');
    if (remaining.isNegative()) {
      issues.push(issue('INVALID_FEE_RECALIBRATION', 'O ajuste de taxa não pode ser negativo.'));
      remaining = null;
    } else if (remaining.decimalPlaces() > MONEY_SCALE) {
      issues.push(
        issue('INVALID_FEE_RECALIBRATION', 'O ajuste de taxa aceita no máximo 2 casas decimais.'),
      );
      remaining = null;
    }
  } catch {
    issues.push(issue('INVALID_FEE_RECALIBRATION', 'Valor do ajuste de taxa inválido.'));
  }
  return fromMonth && remaining ? { fromMonth, remaining } : null;
}

/**
 * "Ajuste projeção de taxa": replaces Σ fee from `fromMonth` on by `remaining`, spread over
 * the months ≥ fromMonth proportionally to the (lagged) physical curve. Manual fee cells in
 * that window are kept and consume part of `remaining`. Months before `fromMonth` keep the
 * values of the regular distribution.
 */
function recalibrateFee(
  periods: readonly Period[],
  weights: readonly Decimal[],
  fee: Distribution,
  manualFee: Map<number, Decimal>,
  recal: { fromMonth: string; remaining: Decimal },
  issues: ValidationIssue[],
): Distribution {
  const from = periods.findIndex((p) => p.month >= recal.fromMonth);
  if (from < 0) {
    issues.push(
      issue(
        'FEE_RECALIBRATION_OUT_OF_RANGE',
        'Não há meses de taxa na projeção a partir do mês do ajuste — a obra já terminou de faturar.',
        { fromMonth: recal.fromMonth },
      ),
    );
    return fee;
  }
  const windowManual = new Map(
    [...manualFee.entries()].filter(([i]) => i >= from).map(([i, v]) => [i - from, v] as const),
  );
  const manualSum = sum([...windowManual.values()]);
  if (manualSum.greaterThan(recal.remaining)) {
    issues.push(
      issue(
        'FEE_RECALIBRATION_BELOW_MANUAL',
        `Os ajustes manuais de taxa a partir do mês do ajuste (${manualSum.toFixed(2)}) ultrapassam o valor informado (${recal.remaining.toFixed(2)}).`,
      ),
    );
    return fee;
  }
  const window = distribute(
    weights.slice(from),
    windowManual,
    recal.remaining,
    MONEY_SCALE,
    'FEE',
    issues,
  );
  return { values: [...fee.values.slice(0, from), ...window.values], manual: fee.manual };
}

/** Σ fee expected with a recalibration: months before `fromMonth` as they are + remaining. */
function expectedWithRecalibration(
  periods: readonly Period[],
  values: readonly Decimal[],
  recal: { fromMonth: string; remaining: Decimal },
): Decimal {
  const before = periods.reduce(
    (acc, p, i) => (p.month < recal.fromMonth ? acc.plus(values[i] ?? ZERO) : acc),
    ZERO,
  );
  return before.plus(recal.remaining);
}

function shift(values: readonly Decimal[], lag: number): Decimal[] {
  return [...Array.from({ length: lag }, () => ZERO), ...values];
}

function toCells(
  periods: readonly Period[],
  original: readonly Decimal[],
  dist: Distribution,
  scale: number,
): ProjectionCell[] {
  let running = ZERO;
  return periods.map((p, i) => {
    const current = dist.values[i] ?? ZERO;
    running = running.plus(current);
    const origin: CellOrigin = dist.manual.has(i) ? 'MANUAL' : 'CURVE';
    return {
      periodIndex: p.index,
      month: p.month,
      label: p.label,
      original: toFixedString(original[i] ?? ZERO, scale),
      current: toFixedString(current, scale),
      origin,
      cumulative: toFixedString(running, scale),
    };
  });
}

/**
 * ProjectionEngine entry point. Pure and deterministic: same input → same output.
 *
 * 1. schedule from start date + duration
 * 2. curve validated and resampled to the duration
 * 3. physical series (fractions, 8 decimals, Σ = 100%)
 * 4. manual cells preserved or discarded according to `mode`
 * 5. fee series = fee total × physical, shifted by `feeLagMonths` (2 decimals, Σ = total)
 */
export function calculateProjection(input: ProjectionInput): ProjectionResult {
  const schedule = buildSchedule(input.startDate, input.durationMonths);
  assertValidCurve(input.curve);
  const { budget, feeRate, lag } = validateScalars(input);
  const mode: RecalcMode = input.mode ?? 'PRESERVE_MANUAL';
  const duration = input.durationMonths;
  const issues: ValidationIssue[] = [];

  const weights = resampleCurve(input.curve, duration);
  const physicalOriginal = allocateLargestRemainder(weights, ONE, PCT_SCALE);

  const manualCells = mode === 'PRESERVE_MANUAL' ? (input.manualCells ?? []) : [];
  const horizon = duration + lag;
  const manualPhysical = collectManual(manualCells, 'PHYSICAL', duration, PCT_SCALE, issues);
  const manualFee = collectManual(manualCells, 'FEE', horizon, MONEY_SCALE, issues);

  const physical = distribute(weights, manualPhysical, ONE, PCT_SCALE, 'PHYSICAL', issues);

  const feeTotal = roundTo(budget.times(feeRate), MONEY_SCALE);
  const feeOriginal = allocateLargestRemainder(shift(physicalOriginal, lag), feeTotal, MONEY_SCALE);
  const feeWeights = shift(physical.values, lag);
  const baseFee = distribute(feeWeights, manualFee, feeTotal, MONEY_SCALE, 'FEE', issues);

  const { year, month } = parseIsoDate(input.startDate);
  const financialPeriods = buildPeriods({ year, month }, horizon);

  const recal = input.feeRecalibration ? parseRecalibration(input.feeRecalibration, issues) : null;
  const fee = recal
    ? recalibrateFee(financialPeriods, feeWeights, baseFee, manualFee, recal, issues)
    : baseFee;
  const expectedFee = recal
    ? expectedWithRecalibration(financialPeriods, fee.values, recal)
    : feeTotal;

  if (issues.some((i) => i.severity === 'ERROR')) {
    throw new EngineValidationError(issues.filter((i) => i.severity === 'ERROR'));
  }

  return {
    schedule,
    financialPeriods,
    physical: toCells(schedule.periods, physicalOriginal, physical, PCT_SCALE),
    fee: toCells(financialPeriods, feeOriginal, fee, MONEY_SCALE),
    totals: {
      physical: toFixedString(sum(physical.values), PCT_SCALE),
      fee: toFixedString(sum(fee.values), MONEY_SCALE),
      expectedFee: toFixedString(expectedFee, MONEY_SCALE),
    },
    parameters: {
      budget: toFixedString(budget, MONEY_SCALE),
      feeRate: toFixedString(feeRate, PCT_SCALE),
      feeLagMonths: lag,
      mode,
      manualCount: physical.manual.size + fee.manual.size,
      feeRecalibration: recal
        ? {
            fromMonth: recal.fromMonth,
            remainingTotal: toFixedString(recal.remaining, MONEY_SCALE),
          }
        : null,
    },
    validations: issues,
  };
}

/** Manual cells currently present in a result — used to warn before a recalculation. */
export function listManualCells(result: Pick<ProjectionResult, 'physical' | 'fee'>): ManualCell[] {
  const pick = (series: Series, cells: readonly ProjectionCell[]): ManualCell[] =>
    cells
      .filter((c) => c.origin === 'MANUAL')
      .map((c) => ({ series, periodIndex: c.periodIndex, value: c.current }));
  return [...pick('PHYSICAL', result.physical), ...pick('FEE', result.fee)];
}

export interface StoredCell {
  periodIndex: number;
  original: string;
  current: string;
  origin: CellOrigin;
}

export interface StoredProjection {
  startDate: string;
  durationMonths: number;
  budget: string;
  feeRate: string;
  feeLagMonths: number;
  mode?: RecalcMode;
  feeRecalibration?: FeeRecalibration | null;
  physical: readonly StoredCell[];
  fee: readonly StoredCell[];
}

/**
 * Rebuilds a full result (periods, cumulative, totals, checks) from persisted values
 * without re-running the curve — a saved version stays exactly as it was calculated.
 */
export function hydrateProjection(stored: StoredProjection): ProjectionResult {
  const schedule = buildSchedule(stored.startDate, stored.durationMonths);
  const { year, month } = parseIsoDate(stored.startDate);
  const financialPeriods = buildPeriods(
    { year, month },
    stored.durationMonths + stored.feeLagMonths,
  );
  const issues: ValidationIssue[] = [];

  const rebuild = (
    periods: readonly Period[],
    cells: readonly StoredCell[],
    scale: number,
    series: Series,
  ) => {
    const byIndex = new Map(cells.map((c) => [c.periodIndex, c]));
    const original = periods.map((p) => toDecimal(byIndex.get(p.index)?.original ?? '0'));
    const values = periods.map((p) => toDecimal(byIndex.get(p.index)?.current ?? '0'));
    const manual = new Set(
      periods
        .map((p, i) => (byIndex.get(p.index)?.origin === 'MANUAL' ? i : -1))
        .filter((i) => i >= 0),
    );
    if (cells.length !== periods.length) {
      issues.push(
        issue(
          'STORED_LENGTH_MISMATCH',
          `A série ${series} armazenada não cobre o cronograma atual.`,
          { series },
          'WARNING',
        ),
      );
    }
    return {
      cells: toCells(periods, original, { values, manual }, scale),
      total: sum(values),
      manualCount: manual.size,
    };
  };

  const physical = rebuild(schedule.periods, stored.physical, PCT_SCALE, 'PHYSICAL');
  const fee = rebuild(financialPeriods, stored.fee, MONEY_SCALE, 'FEE');
  const storedRecal = stored.feeRecalibration
    ? {
        fromMonth: stored.feeRecalibration.fromMonth,
        remaining: toDecimal(stored.feeRecalibration.remainingTotal),
      }
    : null;
  const expectedFee = storedRecal
    ? expectedWithRecalibration(
        financialPeriods,
        fee.cells.map((c) => toDecimal(c.current)),
        storedRecal,
      )
    : roundTo(toDecimal(stored.budget).times(stored.feeRate), MONEY_SCALE);
  if (!physical.total.equals(ONE)) {
    issues.push(
      issue(
        'SERIES_TOTAL_MISMATCH',
        'O avanço físico total é diferente de 100%.',
        { series: 'PHYSICAL' },
        'WARNING',
      ),
    );
  }
  if (!fee.total.equals(expectedFee)) {
    issues.push(
      issue(
        'SERIES_TOTAL_MISMATCH',
        storedRecal
          ? 'A taxa total difere do valor recalibrado.'
          : 'A taxa total difere de orçamento × taxa.',
        { series: 'FEE' },
        'WARNING',
      ),
    );
  }
  return {
    schedule,
    financialPeriods,
    physical: physical.cells,
    fee: fee.cells,
    totals: {
      physical: toFixedString(physical.total, PCT_SCALE),
      fee: toFixedString(fee.total, MONEY_SCALE),
      expectedFee: toFixedString(expectedFee, MONEY_SCALE),
    },
    parameters: {
      budget: toFixedString(toDecimal(stored.budget), MONEY_SCALE),
      feeRate: toFixedString(toDecimal(stored.feeRate), PCT_SCALE),
      feeLagMonths: stored.feeLagMonths,
      mode: stored.mode ?? 'PRESERVE_MANUAL',
      manualCount: physical.manualCount + fee.manualCount,
      feeRecalibration: storedRecal
        ? {
            fromMonth: storedRecal.fromMonth,
            remainingTotal: toFixedString(storedRecal.remaining, MONEY_SCALE),
          }
        : null,
    },
    validations: issues,
  };
}

/** Fee total of a work: round2(budget × feeRate), HALF_EVEN. */
export function computeFeeTotal(budget: string, feeRate: string): string {
  return toFixedString(
    roundTo(toDecimal(budget, 'orçamento').times(toDecimal(feeRate, 'taxa')), MONEY_SCALE),
    MONEY_SCALE,
  );
}
