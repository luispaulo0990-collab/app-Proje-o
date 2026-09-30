import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkBodyInput, WorkDto } from '@unita/contracts';
import { worksApi, type WorkFilters } from '@/services/api/endpoints';

export const workKeys = {
  all: ['works'] as const,
  list: (f: WorkFilters) => ['works', 'list', f] as const,
  detail: (id: string) => ['works', 'detail', id] as const,
  audit: (id: string, page: number) => ['works', 'audit', id, page] as const,
  clients: ['clients'] as const,
};

export const useWorks = (filters: WorkFilters) =>
  useQuery({
    queryKey: workKeys.list(filters),
    queryFn: () => worksApi.list(filters),
    placeholderData: keepPreviousData,
  });

export const useWork = (id: string | undefined) =>
  useQuery({
    queryKey: workKeys.detail(id ?? ''),
    queryFn: () => worksApi.get(id ?? ''),
    enabled: Boolean(id),
  });

export const useWorkAudit = (id: string, page: number) =>
  useQuery({
    queryKey: workKeys.audit(id, page),
    queryFn: () => worksApi.audit(id, page),
    placeholderData: keepPreviousData,
  });

export const useClients = () =>
  useQuery({ queryKey: workKeys.clients, queryFn: worksApi.clients, staleTime: 60_000 });

function useInvalidateWorks() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: workKeys.all }),
      qc.invalidateQueries({ queryKey: ['projections'] }),
    ]);
}

export function useSaveWork(id?: string) {
  const invalidate = useInvalidateWorks();
  return useMutation({
    mutationFn: (body: WorkBodyInput) => (id ? worksApi.update(id, body) : worksApi.create(body)),
    onSuccess: invalidate,
  });
}

export function useWorkAction() {
  const invalidate = useInvalidateWorks();
  return useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: 'duplicate' | 'archive' | 'remove';
    }): Promise<WorkDto | null> =>
      action === 'remove' ? worksApi.remove(id).then(() => null) : worksApi[action](id),
    onSuccess: invalidate,
  });
}
