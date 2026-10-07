import type { FeeTermDto, FeeTermListResponse, InccPeriodicity } from '@unita/contracts';

/** Options of the INCC correction, in the order shown in the selects. */
export const INCC_PERIODICITY: Record<InccPeriodicity, { label: string; hint: string }> = {
  MONTHLY: { label: 'Mensal', hint: 'Todo mês, pelo INCC do mês anterior.' },
  QUARTERLY: { label: 'Trimestral', hint: 'A cada 3 meses, pela variação do trimestre.' },
  FOUR_MONTHLY: {
    label: 'Quadrimestral',
    hint: 'A cada 4 meses, pela variação do quadrimestre.',
  },
  SEMIANNUAL: { label: 'Semestral', hint: 'A cada 6 meses, pela variação do semestre.' },
  ANNUAL: { label: 'Anual', hint: 'Uma vez por ano, pela variação dos 12 meses.' },
};

export const INCC_PERIODICITY_OPTIONS = Object.entries(INCC_PERIODICITY) as [
  InccPeriodicity,
  { label: string; hint: string },
][];

/** Conditions in force in a month (`AAAA-MM-01`): last term ≤ month, else the registration. */
export function conditionsAt(
  data: FeeTermListResponse,
  month: string,
): { feeRate: string; inccPeriodicity: InccPeriodicity; term: FeeTermDto | null } {
  const term = data.items.filter((t) => t.month <= month).at(-1) ?? null;
  return term
    ? { feeRate: term.feeRate, inccPeriodicity: term.inccPeriodicity, term }
    : { feeRate: data.base.feeRate, inccPeriodicity: data.base.inccPeriodicity, term: null };
}
