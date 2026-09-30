import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeeRecalibrationBody } from '@unita/contracts';
import { portfolioApi, type PortfolioFilters } from '@/services/api/endpoints';

export const portfolioKeys = {
  consolidated: (f: PortfolioFilters) => ['portfolio', 'consolidated', f] as const,
};

export const useConsolidated = (filters: PortfolioFilters) =>
  useQuery({
    queryKey: portfolioKeys.consolidated(filters),
    queryFn: () => portfolioApi.consolidated(filters),
    placeholderData: keepPreviousData,
  });

/** A recalibration creates a new projection version: every derived view is refreshed. */
function useInvalidatePortfolio() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['portfolio', 'projections', 'works', 'work-curves'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useSetFeeRecalibration() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ workId, body }: { workId: string; body: FeeRecalibrationBody }) =>
      portfolioApi.setFeeRecalibration(workId, body),
    onSuccess: invalidate,
  });
}

export function useClearFeeRecalibration() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (workId: string) => portfolioApi.clearFeeRecalibration(workId),
    onSuccess: invalidate,
  });
}
