import { z } from 'zod';
import { fractionString, paginated, uuid, validationIssue } from './common.js';

export const curveTypeSchema = z.enum(['PHYSICAL']);
export const curveStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);

export const curvePointInput = z.object({
  period: z.number().int().min(1),
  monthlyPct: fractionString,
});
export type CurvePointInputDto = z.infer<typeof curvePointInput>;

export const curvePointDto = z.object({
  period: z.number().int(),
  monthlyPct: z.string(),
  cumulativePct: z.string(),
});
export type CurvePointDto = z.infer<typeof curvePointDto>;

const points = z.array(curvePointInput).min(1, 'Informe os pontos da curva.').max(600);

export const createCurveBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().default(''),
  type: curveTypeSchema.default('PHYSICAL'),
  points,
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCurveBody = z.infer<typeof createCurveBody>;

/** Metadata changes update the curve; `points` always create a new immutable version. */
export const updateCurveBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    status: curveStatusSchema.optional(),
    points: points.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nada para atualizar.');
export type UpdateCurveBody = z.infer<typeof updateCurveBody>;

export const validateCurveBody = z.object({ points: z.array(curvePointInput).max(600) });

export const validateCurveResponse = z.object({
  valid: z.boolean(),
  issues: z.array(validationIssue),
  canonical: z.array(curvePointDto).nullable(),
});

export const curveVersionDto = z.object({
  id: uuid,
  version: z.number().int(),
  periods: z.number().int(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  points: z.array(curvePointDto),
  usedByWorks: z.number().int(),
});
export type CurveVersionDto = z.infer<typeof curveVersionDto>;

export const curveSummaryDto = z.object({
  id: uuid,
  name: z.string(),
  description: z.string(),
  type: curveTypeSchema,
  status: curveStatusSchema,
  latestVersion: z.number().int(),
  latestVersionId: uuid,
  periods: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CurveSummaryDto = z.infer<typeof curveSummaryDto>;

export const curveDetailDto = curveSummaryDto.extend({
  current: curveVersionDto,
  versions: z.array(
    z.object({
      id: uuid,
      version: z.number().int(),
      createdAt: z.string(),
      periods: z.number().int(),
    }),
  ),
});
export type CurveDetailDto = z.infer<typeof curveDetailDto>;

export const curveListResponse = paginated(curveSummaryDto);
export const curveListQuery = z.object({
  status: curveStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
