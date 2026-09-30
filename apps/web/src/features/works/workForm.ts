import { z } from 'zod';
import { workStatusSchema, type WorkBodyInput, type WorkDto } from '@unita/contracts';
import {
  decimalToInput,
  fractionToPercentInput,
  parseDecimalInput,
  percentInputToFraction,
} from '@/utils/format';

const intString = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, 'Informe um número inteiro.')
    .refine((v) => Number(v) >= min && Number(v) <= max, message);

/** Form-level schema: accepts Brazilian formatted strings, converted to the API contract on submit. */
export const workFormSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da obra.').max(160),
  clientName: z.string().trim().min(2, 'Informe o cliente.').max(160),
  units: intString(1, 1_000_000, 'A quantidade de unidades deve ser maior que zero.'),
  budget: z.string().refine((v) => {
    const d = parseDecimalInput(v);
    return d !== null && !d.startsWith('-') && (d.split('.')[1]?.length ?? 0) <= 2;
  }, 'Informe um valor em R$ válido (até 2 casas).'),
  feeRatePct: z.string().refine((v) => {
    const f = percentInputToFraction(v);
    return f !== null && !f.startsWith('-') && Number(f) <= 1;
  }, 'Informe um percentual entre 0 e 100.'),
  feeLagMonths: intString(0, 36, 'Entre 0 e 36 meses.'),
  constructionSystem: z.string().trim().min(2, 'Informe o sistema construtivo.').max(120),
  curveId: z.string().min(1, 'Selecione uma curva.'),
  curveVersionId: z.string().min(1, 'Selecione uma curva.'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de início.'),
  durationMonths: intString(1, 600, 'A duração deve estar entre 1 e 600 meses.'),
  status: workStatusSchema,
});
export type WorkFormValues = z.infer<typeof workFormSchema>;

export const CONSTRUCTION_SYSTEMS = [
  'Alvenaria Estrutural',
  'Concreto Armado',
  'Parede de Concreto',
  'Estrutura Metálica',
  'Misto',
];

export const emptyWorkForm: WorkFormValues = {
  name: '',
  clientName: '',
  units: '',
  budget: '',
  feeRatePct: '',
  feeLagMonths: '0',
  constructionSystem: '',
  curveId: '',
  curveVersionId: '',
  startDate: '',
  durationMonths: '',
  status: 'ACTIVE',
};

export function workToForm(w: WorkDto): WorkFormValues {
  return {
    name: w.name,
    clientName: w.client.name,
    units: String(w.units),
    budget: decimalToInput(w.budget),
    feeRatePct: fractionToPercentInput(w.feeRate),
    feeLagMonths: String(w.feeLagMonths),
    constructionSystem: w.constructionSystem,
    curveId: w.curve.id,
    curveVersionId: w.curve.versionId,
    startDate: w.startDate,
    durationMonths: String(w.durationMonths),
    status: w.status,
  };
}

export function formToBody(v: WorkFormValues): WorkBodyInput {
  return {
    name: v.name,
    clientName: v.clientName,
    units: Number(v.units),
    budget: parseDecimalInput(v.budget) ?? '',
    feeRate: percentInputToFraction(v.feeRatePct) ?? '',
    feeLagMonths: Number(v.feeLagMonths),
    constructionSystem: v.constructionSystem,
    curveVersionId: v.curveVersionId,
    startDate: v.startDate,
    durationMonths: Number(v.durationMonths),
    status: v.status,
  };
}
