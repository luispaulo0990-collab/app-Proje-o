import { z } from 'zod';
import { decimalString, moneyString } from './common.js';

/** Competence month in the URL or body: `AAAA-MM` or `AAAA-MM-01` → `AAAA-MM-01`. */
export const isoMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, 'Mês inválido (AAAA-MM ou AAAA-MM-01).')
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

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

/** Issuance/INCC summary of the current projection (see CALCULATION_RULES §15). */
export const feeAdjustmentDto = z.object({
  firstIssuedMonth: z.string(),
  lastIssuedMonth: z.string(),
  issuedTotal: z.string(),
  inccCorrection: z.string(),
  balanceAfterIssued: z.string(),
  expectedFee: z.string(),
});
export type FeeAdjustmentDto = z.infer<typeof feeAdjustmentDto>;
