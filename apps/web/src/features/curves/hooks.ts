import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCurveBody, UpdateCurveBody } from '@unita/contracts';
import { curvesApi } from '@/services/api/endpoints';

export const curveKeys = {
  all: ['curves'] as const,
  list: ['curves', 'list'] as const,
  detail: (id: string) => ['curves', 'detail', id] as const,
  version: (id: string, v: number) => ['curves', 'version', id, v] as const,
};

export const useCurves = () =>
  useQuery({ queryKey: curveKeys.list, queryFn: () => curvesApi.list(), staleTime: 30_000 });

export const useCurve = (id: string | undefined) =>
  useQuery({
    queryKey: curveKeys.detail(id ?? ''),
    queryFn: () => curvesApi.get(id ?? ''),
    enabled: Boolean(id),
  });

export const useCurveVersion = (id: string | undefined, version: number | undefined) =>
  useQuery({
    queryKey: curveKeys.version(id ?? '', version ?? 0),
    queryFn: () => curvesApi.version(id ?? '', version ?? 1),
    enabled: Boolean(id && version),
    staleTime: Infinity, // versions are immutable
  });

export function useSaveCurve(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCurveBody | UpdateCurveBody) =>
      id
        ? curvesApi.update(id, body as UpdateCurveBody)
        : curvesApi.create(body as CreateCurveBody),
    onSuccess: () => qc.invalidateQueries({ queryKey: curveKeys.all }),
  });
}
