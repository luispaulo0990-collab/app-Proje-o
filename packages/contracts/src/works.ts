import { z } from 'zod';
import {
  fractionString,
  isoDate,
  moneyString,
  paginated,
  paginationQuery,
  uuid,
} from './common.js';

export const workStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const workBody = z.object({
  name: z.string().trim().min(2, 'Informe o nome da obra.').max(160),
  clientName: z.string().trim().min(2, 'Informe o cliente.').max(160),
  units: z
    .number()
    .int('Informe um número inteiro.')
    .positive('A quantidade de unidades deve ser maior que zero.'),
  budget: moneyString,
  feeRate: fractionString.refine((v) => Number(v) <= 1, 'A taxa deve ser no máximo 100%.'),
  feeLagMonths: z.number().int().min(0).max(36).default(0),
  constructionSystem: z.string().trim().min(2, 'Informe o sistema construtivo.').max(120),
  curveVersionId: uuid,
  startDate: isoDate,
  durationMonths: z.number().int().min(1, 'A duração deve ser maior que zero.').max(600),
  status: workStatusSchema.default('ACTIVE'),
});
export type WorkBody = z.infer<typeof workBody>;
export type WorkBodyInput = z.input<typeof workBody>;

export const workDto = z.object({
  id: uuid,
  name: z.string(),
  client: z.object({ id: uuid, name: z.string() }),
  units: z.number().int(),
  budget: z.string(),
  feeRate: z.string(),
  feeLagMonths: z.number().int(),
  feeTotal: z.string(),
  constructionSystem: z.string(),
  curve: z.object({ id: uuid, name: z.string(), versionId: uuid, version: z.number().int() }),
  startDate: z.string(),
  durationMonths: z.number().int(),
  /** Derived by the engine, never stored. */
  endDate: z.string(),
  periods: z.number().int(),
  status: workStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkDto = z.infer<typeof workDto>;

export const workListQuery = paginationQuery.extend({
  status: workStatusSchema.optional(),
  clientId: uuid.optional(),
  q: z.string().trim().max(160).optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type WorkListQuery = z.infer<typeof workListQuery>;

export const workListResponse = paginated(workDto);

export const clientDto = z.object({ id: uuid, name: z.string() });
export const clientListResponse = z.object({ items: z.array(clientDto) });
