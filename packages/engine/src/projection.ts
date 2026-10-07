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
import { distribute } from './distribution.js';
import { EngineValidationError, assertNoErrors, issue } from './errors.js';
import { FEE_COMPETENCE_LAG_MONTHS, buildFeeSchedule } from './fee-schedule.js';
import { applyFeeRates, buildFeeTimeline } from './fee-terms.js';
import { canonicalMonth, createInccVariation, isInccPeriodicity } from './incc.js';
import { buildPeriods, buildSchedule, parseIsoDate } from './schedule.js';
import type {
  CellOrigin,
  FeeAdjustment,
  FeeTerm,
  InccPeriodicity,
  IsoMonth,
  ManualCell,
  Period,
  ProjectionCell,
  ProjectionInput,
  ProjectionResult,
  RecalcMode,
  Series,
  ValidationIssue,
} from './types.js';

function validateScalars(input: ProjectionInput): { budget: Decimal; feeRate: Decimal } {
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
  if (issues.length > 0) throw new EngineValidationError(issues);
  return { budget, feeRate };
}

/** Periodicity (default MONTHLY) and data-base (default: start month) of the INCC cycle. */
function validateInccCycle(input: ProjectionInput): {
  periodicity: InccPeriodicity;
  baseMonth: IsoMonth;
} {
  const periodicity = input.inccPeriodicity ?? 'MONTHLY';
  const baseMonth = canonicalMonth(input.inccBaseMonth ?? input.startDate);
  const issues: ValidationIssue[] = [];
  if (!isInccPeriodicity(periodicity)) {
    issues.push(
      issue('INVALID_INCC_PERIODICITY', `Periodicidade do INCC inválida: "${periodicity}".`),
    );
  }
  if (!baseMonth) issues.push(issue('INVALID_INCC_BASE_MONTH', 'Mês-base do INCC inválido.'));
  if (!baseMonth || issues.length > 0) throw new EngineValidationError(issues);
  return { periodicity, baseMonth };
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

function shift(values: readonly Decimal[], lag: number): Decimal[] {
  return [...Array.from({ length: lag }, () => ZERO), ...values];
}

interface CellSeries {
  values: readonly Decimal[];
  manual: ReadonlySet<number>;
  issued?: ReadonlySet<number>;
}

function originOf(series: CellSeries, i: number): CellOrigin {
  if (series.issued?.has(i)) return 'ISSUED';
  return series.manual.has(i) ? 'MANUAL' : 'CURVE';
}

function toCells(
  periods: readonly Period[],
  original: readonly Decimal[],
  series: CellSeries,
  scale: number,
): ProjectionCell[] {
  let running = ZERO;
  return periods.map((p, i) => {
    const current = series.values[i] ?? ZERO;
    running = running.plus(current);
    return {
      periodIndex: p.index,
      month: p.month,
      label: p.label,
      original: toFixedString(original[i] ?? ZERO, scale),
      current: toFixedString(current, scale),
      origin: originOf(series, i),
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
 * 5. fee series = budget × physical × rate in force in the month (fee terms), received one month
 *    later (competência M−1)
 * 6. from the first fee issuance on: invoiced values + INCC-corrected balance projected by the
 *    curve, corrected monthly or every N months (see buildFeeSchedule)
 */
export function calculateProjection(input: ProjectionInput): ProjectionResult {
  const schedule = buildSchedule(input.startDate, input.durationMonths);
  assertValidCurve(input.curve);
  const { budget, feeRate } = validateScalars(input);
  const mode: RecalcMode = input.mode ?? 'PRESERVE_MANUAL';
  const duration = input.durationMonths;
  const lag = FEE_COMPETENCE_LAG_MONTHS;
  const issues: ValidationIssue[] = [];

  const weights = resampleCurve(input.curve, duration);
  const physicalOriginal = allocateLargestRemainder(weights, ONE, PCT_SCALE);

  const manualCells = mode === 'PRESERVE_MANUAL' ? (input.manualCells ?? []) : [];
  const horizon = duration + lag;
  const manualPhysical = collectManual(manualCells, 'PHYSICAL', duration, PCT_SCALE, issues);
  const manualFee = collectManual(manualCells, 'FEE', horizon, MONEY_SCALE, issues);

  const physical = distribute(weights, manualPhysical, ONE, PCT_SCALE, 'PHYSICAL', issues);

  const { year, month } = parseIsoDate(input.startDate);
  const financialPeriods = buildPeriods({ year, month }, horizon);
  const cycle = validateInccCycle(input);
  const timeline = buildFeeTimeline(
    { feeRate, inccPeriodicity: cycle.periodicity },
    input.feeTerms ?? [],
    financialPeriods,
    issues,
  );
  const variation = createInccVariation(
    { indices: input.inccIndices, rates: input.inccRates },
    issues,
  );

  // Curve-only reference ("original") and series in force, both at the rate of each month.
  const feeOriginal = applyFeeRates(
    shift(physicalOriginal, lag),
    financialPeriods,
    timeline,
    budget,
  );
  const rated = applyFeeRates(shift(physical.values, lag), financialPeriods, timeline, budget);
  const fee = buildFeeSchedule(
    {
      periods: financialPeriods,
      weights: rated.weights,
      manual: manualFee,
      feeTotal: rated.total,
      issuances: input.feeIssuances ?? [],
      incc: { variation, periodicityAt: timeline.periodicityAt, baseMonth: cycle.baseMonth },
    },
    issues,
  );

  assertNoErrors(issues);

  return {
    schedule,
    financialPeriods,
    physical: toCells(schedule.periods, physicalOriginal, physical, PCT_SCALE),
    fee: toCells(
      financialPeriods,
      allocateLargestRemainder(feeOriginal.weights, feeOriginal.total, MONEY_SCALE),
      fee,
      MONEY_SCALE,
    ),
    totals: {
      physical: toFixedString(sum(physical.values), PCT_SCALE),
      fee: toFixedString(sum(fee.values), MONEY_SCALE),
      expectedFee: toFixedString(fee.expected, MONEY_SCALE),
    },
    parameters: {
      budget: toFixedString(budget, MONEY_SCALE),
      feeRate: toFixedString(feeRate, PCT_SCALE),
      feeLagMonths: lag,
      mode,
      manualCount: physical.manual.size + fee.manual.size,
      feeAdjustment: fee.adjustment,
      inccPeriodicity: cycle.periodicity,
      inccBaseMonth: cycle.baseMonth,
      feeTerms: timeline.terms,
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
  /** Lag used when the version was calculated (financial horizon = duration + lag). */
  feeLagMonths: number;
  mode?: RecalcMode;
  /** Issuance/INCC summary of the version; null = fee follows budget × rate. */
  feeAdjustment?: FeeAdjustment | null;
  /** Fee the version adds up to (since fee terms); older versions derive it. */
  expectedFee?: string;
  inccPeriodicity?: InccPeriodicity;
  inccBaseMonth?: IsoMonth;
  feeTerms?: readonly FeeTerm[];
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
    const positionsOf = (origin: CellOrigin) =>
      new Set(
        periods
          .map((p, i) => (byIndex.get(p.index)?.origin === origin ? i : -1))
          .filter((i) => i >= 0),
      );
    const manual = positionsOf('MANUAL');
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
      cells: toCells(periods, original, { values, manual, issued: positionsOf('ISSUED') }, scale),
      total: sum(values),
      manualCount: manual.size,
    };
  };

  const physical = rebuild(schedule.periods, stored.physical, PCT_SCALE, 'PHYSICAL');
  const fee = rebuild(financialPeriods, stored.fee, MONEY_SCALE, 'FEE');
  const adjustment = stored.feeAdjustment ?? null;
  const expectedFee = stored.expectedFee
    ? toDecimal(stored.expectedFee)
    : adjustment
      ? toDecimal(adjustment.expectedFee)
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
        adjustment
          ? 'A taxa total difere da taxa corrigida pelo INCC.'
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
      feeAdjustment: adjustment,
      inccPeriodicity: stored.inccPeriodicity ?? 'MONTHLY',
      inccBaseMonth: stored.inccBaseMonth ?? `${stored.startDate.slice(0, 7)}-01`,
      feeTerms: [...(stored.feeTerms ?? [])],
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
