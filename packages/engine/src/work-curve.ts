import { allocateLargestRemainder } from './allocation.js';
import { assertValidCurve, canonicalizeCurve, resampleCurve } from './curve.js';
import { ONE, PCT_SCALE, ZERO, toFixedString } from './decimal.js';
import { issue } from './errors.js';
import {
  buildTrendCurve,
  curveFingerprint,
  type RealizedEntry,
  type TrendInfo,
} from './trend-curve.js';
import {
  addMonths,
  buildSchedule,
  monthDiff,
  parseIsoDate,
  parseIsoMonth,
  toIsoMonth,
} from './schedule.js';
import type {
  CurvePoint,
  CurvePointInput,
  DecimalString,
  IsoDate,
  IsoMonth,
  ValidationIssue,
} from './types.js';

/** Where the physical curve applied to a work comes from. */
export type CurveSource = 'PARAMETRIC' | 'WORK_ACTUAL';

/**
 * - `NOT_STARTED`: start month is after the reference month → parametric curve.
 * - `STARTED_ACTUAL`: work started and has its own curve (received via API) → own curve.
 * - `STARTED_AWAITING_ACTUAL`: work started but no own curve yet → parametric (fallback).
 */
export type WorkCurveStatus = 'NOT_STARTED' | 'STARTED_ACTUAL' | 'STARTED_AWAITING_ACTUAL';

export interface ActualCurveInput {
  /** Competence month of the first point (`YYYY-MM-01`). Real start may differ from planned. */
  startMonth: IsoMonth;
  points: readonly CurvePointInput[];
}

export interface EffectiveCurveInput {
  /** Planned start date of the work. */
  startDate: IsoDate;
  /** Contract duration (months) — used with the parametric curve. */
  durationMonths: number;
  referenceMonth: IsoMonth;
  parametric: readonly CurvePointInput[];
  actual?: ActualCurveInput | null;
  /** "Realizado Acumulado" by month: with an own curve, it turns into a trend curve. */
  realized?: readonly RealizedEntry[];
}

export interface EffectiveCurve {
  source: CurveSource;
  status: WorkCurveStatus;
  hasStarted: boolean;
  /** Start date to feed the ProjectionEngine (actual start month when the own curve is used). */
  startDate: IsoDate;
  /** Months of the effective schedule (own curve length or contract duration). */
  durationMonths: number;
  curve: CurvePoint[];
  /** Set when the curve is realized + trend (see buildTrendCurve); null = curve as received. */
  trend: TrendInfo | null;
  /** Identifies start + points: a projection with another fingerprint is outdated. */
  fingerprint: string;
  issues: ValidationIssue[];
}

/** Adds the fingerprint, computed from what the projection will actually use. */
function withFingerprint(curve: Omit<EffectiveCurve, 'fingerprint'>): EffectiveCurve {
  return { ...curve, fingerprint: curveFingerprint(curve.startDate.slice(0, 7), curve.curve) };
}

/** A work has started when its start month is on or before the reference month. */
export function hasWorkStarted(startDate: IsoDate, referenceMonth: IsoMonth): boolean {
  const { year, month } = parseIsoDate(startDate);
  return monthDiff({ year, month }, parseIsoMonth(referenceMonth)) >= 0;
}

/**
 * Decides which physical curve governs a work (single rule used by projection, consolidated
 * panel and the "Curvas das obras" grid):
 *
 * 1. Not started at the reference month → parametric curve (even if an own curve exists).
 * 2. Started with own curve → own curve, from its own start month, with its own length. When
 *    the "Realizado Acumulado" is known, the curve is the realized progress up to the current
 *    month followed by a trend built from the realized pace and the replanned curve
 *    (buildTrendCurve) — rule defined 07/10/2026.
 * 3. Started without own curve → parametric curve + warning `ACTUAL_CURVE_MISSING`.
 */
