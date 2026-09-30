import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActualCurveBody } from '@unita/contracts';
import { integrationsApi, workCurvesApi, type PortfolioFilters } from '@/services/api/endpoints';

export const workCurveKeys = {
  list: (f: PortfolioFilters) => ['work-curves', 'list', f] as const,
  actual: (workId: string) => ['work-curves', 'actual', workId] as const,
};

export const useWorkCurves = (filters: PortfolioFilters) =>
  useQuery({
    queryKey: workCurveKeys.list(filters),
    queryFn: () => workCurvesApi.list(filters),
    placeholderData: keepPreviousData,
  });

export const useActualCurve = (workId: string) =>
  useQuery({ queryKey: workCurveKeys.actual(workId), queryFn: () => workCurvesApi.actual(workId) });

/** Anything that changes a curve in force invalidates projections and portfolio views. */
function useInvalidateCurves() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['work-curves', 'portfolio', 'projections', 'works'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useSyncWorkCurves() {
  const invalidate = useInvalidateCurves();
  return useMutation({ mutationFn: workCurvesApi.sync, onSuccess: invalidate });
}

export function useImportActualCurve(workId: string) {
  const invalidate = useInvalidateCurves();
  return useMutation({
    mutationFn: (body: ActualCurveBody) => workCurvesApi.importActual(workId, body),
    onSuccess: invalidate,
  });
}

export const useIntegrationStatus = () =>
  useQuery({
    queryKey: ['integrations', 'status'],
    queryFn: integrationsApi.status,
    staleTime: 300_000,
  });

/** Pulls own curves from SharePoint (BD_Infos Gerais). `dryRun` only simulates. */
export function useGraphCurveSync() {
  const invalidate = useInvalidateCurves();
  return useMutation({
    mutationFn: (dryRun: boolean) => integrationsApi.syncWorkCurves(dryRun),
    onSuccess: (report) => (report.dryRun ? undefined : invalidate()),
  });
}
