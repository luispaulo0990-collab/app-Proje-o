import { z } from 'zod';
import { decimalString, fractionString, uuid } from './common.js';
import { feeAdjustmentDto, feeIssuanceDto, isoMonth } from './fees.js';
import { cellOriginSchema } from './projections.js';
import { curveSourceSchema, referenceQuery } from './work-curves.js';
import { workStatusSchema } from './works.js';

export const consolidatedQuery = referenceQuery.extend({
  includeArchived: z.coerce.boolean().default(false),
  q: z.string().trim().max(160).optional(),
});
export type ConsolidatedQuery = z.infer<typeof consolidatedQuery>;

const cell = z.object({ month: z.string(), value: z.string(), origin: cellOriginSchema });

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

/** Economic closing of the cost-control system at the reference month ("IEC Obra"). */
export const workEconomicDto = z.object({
  /** Closing month shown (latest ≤ reference); null = no closing received. */
  month: z.string().nullable(),
  /** "IEC Obra" (index, 6 decimals: "1.020000" = 102%). */
  iec: z.string().nullable(),
  /** "Resultado Projetado Obra" (R$; negative = loss). */
  projectedResult: z.string().nullable(),
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type WorkEconomicDto = z.infer<typeof workEconomicDto>;

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
  economic: workEconomicDto,
  /** "Taxa emitida" in the reference month (null = not informed yet). */
  feeIssuance: feeIssuanceDto.nullable(),
  /** Whether the reference month is inside the work's fee horizon (an issuance is accepted). */
  acceptsIssuance: z.boolean(),
  /** Issuance/INCC summary of the current projection; null = fee follows budget × rate. */
  feeAdjustment: feeAdjustmentDto.nullable(),
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
    /** Works with "taxa emitida" informed in the reference month. */
    issuedWorksAtReference: z.number().int(),
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

/**
 * Economic closings of a work pushed by the cost-control system (generic endpoint; the
 * SharePoint sync of "BD_Econômico" writes the same data). Full history, replaces what exists.
 */
export const economicIndicatorsBody = z.object({
  source: z.string().trim().min(2).max(60),
  externalRef: z.string().trim().max(160).optional(),
  months: z
    .array(
      z.object({
        month: isoMonth,
        /** "IEC Obra" (1.02 = 102%). */
        iec: fractionString.nullable().optional(),
        /** "Resultado Projetado Obra" in R$ (may be negative). */
        projectedResult: decimalString.nullable().optional(),
      }),
    )
    .max(600)
    .refine((m) => new Set(m.map((x) => x.month)).size === m.length, 'Mês repetido.'),
});
export type EconomicIndicatorsBody = z.input<typeof economicIndicatorsBody>;

export const economicIndicatorsDto = z.object({
  workId: uuid,
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
  months: z.array(
    z.object({
      month: z.string(),
      iec: z.string().nullable(),
      projectedResult: z.string().nullable(),
    }),
  ),
});
export type EconomicIndicatorsDto = z.infer<typeof economicIndicatorsDto>;