export function resolveEffectiveCurve(input: EffectiveCurveInput): EffectiveCurve {
  const hasStarted = hasWorkStarted(input.startDate, input.referenceMonth);
  const issues: ValidationIssue[] = [];

  if (hasStarted && input.actual) {
    assertValidCurve(input.actual.points);
    const startMonth = toIsoMonth(parseIsoMonth(input.actual.startMonth));
    const trend = buildTrendCurve({
      referenceMonth: input.referenceMonth,
      replanned: { startMonth, points: input.actual.points },
      realized: input.realized ?? [],
    });
    return withFingerprint({
      source: 'WORK_ACTUAL',
      status: 'STARTED_ACTUAL',
      hasStarted,
      startDate: trend?.startMonth ?? startMonth,
      durationMonths: trend?.points.length ?? input.actual.points.length,
      curve: trend?.points ?? canonicalizeCurve(input.actual.points),
      trend: trend?.info ?? null,
      issues: [...issues, ...(trend?.issues ?? [])],
    });
  }

  if (hasStarted) {
    issues.push(
      issue(
        'ACTUAL_CURVE_MISSING',
        'Obra iniciada sem curva própria recebida via API: usando a curva paramétrica.',
        { referenceMonth: input.referenceMonth },
        'WARNING',
      ),
    );
  } else if (input.actual) {
    issues.push(
      issue(
        'ACTUAL_CURVE_NOT_IN_FORCE',
        'Curva própria recebida, mas a obra ainda não iniciou: vale a curva paramétrica.',
        { referenceMonth: input.referenceMonth },
        'WARNING',
      ),
    );
  }
  return withFingerprint({
    source: 'PARAMETRIC',
    status: hasStarted ? 'STARTED_AWAITING_ACTUAL' : 'NOT_STARTED',
    hasStarted,
    startDate: input.startDate,
    durationMonths: input.durationMonths,
    curve: canonicalizeCurve(input.parametric),
    trend: null,
    issues,
  });
}

export interface CurveSeriesCell {
  periodIndex: number;
  month: IsoMonth;
  label: string;
  monthly: DecimalString;
  cumulative: DecimalString;
}

/**
 * Monthly physical series of a curve applied to a schedule — exactly the `original` values the
 * ProjectionEngine produces (resampling + largest remainder), so both views always agree.
 */
export function buildCurveSeries(
  startDate: IsoDate,
  durationMonths: number,
  curve: readonly CurvePointInput[],
): CurveSeriesCell[] {
  const schedule = buildSchedule(startDate, durationMonths);
  assertValidCurve(curve);
  const values = allocateLargestRemainder(resampleCurve(curve, durationMonths), ONE, PCT_SCALE);
  let running = ZERO;
  return schedule.periods.map((p, i) => {
    const value = values[i] ?? ZERO;
    running = running.plus(value);
    return {
      periodIndex: p.index,
      month: p.month,
      label: p.label,
      monthly: toFixedString(value, PCT_SCALE),
      cumulative: toFixedString(running, PCT_SCALE),
    };
  });
}

/**
 * Converts month-keyed values (as external systems usually send them) into contiguous
 * 1-based points. Months must be unique and contiguous; returns the first month too.
 */
export function pointsFromMonths(
  entries: readonly { month: IsoMonth; monthlyPct: DecimalString | number }[],
): { startMonth: IsoMonth; points: CurvePointInput[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (entries.length === 0) {
    issues.push(issue('CURVE_EMPTY', 'Informe ao menos um mês.'));
    return { startMonth: '', points: [], issues };
  }
  const sorted = [...entries]
    .map((e) => ({ ym: parseIsoMonth(e.month), monthlyPct: e.monthlyPct }))
    .sort((a, b) => monthDiff(b.ym, a.ym));
  const first = sorted[0]?.ym ?? { year: 0, month: 1 };
  const points: CurvePointInput[] = [];
  sorted.forEach((e, i) => {
    const offset = monthDiff(first, e.ym);
    if (offset !== i) {
      issues.push(
        issue(
          offset < i ? 'CURVE_MONTH_DUPLICATED' : 'CURVE_MONTH_GAP',
          offset < i
            ? `Mês repetido: ${toIsoMonth(e.ym)}.`
            : `Meses não contíguos: falta ${toIsoMonth(addMonths(first, i))}.`,
          { month: toIsoMonth(e.ym) },
        ),
      );
    }
    points.push({ period: i + 1, monthlyPct: e.monthlyPct });
  });
  return { startMonth: toIsoMonth(first), points, issues };
}

/** 1-based position of `month` in a schedule starting at `startDate` (≤ 0 when before it). */
export function monthIndexIn(startDate: IsoDate, month: IsoMonth): number {
  const { year, month: m } = parseIsoDate(startDate);
  return monthDiff({ year, month: m }, parseIsoMonth(month)) + 1;
}
