/** Decimal values cross every boundary (API, DB, UI) as strings to avoid float errors. */
export type DecimalString = string;

/** ISO calendar date `YYYY-MM-DD`. */
export type IsoDate = string;

/** First day of a competence month, `YYYY-MM-01`. */
export type IsoMonth = string;

export type Series = 'PHYSICAL' | 'FEE';
export type CellOrigin = 'CURVE' | 'MANUAL';
export type RecalcMode = 'PRESERVE_MANUAL' | 'REPLACE_MANUAL';
export type Severity = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  context?: Record<string, string | number>;
}

export interface CurvePointInput {
  period: number;
  /** Monthly share as a fraction (0.02 = 2%). */
  monthlyPct: DecimalString | number;
  /** Optional cumulative fraction; when present it must be consistent with monthlyPct. */
  cumulativePct?: DecimalString | number;
}

export interface CurvePoint {
  period: number;
  monthlyPct: DecimalString;
  cumulativePct: DecimalString;
}

export interface Period {
  /** 1-based position inside the schedule. */
  index: number;
  month: IsoMonth;
  /** Brazilian short label, e.g. `JAN/27`. */
  label: string;
}

export interface Schedule {
  startDate: IsoDate;
  endDate: IsoDate;
  durationMonths: number;
  periods: Period[];
}

export interface ManualCell {
  series: Series;
  periodIndex: number;
  value: DecimalString;
}

/**
 * "Ajuste projeção de taxa": the user recalibrates what is still to be received. From
 * `fromMonth` (inclusive) on, the fee cells must add up to `remainingTotal`, spread by the
 * physical curve of those months. Months before `fromMonth` are not touched.
 */
export interface FeeRecalibration {
  fromMonth: IsoMonth;
  /** New Σ fee (R$, 2 decimals) from `fromMonth` to the end of the financial horizon. */
  remainingTotal: DecimalString;
}

export interface ProjectionInput {
  startDate: IsoDate;
  durationMonths: number;
  curve: readonly CurvePointInput[];
  /** Orçamento raso (R$). */
  budget: DecimalString;
  /** Taxa de administração as a fraction (0.10 = 10%). */
  feeRate: DecimalString;
  /** Months between physical progress and fee receipt. Default 0. */
  feeLagMonths?: number;
  manualCells?: readonly ManualCell[];
  /** Default PRESERVE_MANUAL. */
  mode?: RecalcMode;
  /** Optional recalibration of the fee still to be received. */
  feeRecalibration?: FeeRecalibration | null;
}

export interface ProjectionCell {
  periodIndex: number;
  month: IsoMonth;
  label: string;
  /** Value produced by the curve alone. */
  original: DecimalString;
  /** Value in force (curve, redistributed, or manual). */
  current: DecimalString;
  origin: CellOrigin;
  cumulative: DecimalString;
}

export interface ProjectionResult {
  schedule: Schedule;
  /** Financial horizon = duration + fee lag. */
  financialPeriods: Period[];
  physical: ProjectionCell[];
  fee: ProjectionCell[];
  totals: {
    physical: DecimalString;
    fee: DecimalString;
    expectedFee: DecimalString;
  };
  parameters: {
    budget: DecimalString;
    feeRate: DecimalString;
    feeLagMonths: number;
    mode: RecalcMode;
    manualCount: number;
    feeRecalibration: FeeRecalibration | null;
  };
  validations: ValidationIssue[];
}
