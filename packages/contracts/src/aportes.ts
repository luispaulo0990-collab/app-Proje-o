import { z } from 'zod';

/**
 * "Aportes" screen — contributions made up to today, read from the SharePoint workbook
 * "BD´s_JOY_EVANS.xlsx":
 * - investors: table "Recebidas";
 * - Joy+ side: table "Transferências Bancarias", rows with Empresa_tb ≠ 73 and EmpresaCred_tb = 73.
 * Money travels as decimal strings; dates as `AAAA-MM-DD`.
 */

/** Paying company of a transfer: Empresa_tb 10 = Joy+, 1 = Unità, anything else = flagged. */
export const aporteCompany = z.enum(['JOY', 'UNITA', 'OTHER']);
export type AporteCompany = z.infer<typeof aporteCompany>;

export const aporteTransferDto = z.object({
  date: z.string(),
  document: z.string(),
  /** Raw Empresa_tb value, as in the sheet. */
  companyCode: z.string(),
  company: aporteCompany,
  value: z.string(),
  note: z.string(),
});
export type AporteTransferDto = z.infer<typeof aporteTransferDto>;

export const aporteReceiptDto = z.object({
  date: z.string(),
  receipt: z.string(),
  installment: z.string(),
  payer: z.string(),
  description: z.string(),
  value: z.string(),
});
export type AporteReceiptDto = z.infer<typeof aporteReceiptDto>;

export const aportesDto = z.object({
  /** Cut-off date (today, São Paulo): later rows are not counted. */
  asOf: z.string(),
  readAt: z.string(),
  totals: z.object({
    /** All transfers to company 73 (Joy+ side), whatever the paying company. */
    joy: z.string(),
    /** Breakdown of `joy` by paying company. */
    joyByCompany: z.object({ JOY: z.string(), UNITA: z.string(), OTHER: z.string() }),
    investors: z.string(),
    /** joy + investors. */
    total: z.string(),
  }),
  transfers: z.array(aporteTransferDto),
  receipts: z.array(aporteReceiptDto),
  /** Rows to check: unknown paying company, unreadable date or value. */
  issues: z.array(z.object({ source: z.string(), message: z.string() })),
});
export type AportesDto = z.infer<typeof aportesDto>;
