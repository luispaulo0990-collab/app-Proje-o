import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeeIssuanceBody, InccIndexBody } from '@unita/contracts';
import {
  feesApi,
  portfolioApi,
  projectionsApi,
  type PortfolioFilters,
} from '@/services/api/endpoints';

export const portfolioKeys = {
  consolidated: (f: PortfolioFilters) => ['portfolio', 'consolidated', f] as const,
  incc: ['incc-indices'] as const,
};

export const useConsolidated = (filters: PortfolioFilters) =>
  useQuery({
    queryKey: portfolioKeys.consolidated(filters),
    queryFn: () => portfolioApi.consolidated(filters),
    placeholderData: keepPreviousData,
  });

export const useInccIndices = () =>
  useQuery({ queryKey: portfolioKeys.incc, queryFn: feesApi.listIncc });

/**
 * Fee inputs (issuances, INCC, fee terms) create new projection versions: every derived view is
 * refreshed. Shared with the fee terms page.
 */
export function useInvalidateFees() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['portfolio', 'projections', 'works', 'work-curves', 'incc-indices', 'fee-terms'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useSetFeeIssuance() {
  const onSuccess = useInvalidateFees();
  return useMutation({
    mutationFn: ({
      workId,
      month,
      body,
    }: {
      workId: string;
      month: string;
      body: FeeIssuanceBody;
    }) => feesApi.setIssuance(workId, month, body),
    onSuccess,
  });
}

export function useDeleteFeeIssuance() {
  const onSuccess = useInvalidateFees();
  return useMutation({
    mutationFn: ({ workId, month }: { workId: string; month: string }) =>
      feesApi.deleteIssuance(workId, month),
    onSuccess,
  });
}

export function useSetIncc() {
  const onSuccess = useInvalidateFees();
  return useMutation({
    mutationFn: ({ month, body }: { month: string; body: InccIndexBody }) =>
      feesApi.setIncc(month, body),
    onSuccess,
  });
}

export function useDeleteIncc() {
  const onSuccess = useInvalidateFees();
  return useMutation({ mutationFn: feesApi.deleteIncc, onSuccess });
}

/**
 * Manual fee projection typed in the Consolidado (`value: null` = back to the curve). The engine
 * keeps every manual month and recalculates the others; all views are refreshed.
 */
export function useSetFeeProjection() {
  const onSuccess = useInvalidateFees();
  return useMutation({
    mutationFn: ({
      workId,
      periodIndex,
      value,
    }: {
      workId: string;
      periodIndex: number;
      value: string | null;
    }) =>
      projectionsApi.update(workId, {
        changes: [{ series: 'FEE', periodIndex, value }],
        note: 'Projeção de taxa no Consolidado',
      }),
    onSuccess,
  });
}
