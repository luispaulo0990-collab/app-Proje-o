import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeeIssuanceBody, InccIndexBody } from '@unita/contracts';
import { feesApi, portfolioApi, type PortfolioFilters } from '@/services/api/endpoints';

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

/** Fee inputs create new projection versions: every derived view is refreshed. */
function useInvalidateFees() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['portfolio', 'projections', 'works', 'work-curves', 'incc-indices'].map((key) =>
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
