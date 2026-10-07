import { useMutation, useQuery } from '@tanstack/react-query';
import type { FeeTermBody } from '@unita/contracts';
import { useInvalidateFees } from '@/features/portfolio/hooks';
import { feesApi } from '@/services/api/endpoints';

export const useFeeTerms = (workId: string) =>
  useQuery({ queryKey: ['fee-terms', workId], queryFn: () => feesApi.listTerms(workId) });

export function useSetFeeTerm(workId: string) {
  const onSuccess = useInvalidateFees();
  return useMutation({
    mutationFn: ({ month, body }: { month: string; body: FeeTermBody }) =>
      feesApi.setTerm(workId, month, body),
    onSuccess,
  });
}

export function useDeleteFeeTerm(workId: string) {
  const onSuccess = useInvalidateFees();
  return useMutation({
    mutationFn: (month: string) => feesApi.deleteTerm(workId, month),
    onSuccess,
  });
}
