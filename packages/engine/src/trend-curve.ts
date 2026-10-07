import { normalizeCurveWeights, MAX_CURVE_POINTS } from './curve.js';
import { Decimal, ONE, PCT_SCALE, ZERO, roundTo, toDecimal, toFixedString } from './decimal.js';
import { issue } from './errors.js';
import { addMonths, parseIsoMonth, toIsoMonth } from './schedule.js';
import type {
  CurvePoint,
  CurvePointInput,
  DecimalString,
  IsoMonth,
  ValidationIssue,
} from './types.js';

/** Months of realized progress averaged to obtain the work's recent pace. */
export const TREND_WINDOW_MONTHS = 3;

/**
 * Weight of the replanned curve in each trend month; the rest is the realized pace.
 * 0,6 → plan asks 15%, pace is 3%: 0,6 × 15% + 0,4 × 3% = 10,2% (example given by the user).
 */
export const TREND_PLAN_WEIGHT = '0.6';

/** "Realizado Acumulado" of a closing month (fraction: 0.29 = 29%). */
export interface RealizedEntry {
  month: IsoMonth;
  realizedCumulative?: DecimalString | null;
}

export interface TrendCurveInput {
  /** Current month: the last month that can have realized progress. */
  referenceMonth: IsoMonth;
  /** "Replanejado Atual Acumulado - Obra" as an own curve (start month + monthly points). */
  replanned: { startMonth: IsoMonth; points: readonly CurvePointInput[] };
  realized: readonly RealizedEntry[];
  windowMonths?: number;
  planWeight?: DecimalString;
}

/** How a trend curve was built — shown on screen and persisted with the projection. */
export interface TrendInfo {
  /** Last month taken from "Realizado Acumulado" (the trend starts in the next month). */
  lastRealizedMonth: IsoMonth;
  realizedCumulative: DecimalString;
  /** Average monthly progress over the window (fraction). */
  averagePace: DecimalString;
  windowMonths: number;
  planWeight: DecimalString;
  /** Months after the replanned curve that were needed to reach 100%. */
  extensionMonths: number;
}

export interface TrendCurve {
  startMonth: IsoMonth;
  points: CurvePoint[];
  info: TrendInfo;
  issues: ValidationIssue[];
}

const shift = (month: IsoMonth, months: number) =>
  toIsoMonth(addMonths(parseIsoMonth(month), months));
const present = (v: DecimalString | null | undefined): v is DecimalString =>
  v !== null && v !== undefined && v !== '';

/** Replanned monthly progress by calendar month. */
function replannedByMonth(replanned: TrendCurveInput['replanned']): Map<IsoMonth, Decimal> {
  const start = toIsoMonth(parseIsoMonth(replanned.startMonth));
  return new Map(replanned.points.map((p, i) => [shift(start, i), toDecimal(p.monthlyPct)]));
}

/**
 * Realized cumulative month by month (≤ reference), non-decreasing and capped at 100%: a later
 * correction downwards never produces a negative month. Missing months repeat the previous one.
 */
