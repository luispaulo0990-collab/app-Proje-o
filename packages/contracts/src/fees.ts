import { z } from 'zod';
import {
  decimalString,
  feeRateString,
  inccPeriodicitySchema,
  isoMonth,
  moneyString,
} from './common.js';

export const monthParams = z.object({ month: isoMonth });

// ─── INCC (número-índice mensal, global) ───────────────────────────────────

/** INCC number-index of the month (e.g. "1296.889"): positive, up to 6 decimals. */
export const inccIndexString = decimalString
  .refine((v) => (v.split('.')[1]?.length ?? 0) <= 6, 'Use no máximo 6 casas decimais.')
  .refine((v) => Number(v) > 0, 'O índice deve ser maior que zero.');

export const inccIndexBody = z.object({
  index: inccIndexString,
  note: z.string().trim().max(500).optional(),
});
export type InccIndexBody = z.input<typeof inccIndexBody>;

/** Many months at once (history load / paste from Excel); existing months are overwritten. */
export const inccIndexBatchBody = z.object({
  items: z
    .array(z.object({ month: isoMonth, index: inccIndexString }))
    .min(1)
    .max(1200)
    .refine((m) => new Set(m.map((x) => x.month)).size === m.length, 'Mês repetido.'),
  note: z.string().trim().max(500).optional(),
});
export type InccIndexBatchBody = z.input<typeof inccIndexBatchBody>;

export const inccIndexDto = z.object({
  /** Month of the index; its variation corrects the fee to be received in the next month. */
  month: z.string(),
  index: z.string(),
  /** Variation vs. the previous month computed by the engine; null = previous month missing. */
  rate: z.string().nullable(),
  note: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
});
export type InccIndexDto = z.infer<typeof inccIndexDto>;

export const inccIndexListResponse = z.object({ items: z.array(inccIndexDto) });
export type InccIndexListResponse = z.infer<typeof inccIndexListResponse>;

export const inccIndexResponse = z.object({
  index: inccIndexDto.nullable(),
  /** Works whose projection was regenerated with the new INCC. */
  recalculatedWorks: z.number().int(),
});
export type InccIndexResponse = z.infer<typeof inccIndexResponse>;

export const inccIndexBatchResponse = z.object({
  saved: z.number().int(),
  recalculatedWorks: z.number().int(),
});
export type InccIndexBatchResponse = z.infer<typeof inccIndexBatchResponse>;

// ─── Taxa emitida (por obra e mês) ─────────────────────────────────────────

export const feeIssuanceBody = z.object({
  amount: moneyString,
  note: z.string().trim().max(500).optional(),
});
export type FeeIssuanceBody = z.input<typeof feeIssuanceBody>;

export const feeIssuanceDto = z.object({
  workId: z.string(),
  /** Month in which the fee was invoiced (refers to the progress of the previous month). */
  month: z.string(),
  amount: z.string(),
  note: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
});
export type FeeIssuanceDto = z.infer<typeof feeIssuanceDto>;

export const feeIssuanceListResponse = z.object({ items: z.array(feeIssuanceDto) });
export type FeeIssuanceListResponse = z.infer<typeof feeIssuanceListResponse>;

export const feeIssuanceResponse = z.object({
  issuance: feeIssuanceDto.nullable(),
  projectionVersion: z.number().int(),
});
export type FeeIssuanceResponse = z.infer<typeof feeIssuanceResponse>;

/** INCC/issuance summary of the current projection (see CALCULATION_RULES §15 and §20). */
export const feeAdjustmentDto = z.object({
  /** null = no issuance yet (only the INCC changed the fee). */
  firstIssuedMonth: z.string().nullable(),
  lastIssuedMonth: z.string().nullable(),
  issuedTotal: z.string(),
  inccCorrection: z.string(),
  balanceAfterIssued: z.string().nullable(),
  expectedFee: z.string(),
});
export type FeeAdjustmentDto = z.infer<typeof feeAdjustmentDto>;

// ─── Vigências da taxa (por obra, a partir de um mês) ──────────────────────

/** New conditions from the month in the URL on: the NEW rate (not the variation). */
export const feeTermBody = z.object({
  feeRate: feeRateString,
  inccPeriodicity: inccPeriodicitySchema,
  note: z.string().trim().max(500).optional(),
});
export type FeeTermBody = z.input<typeof feeTermBody>;

export const feeTermDto = z.object({
  workId: z.string(),
  /** First financial month (fee received) under these conditions. */
  month: z.string(),
  feeRate: z.string(),
  inccPeriodicity: inccPeriodicitySchema,
  note: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
});
export type FeeTermDto = z.infer<typeof feeTermDto>;

export const feeTermListResponse = z.object({
  /** Conditions of the work registration, valid until the first term. */
  base: z.object({
    feeRate: z.string(),
    inccPeriodicity: inccPeriodicitySchema,
    inccBaseMonth: z.string(),
  }),
  items: z.array(feeTermDto),
});
export type FeeTermListResponse = z.infer<typeof feeTermListResponse>;

export const feeTermResponse = z.object({
  term: feeTermDto.nullable(),
  projectionVersion: z.number().int(),
});
export type FeeTermResponse = z.infer<typeof feeTermResponse>;
