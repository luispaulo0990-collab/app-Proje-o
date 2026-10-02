/** Decimal values cross every boundary (API, DB, UI) as strings to avoid float errors. */
export type DecimalString = string;

/** ISO calendar date `YYYY-MM-DD`. */
export type IsoDate = string;

/** First day of a competence month, `YYYY-MM-01`. */
export type IsoMonth = string;

export type Series = 'PHYSICAL' | 'FEE';
/** CURVE = engine · MANUAL = typed in the grid · ISSUED = fee invoiced in the month. */
export type CellOrigin = 'CURVE' | 'MANUAL' | 'ISSUED';
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

/** Fee actually invoiced for a work in a month ("taxa emitida"). */
export interface FeeIssuance {
  month: IsoMonth;
  /** R$, 2 decimals, ≥ 0. */
  amount: DecimalString;
}

/** Monthly INCC variation of a competence month (0.0052 = 0,52%); it corrects the next month. */
export interface InccRate {
  month: IsoMonth;
  rate: DecimalString;
}

/** How issuances and INCC changed the fee of a work (persisted with each version). */
export interface FeeAdjustment {
  firstIssuedMonth: IsoMonth;
  lastIssuedMonth: IsoMonth;
  /** Σ issued (R$). */
  issuedTotal: DecimalString;
  /** Σ INCC corrections applied to the balance (R$). */
  inccCorrection: DecimalString;
  /** Balance still to be received after the last issuance, already corrected (R$). */
  balanceAfterIssued: DecimalString;
  /** Contract fee + INCC corrections (R$). */
  expectedFee: DecimalString;
}

export interface ProjectionInput {
  startDate: IsoDate;
  durationMonths: number;
  curve: readonly CurvePointInput[];
  /** Orçamento raso (R$). */
  budget: DecimalString;
  /** Taxa de administração as a fraction (0.10 = 10%). */
  feeRate: DecimalString;
  manualCells?: readonly ManualCell[];
  /** Default PRESERVE_MANUAL. */
  mode?: RecalcMode;
  /** Fee invoiced month by month; drives the fee series from the first issuance on. */
  feeIssuances?: readonly FeeIssuance[];
  /** INCC variations; INCC of M−1 corrects the balance to be received in M. */
  inccRates?: readonly InccRate[];
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
  /** Financial horizon = duration + competence lag (1 month). */
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
    feeAdjustment: FeeAdjustment | null;
  };
  validations: ValidationIssue[];
}
