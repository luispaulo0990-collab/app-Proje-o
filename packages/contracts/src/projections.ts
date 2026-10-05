import { z } from 'zod';
import { decimalString, isoDate, uuid, validationIssue } from './common.js';

export const seriesSchema = z.enum(['PHYSICAL', 'FEE']);
/** CURVE = engine · MANUAL = typed in the grid · ISSUED = fee invoiced in the month. */
export const cellOriginSchema = z.enum(['CURVE', 'MANUAL', 'ISSUED']);
export const recalcModeSchema = z.enum(['PRESERVE_MANUAL', 'REPLACE_MANUAL']);

export const projectionCellDto = z.object({
  periodIndex: z.number().int(),
  month: z.string(),
  label: z.string(),
  original: z.string(),
  current: z.string(),
  origin: cellOriginSchema,
  cumulative: z.string(),
});
export type ProjectionCellDto = z.infer<typeof projectionCellDto>;

export const kpisDto = z.object({
  referenceMonth: z.string(),
  feeProjected: z.string(),
  feeRealized: z.string(),
  feeRemaining: z.string(),
  physicalProjected: z.string(),
  physicalAccumulated: z.string(),
  /**
   * "Realizado Acumulado" (BD_Infos Gerais) of the latest closing ≤ reference month — the
   * measured physical progress. null when the work has no realized data yet.
   */
  physicalRealized: z.string().nullable().optional(),
  /** Closing month of `physicalRealized` (YYYY-MM-01). */
  physicalRealizedMonth: z.string().nullable().optional(),
  durationMonths: z.number().int(),
  elapsedMonths: z.number().int(),
  endDate: z.string(),
});
export type KpisDto = z.infer<typeof kpisDto>;

export const projectionDto = z.object({
  id: uuid,
  workId: uuid,
  version: z.number().int(),
  curveVersionId: uuid,
  /** PARAMETRIC (modelo) or WORK_ACTUAL (curva própria da obra recebida via API). */
  curveSource: z.enum(['PARAMETRIC', 'WORK_ACTUAL']),
  workActualCurveId: uuid.nullable(),
  /** Work parameters changed while manual cells exist: a recalculation is pending. */
  isStale: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  note: z.string().nullable(),
  physical: z.array(projectionCellDto),
  fee: z.array(projectionCellDto),
  totals: z.object({ physical: z.string(), fee: z.string(), expectedFee: z.string() }),
  manualCount: z.number().int(),
  kpis: kpisDto,
  validations: z.array(validationIssue),
});
export type ProjectionDto = z.infer<typeof projectionDto>;

export const workIdParams = z.object({ workId: uuid });

export const projectionQuery = z.object({ referenceDate: isoDate.optional() });

export const calculateBody = z.object({
  mode: recalcModeSchema.default('PRESERVE_MANUAL'),
  /** When true nothing is saved; the response reports the impact of recalculating. */
  dryRun: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});
export type CalculateBody = z.infer<typeof calculateBody>;

export const calculateImpactDto = z.object({
  dryRun: z.literal(true),
  manualCount: z.number().int(),
  manualCells: z.array(
    z.object({ series: seriesSchema, periodIndex: z.number().int(), value: z.string() }),
  ),
});

export const updateProjectionBody = z.object({
  changes: z
    .array(
      z.object({
        series: seriesSchema,
        periodIndex: z.number().int().min(1),
        /** `null` removes the manual adjustment (back to curve). */
        value: decimalString.nullable(),
      }),
    )
    .min(1)
    .max(2000),
  note: z.string().trim().max(500).optional(),
});
export type UpdateProjectionBody = z.infer<typeof updateProjectionBody>;

export const projectionVersionDto = z.object({
  id: uuid,
  version: z.number().int(),
  isCurrent: z.boolean(),
  curveVersionId: uuid,
  curveSource: z.enum(['PARAMETRIC', 'WORK_ACTUAL']),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  note: z.string().nullable(),
});

export const auditLogDto = z.object({
  id: uuid,
  createdAt: z.string(),
  user: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  field: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  origin: z.string().nullable(),
});
export type AuditLogDto = z.infer<typeof auditLogDto>;

export const auditListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const auditListResponse = z.object({
  items: z.array(auditLogDto),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
