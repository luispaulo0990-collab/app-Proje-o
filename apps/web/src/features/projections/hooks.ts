import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectionsApi } from '@/services/api/endpoints';

export const projectionKeys = {
  detail: (workId: string, ref?: string) => ['projections', workId, ref ?? 'today'] as const,
};

export const useProjection = (workId: string, referenceDate?: string) =>
  useQuery({
    queryKey: projectionKeys.detail(workId, referenceDate),
    queryFn: () => projectionsApi.get(workId, referenceDate),
  });

export function useRecalculate(workId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mode: 'PRESERVE_MANUAL' | 'REPLACE_MANUAL'; dryRun?: boolean }) =>
      projectionsApi.calculate(workId, body),
    onSuccess: (_d, vars) => {
      if (!vars.dryRun) {
        void qc.invalidateQueries({ queryKey: ['projections', workId] });
        void qc.invalidateQueries({ queryKey: ['works', 'audit', workId] });
      }
    },
  });
}
