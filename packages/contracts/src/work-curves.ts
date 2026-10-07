import { z } from 'zod';
import { decimalString, fractionString, isoDate, uuid, validationIssue } from './common.js';
import { workStatusSchema } from './works.js';

export const curveSourceSchema = z.enum(['PARAMETRIC', 'WORK_ACTUAL']);
export type CurveSource = z.infer<typeof curveSourceSchema>;

export const workCurveStatusSchema = z.enum([
  'NOT_STARTED',
  'STARTED_ACTUAL',
  'STARTED_AWAITING_ACTUAL',
]);
export type WorkCurveStatus = z.infer<typeof workCurveStatusSchema>;

const isoMonth = z
  .string()
  .regex(/^\d{4}-\d{2}(-01)?$/, 'Mês inválido (AAAA-MM ou AAAA-MM-01).')
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

/**
 * Own curve of a work, pushed by an external system (ERP / planning) or typed by an editor.
 * Send EITHER `points` (period 1..n from `startMonth`) OR `months` (month-keyed values).
 * Percentages are fractions: 0.035 = 3,5%.
 */
export const actualCurveBody = z
  .object({
    /** Identifier of the sending system, e.g. "SIENGE", "PLANEJAMENTO", "MANUAL". */
    source: z.string().trim().min(2).max(60),
    externalRef: z.string().trim().max(160).optional(),
    /** Month of period 1. Defaults to the work's planned start month. */
    startMonth: isoMonth.optional(),
    points: z
      .array(z.object({ period: z.number().int().min(1), monthlyPct: fractionString }))
      .min(1)
      .max(600)
      .optional(),
    months: z
      .array(z.object({ month: isoMonth, monthlyPct: fractionString }))
      .min(1)
      .max(600)
      .optional(),
    /** Rescales the values so they sum exactly to 100% (for sources with rounding noise). */
    normalize: z.boolean().default(false),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => Boolean(b.points) !== Boolean(b.months), {
    message: 'Informe "points" ou "months" (apenas um deles).',
    path: ['points'],
  });
export type ActualCurveBody = z.input<typeof actualCurveBody>;

export const actualCurvePointDto = z.object({
  period: z.number().int(),
  month: z.string(),
  label: z.string(),
  monthlyPct: z.string(),
  cumulativePct: z.string(),
});

export const actualCurveDto = z.object({
  id: uuid,
  workId: uuid,
  version: z.number().int(),
  startMonth: z.string(),
  periods: z.number().int(),
  source: z.string(),
  externalRef: z.string().nullable(),
  note: z.string().nullable(),
  receivedVia: z.enum(['USER', 'API_KEY']),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  points: z.array(actualCurvePointDto),
});
export type ActualCurveDto = z.infer<typeof actualCurveDto>;

export const actualCurveVersionDto = actualCurveDto.omit({ points: true });

export const actualCurveStateDto = z.object({
  current: actualCurveDto.nullable(),
  versions: z.array(actualCurveVersionDto),
  effective: z.object({
    source: curveSourceSchema,
    status: workCurveStatusSchema,
    referenceMonth: z.string(),
  }),
});
export type ActualCurveStateDto = z.infer<typeof actualCurveStateDto>;

export const importActualCurveResponse = z.object({
  actualCurve: actualCurveDto,
  /** What happened to the projection after the import. */
  projection: z.object({
    outcome: z.enum(['RECALCULATED', 'MARKED_STALE', 'NOT_IN_FORCE']),
    version: z.number().int().nullable(),
  }),
  issues: z.array(validationIssue),
});
export type ImportActualCurveResponse = z.infer<typeof importActualCurveResponse>;

export const referenceQuery = z.object({ referenceDate: isoDate.optional() });

export const workCurvesQuery = referenceQuery.extend({
  includeArchived: z.coerce.boolean().default(false),
  q: z.string().trim().max(160).optional(),
});
export type WorkCurvesQuery = z.infer<typeof workCurvesQuery>;

/** How the curve of a started work was built from realized progress + trend (or null). */
export const trendInfoDto = z.object({
  /** Last month from "Realizado Acumulado"; the following months are the trend. */
  lastRealizedMonth: z.string(),
  realizedCumulative: z.string(),
  /** Average realized monthly progress over the window. */
  averagePace: z.string(),
  windowMonths: z.number().int(),
  /** Weight of the replanned curve in each trend month (rest = realized pace). */
  planWeight: z.string(),
  /** Last trend month = end of the replanned curve (the planned deadline is kept). */
  endMonth: z.string(),
});
export type TrendInfoDto = z.infer<typeof trendInfoDto>;

export const workCurveItemDto = z.object({
  workId: uuid,
  name: z.string(),
  clientName: z.string(),
  status: workStatusSchema,
  plannedStartDate: z.string(),
  contractDurationMonths: z.number().int(),
  curveStatus: workCurveStatusSchema,
  source: curveSourceSchema,
  /** Effective schedule (own curve may start/finish on other months). */
  startDate: z.string(),
  durationMonths: z.number().int(),
  endDate: z.string(),
  parametric: z.object({ curveId: uuid, name: z.string(), version: z.number().int() }),
  actual: actualCurveVersionDto.nullable(),
  trend: trendInfoDto.nullable(),
  physicalAccumulated: decimalString,
  cells: z.array(
    z.object({ month: z.string(), label: z.string(), monthly: z.string(), cumulative: z.string() }),
  ),
  /** Current projection was generated with another curve than the one in force today. */
  needsRecalc: z.boolean(),
  issues: z.array(validationIssue),
});
export type WorkCurveItemDto = z.infer<typeof workCurveItemDto>;

export const workCurvesResponse = z.object({
  referenceMonth: z.string(),
  months: z.array(z.object({ month: z.string(), label: z.string() })),
  items: z.array(workCurveItemDto),
  counts: z.object({
    NOT_STARTED: z.number().int(),
    STARTED_ACTUAL: z.number().int(),
    STARTED_AWAITING_ACTUAL: z.number().int(),
    needsRecalc: z.number().int(),
  }),
});
export type WorkCurvesResponse = z.infer<typeof workCurvesResponse>;

export const syncWorkCurvesResponse = z.object({
  recalculated: z.number().int(),
  markedStale: z.number().int(),
  unchanged: z.number().int(),
});
export type SyncWorkCurvesResponse = z.infer<typeof syncWorkCurvesResponse>;
