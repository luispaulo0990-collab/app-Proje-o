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

/** Published INCC number-index of a month (e.g. FGV INCC-DI of AGO/26 = 1296.889). */
export interface InccIndex {
  month: IsoMonth;
  index: DecimalString;
}

/**
 * How often the balance to be received is corrected by the INCC. Each correction uses the INCC
 * variation accumulated since the previous correction (one month, a quarter, four months…).
 */
export type InccPeriodicity = 'MONTHLY' | 'QUARTERLY' | 'FOUR_MONTHLY' | 'SEMIANNUAL' | 'ANNUAL';

/**
 * Fee conditions in force from a financial month on ("vigência"). Carries the new values, never
 * a variation: `feeRate: '0.09'` means "9% from this month on", whatever the previous rate was.
 */
export interface FeeTerm {
  month: IsoMonth;
  /** Fee rate as a fraction (0.09 = 9%) applied to the fee received from `month` on. */
  feeRate: DecimalString;
  inccPeriodicity: InccPeriodicity;
}

/** How the INCC and the issuances changed the fee of a work (persisted with each version). */
export interface FeeAdjustment {
  /** null = no issuance yet (only the INCC changed the fee). */
  firstIssuedMonth: IsoMonth | null;
  lastIssuedMonth: IsoMonth | null;
  /** Σ issued (R$). */
  issuedTotal: DecimalString;
  /** Σ INCC corrections applied to the balance (R$). */
  inccCorrection: DecimalString;
  /** Balance still to be received right after the last issuance (R$); null = no issuance. */
  balanceAfterIssued: DecimalString | null;
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
  /**
   * INCC number-indices (preferred over `inccRates`): the variation of a correction window is
   * `index(last month) ÷ index(month before the window) − 1`, exact for any periodicity.
   */
  inccIndices?: readonly InccIndex[];
  /** Periodicity of the INCC correction until the first fee term. Default MONTHLY. */
  inccPeriodicity?: InccPeriodicity;
  /**
   * "Data-base" of the INCC cycle: corrections fall every N months counted from it (N = 3 for
   * QUARTERLY…). Default = start month. Irrelevant for MONTHLY.
   */
  inccBaseMonth?: IsoMonth;
  /** Changes of the fee conditions over time (new rate / INCC periodicity from a month on). */
  feeTerms?: readonly FeeTerm[];
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
    inccPeriodicity: InccPeriodicity;
    inccBaseMonth: IsoMonth;
    /** Canonical fee terms applied (sorted, 8-decimal rates). */
    feeTerms: FeeTerm[];
  };
  validations: ValidationIssue[];
}
