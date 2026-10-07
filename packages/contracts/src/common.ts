import { z } from 'zod';

/** Decimal numbers travel as strings ("1234.56") to avoid floating point loss. */
export const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Número decimal inválido (use ponto como separador).');

export const moneyString = decimalString
  .refine((v) => !v.startsWith('-'), 'O valor não pode ser negativo.')
  .refine((v) => (v.split('.')[1]?.length ?? 0) <= 2, 'Use no máximo 2 casas decimais.');

/** Fraction: 0.10 = 10%. Up to 8 decimals ≡ percentage with 6 decimals. */
export const fractionString = decimalString
  .refine((v) => !v.startsWith('-'), 'O percentual não pode ser negativo.')
  .refine((v) => (v.split('.')[1]?.length ?? 0) <= 12, 'Precisão máxima excedida.');

/**
 * How often the fee balance is corrected by the INCC: every month, quarter, four months,
 * semester or year (the INCC accumulated over the period is applied at once).
 */
export const inccPeriodicitySchema = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'FOUR_MONTHLY',
  'SEMIANNUAL',
  'ANNUAL',
]);
export type InccPeriodicity = z.infer<typeof inccPeriodicitySchema>;

/** Competence month in the URL or body: `AAAA-MM` or `AAAA-MM-01` → `AAAA-MM-01`. */
export const isoMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, 'Mês inválido (AAAA-MM ou AAAA-MM-01).')
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

/** Fee rate as a fraction between 0 and 1 (0.08 = 8%). Shared by the work and its fee terms. */
export const feeRateString = fractionString.refine(
  (v) => Number(v) <= 1,
  'A taxa deve ser no máximo 100%.',
);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');

export const uuid = z.uuid();

export const roleSchema = z.enum(['ADMIN', 'EDITOR', 'VIEWER']);
export type Role = z.infer<typeof roleSchema>;

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

export const idParams = z.object({ id: uuid });

export const validationIssue = z.object({
  code: z.string(),
  severity: z.enum(['ERROR', 'WARNING']),
  message: z.string(),
  context: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