function realizedCumulative(
  entries: readonly RealizedEntry[],
  referenceMonth: IsoMonth,
  issues: ValidationIssue[],
): Map<IsoMonth, Decimal> {
  const sorted = entries
    .filter((e) => present(e.realizedCumulative) && e.month <= referenceMonth)
    .map((e) => ({
      month: toIsoMonth(parseIsoMonth(e.month)),
      value: toDecimal(e.realizedCumulative ?? '0'),
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  const result = new Map<IsoMonth, Decimal>();
  let running = ZERO;
  for (const e of sorted) {
    if (e.value.lessThan(running)) {
      issues.push(
        issue(
          'REALIZED_DECREASING',
          `O realizado acumulado de ${e.month.slice(0, 7)} é menor que o do mês anterior; mantido o maior valor.`,
          { month: e.month },
          'WARNING',
        ),
      );
    }
    running = Decimal.min(ONE, Decimal.max(running, e.value));
    result.set(e.month, running);
  }
  return result;
}

/**
 * Trend curve of a started work (rule defined 07/10/2026):
 *
 * 1. Up to the current month the curve is the "Realizado Acumulado" received from the API. The
 *    current month counts as realized only when it already shows progress; otherwise it is the
 *    first trend month.
 * 2. From the next month on, each month is a blend of what the replanned curve asks and what the
 *    work has been doing: `trend = w × replanned(month) + (1 − w) × pace`, where pace = average
 *    realized monthly progress of the last N months (w = TREND_PLAN_WEIGHT, N = TREND_WINDOW_MONTHS).
 * 3. The trend stops when the work reaches 100%. If the replanned curve ends first, the work keeps
 *    its pace (or its overall average, if larger) until 100% — the end date moves out.
 *
 * Returns null when there is no realized progress yet (the replanned curve is used as is).
 */
export function buildTrendCurve(input: TrendCurveInput): TrendCurve | null {
  const issues: ValidationIssue[] = [];
  const window = input.windowMonths ?? TREND_WINDOW_MONTHS;
  const weight = toDecimal(input.planWeight ?? TREND_PLAN_WEIGHT);
  const reference = toIsoMonth(parseIsoMonth(input.referenceMonth));
  const realized = realizedCumulative(input.realized, reference, issues);
  const cumulativeAt = (month: IsoMonth) => {
    let value = ZERO;
    for (const [m, v] of realized) if (m <= month) value = v;
    return value;
  };

  const months = [...realized.keys()];
  const firstWithProgress = months.find((m) => realized.get(m)?.greaterThan(0));
  if (!firstWithProgress) return null;

  // 1. Last realized month: the current month only if it already has progress.
  let last = months.at(-1) ?? reference;
  if (
    last === reference &&
    !cumulativeAt(reference).greaterThan(cumulativeAt(shift(reference, -1)))
  ) {
    last = shift(reference, -1);
  }
  const replanned = replannedByMonth(input.replanned);
  const replannedStart = toIsoMonth(parseIsoMonth(input.replanned.startMonth));
  const start = replannedStart < firstWithProgress ? replannedStart : firstWithProgress;

  const monthly: Decimal[] = [];
  for (let m = start; m <= last; m = shift(m, 1)) {
    monthly.push(cumulativeAt(m).minus(cumulativeAt(shift(m, -1))));
  }
  const done = cumulativeAt(last);
  const realizedMonths = monthly.length;
  let remaining = ONE.minus(done);

  // 2. Recent pace: average monthly progress over the window (or since the start, if shorter).
  const windowLength = Math.min(window, monthly.length);
  const pace = roundTo(
    done.minus(cumulativeAt(shift(last, -windowLength))).div(windowLength),
    PCT_SCALE,
  );

  const take = (value: Decimal) => {
    const amount = Decimal.min(value, remaining);
    monthly.push(amount);
    remaining = remaining.minus(amount);
  };
  const plannedAhead = [...replanned].filter(([m]) => m > last).map(([, v]) => v);
  for (const planned of plannedAhead) {
    if (!remaining.greaterThan(0)) break;
    take(roundTo(weight.times(planned).plus(ONE.minus(weight).times(pace)), PCT_SCALE));
  }

  // 3. Replanned curve over and the work not finished: it keeps its recent pace (or its overall
  //    average since the start, if larger — a stalled work still converges) until 100%.
  const overall = roundTo(done.div(realizedMonths), PCT_SCALE);
  const extensionPace = Decimal.max(pace, overall);
  let extensionMonths = 0;
  while (remaining.greaterThan(0) && monthly.length < MAX_CURVE_POINTS) {
    take(extensionPace);
    extensionMonths += 1;
  }
  if (remaining.greaterThan(0)) {
    const lastIndex = monthly.length - 1;
    monthly[lastIndex] = (monthly[lastIndex] ?? ZERO).plus(remaining);
    issues.push(
      issue(
        'TREND_TOO_LONG',
        `A tendência passaria de ${MAX_CURVE_POINTS} meses; o saldo foi concentrado no último mês.`,
        {},
        'WARNING',
      ),
    );
  }

  // Trailing months without progress (e.g. realized ≥ 100% before the window) are dropped.
  while (monthly.length > 1 && monthly.at(-1)?.isZero()) monthly.pop();

  return {
    startMonth: start,
    points: normalizeCurveWeights(monthly.map((v) => v.toString())),
    info: {
      lastRealizedMonth: last,
      realizedCumulative: toFixedString(done, PCT_SCALE),
      averagePace: toFixedString(pace, PCT_SCALE),
      windowMonths: windowLength,
      planWeight: toFixedString(weight, 2),
      extensionMonths,
    },
    issues,
  };
}

/** Short deterministic fingerprint of a curve in force (detects when a projection is outdated). */
export function curveFingerprint(startMonth: IsoMonth, points: readonly CurvePointInput[]): string {
  let hash = 0x811c9dc5; // FNV-1a 32 bits
  const text = `${startMonth}|${points.map((p) => String(p.monthlyPct)).join(',')}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${points.length}-${hash.toString(16).padStart(8, '0')}`;
}
