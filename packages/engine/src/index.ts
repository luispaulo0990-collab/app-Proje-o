export * from './types.js';
export { EngineValidationError } from './errors.js';
export { Decimal, PCT_SCALE, MONEY_SCALE, PCT_TOLERANCE, toFixedString } from './decimal.js';
export { allocateLargestRemainder } from './allocation.js';
export {
  buildSchedule,
  buildPeriods,
  monthLabel,
  parseIsoDate,
  parseIsoMonth,
  toIsoMonth,
  MAX_DURATION_MONTHS,
} from './schedule.js';
export {
  validateCurve,
  assertValidCurve,
  canonicalizeCurve,
  normalizeCurveWeights,
  curveFromCumulative,
  resampleCurve,
  MAX_CURVE_POINTS,
} from './curve.js';
export {
  calculateProjection,
  computeFeeTotal,
  hydrateProjection,
  listManualCells,
  type StoredCell,
  type StoredProjection,
} from './projection.js';
export { FEE_COMPETENCE_LAG_MONTHS, buildFeeSchedule } from './fee-schedule.js';
export { computeKpis, type ProjectionKpis } from './kpis.js';
export {
  aggregatePortfolio,
  type PortfolioAggregate,
  type PortfolioItem,
  type PortfolioMonth,
} from './portfolio.js';
export {
  resolveEffectiveCurve,
  hasWorkStarted,
  buildCurveSeries,
  pointsFromMonths,
  monthIndexIn,
  type ActualCurveInput,
  type CurveSeriesCell,
  type CurveSource,
  type EffectiveCurve,
  type EffectiveCurveInput,
  type WorkCurveStatus,
} from './work-curve.js';
export {
  buildConsolidatedPanel,
  type ConsolidatedMonth,
  type ConsolidatedPanel,
  type ConsolidatedWorkSummary,
  type ConsolidatedYear,
} from './consolidated.js';
export {
  curveFromCumulativeSeries,
  CUMULATIVE_END_TOLERANCE,
  type CumulativeEntry,
  type CumulativeSeriesResult,
} from './cumulative-series.js';
export {
  computeProgressIndicators,
  projectedEndMonth,
  monthsIncurred,
  monthsBetween,
  addMonthsIso,
  firstProgressMonth,
  type ClientStatus,
  type ProgressEntry,
  type ProgressIndicators,
} from './work-indicators.js';
export {
  computeEconomicIndicators,
  canonicalEconomicEntry,
  isEconomicClosing,
  IEC_SCALE,
  type EconomicEntry,
  type EconomicIndicators,
} from './economic-indicators.js';
export {
  INCC_INDEX_SCALE,
  INCC_PERIOD_MONTHS,
  INCC_PERIODICITIES,
  inccRatesFromIndices,
  isInccPeriodicity,
} from './incc.js';
