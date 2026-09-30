import { z } from 'zod';
import { fractionString, moneyString, uuid } from './common.js';
import { cellOriginSchema } from './projections.js';
import { curveSourceSchema, referenceQuery } from './work-curves.js';
import { workStatusSchema } from './works.js';

export const consolidatedQuery = referenceQuery.extend({
  includeArchived: z.coerce.boolean().default(false),
  q: z.string().trim().max(160).optional(),
});
export type ConsolidatedQuery = z.infer<typeof consolidatedQuery>;

const cell = z.object({ month: z.string(), value: z.string(), origin: cellOriginSchema });

const isoMonth = z
  .string()
  .regex(/^\d{4}-\d{2}(-01)?$/, 'Mês inválido (AAAA-MM ou AAAA-MM-01).')
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

export const clientStatusSchema = z.enum(['OK', 'ATRASADA', 'SEM_DADOS']);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

/** Progress figures of the planning system at the reference month (see CALCULATION_RULES). */
export const workProgressDto = z.object({
  realizedMonth: z.string().nullable(),
  realizedCumulative: z.string().nullable(),
  realizedMonthly: z.string().nullable(),
  statusMonth: z.string().nullable(),
  clientReplannedCumulative: z.string().nullable(),
  targetCumulative: z.string().nullable(),
  deviation: z.string().nullable(),
  clientStatus: clientStatusSchema,
  /** Where the figures came from (e.g. "BD_FISICO_GERAL"); null = nothing received yet. */
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type WorkProgressDto = z.infer<typeof workProgressDto>;

export const feeRecalibrationDto = z.object({
  id: uuid,
  referenceMonth: z.string(),
  fromMonth: z.string(),
  remainingTotal: z.string(),
  previousRemaining: z.string(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  /** False when the current projection was generated before this recalibration. */
  applied: z.boolean(),
});
export type FeeRecalibrationDto = z.infer<typeof feeRecalibrationDto>;

export const consolidatedWorkDto = z.object({
  workId: uuid,
  name: z.string(),
  clientName: z.string(),
  status: workStatusSchema,
  budget: z.string(),
  units: z.number().int(),
  feeRate: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  /** "Início de obra": first month of the work's own curve (API); projection start otherwise. */
  startMonth: z.string(),
  startSource: z.enum(['API', 'PROJECTION']),
  /** "Término projetado": month in which the curve reaches 100%. */
  projectedEndMonth: z.string().nullable(),
  monthsIncurred: z.number().int(),
  curveMonths: z.number().int().nullable(),
  progress: workProgressDto,
  /** Fee months after the reference month — 0 = nothing left to recalibrate. */
  feeMonthsAfterReference: z.number().int(),
  feeRecalibration: feeRecalibrationDto.nullable(),
  curveSource: curveSourceSchema,
  projectionVersion: z.number().int(),
  isStale: z.boolean(),
  needsRecalc: z.boolean(),
  feeProjected: z.string(),
  feeRealized: z.string(),
  feeRemaining: z.string(),
  feeAtReference: z.string(),
  physicalAccumulated: z.string(),
  physical: z.array(cell),
  fee: z.array(cell),
});
export type ConsolidatedWorkDto = z.infer<typeof consolidatedWorkDto>;

export const consolidatedDto = z.object({
  referenceMonth: z.string(),
  months: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      feeTotal: z.string(),
      feeYearToDate: z.string(),
      activeWorks: z.number().int(),
      isReference: z.boolean(),
    }),
  ),
  years: z.array(z.object({ year: z.number().int(), feeTotal: z.string() })),
  totals: z.object({
    worksCount: z.number().int(),
    activeWorksAtReference: z.number().int(),
    feeProjected: z.string(),
    feeRealized: z.string(),
    feeRemaining: z.string(),
    feeAtReference: z.string(),
    feeYearToDateAtReference: z.string(),
    delayedWorks: z.number().int(),
    budgetTotal: z.string(),
    unitsTotal: z.number().int(),
    recalibratedWorks: z.number().int(),
  }),
  works: z.array(consolidatedWorkDto),
});
export type ConsolidatedDto = z.infer<typeof consolidatedDto>;

// ─── Inputs of the Consolidado ─────────────────────────────────────────────

/**
 * Progress figures of a work pushed by the planning system (generic endpoint; the SharePoint
 * sync writes the same data). The full history is sent every time and replaces what exists.
 */
export const progressIndicatorsBody = z.object({
  source: z.string().trim().min(2).max(60),
  externalRef: z.string().trim().max(160).optional(),
  months: z
    .array(
      z.object({
        month: isoMonth,
        realizedCumulative: fractionString.nullable().optional(),
        clientReplannedCumulative: fractionString.nullable().optional(),
        targetCumulative: fractionString.nullable().optional(),
      }),
    )
    .max(600)
    .refine((m) => new Set(m.map((x) => x.month)).size === m.length, 'Mês repetido.'),
});
export type ProgressIndicatorsBody = z.input<typeof progressIndicatorsBody>;

export const progressIndicatorsDto = z.object({
  workId: uuid,
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
  months: z.array(
    z.object({
      month: z.string(),
      realizedCumulative: z.string().nullable(),
      clientReplannedCumulative: z.string().nullable(),
      targetCumulative: z.string().nullable(),
    }),
  ),
});
export type ProgressIndicatorsDto = z.infer<typeof progressIndicatorsDto>;

/** "Ajuste projeção de taxa": new Σ fee still to be received after the reference month. */
export const feeRecalibrationBody = z.object({
  referenceMonth: isoMonth,
  remainingTotal: moneyString,
  note: z.string().trim().max(500).optional(),
});
export type FeeRecalibrationBody = z.input<typeof feeRecalibrationBody>;

export const feeRecalibrationResponse = z.object({
  recalibration: feeRecalibrationDto.nullable(),
  projectionVersion: z.number().int(),
});
export type FeeRecalibrationResponse = z.infer<typeof feeRecalibrationResponse>;
