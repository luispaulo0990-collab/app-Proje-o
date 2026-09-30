import { useDeferredValue, useMemo, useState } from 'react';
import type { WorkCurveStatus } from '@unita/contracts';
import { ReferenceMonthInput, toReferenceDate } from '@/components/forms/ReferenceMonthInput';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Card, EmptyState, Input, Select, Skeleton } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { cn } from '@/utils/cn';
import { CURVE_STATUS } from './curveStatus';
import { GraphSyncPanel } from './GraphSyncPanel';
import { useSyncWorkCurves, useWorkCurves } from './hooks';
import { WorkCurvesGrid, type CurveView } from './WorkCurvesGrid';

const STATUSES = Object.keys(CURVE_STATUS) as WorkCurveStatus[];

/** "Curvas das obras": the physical curve in force for every work, month by month. */
export function WorkCurvesPage() {
  const { can } = useAuth();
  const [reference, setReference] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<WorkCurveStatus | ''>('');
  const [view, setView] = useState<CurveView>('monthly');
  const deferredQ = useDeferredValue(q.trim());
  const query = useWorkCurves({
    referenceDate: toReferenceDate(reference),
    q: deferredQ || undefined,
  });
  const sync = useSyncWorkCurves();
  const data = query.data;
  const items = useMemo(
    () => (data?.items ?? []).filter((i) => !status || i.curveStatus === status),
    [data, status],
  );

  return (
    <>
      <PageHeader
        title="Curvas das obras"
        description="Obras não iniciadas usam a curva paramétrica; obras iniciadas usam a própria curva (hoje, da planilha Painel de Obras; depois, da API do SharePoint)."
      />
      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
        <Input
          className="h-9 max-w-64"
          placeholder="Filtrar obra ou cliente…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filtrar"
        />
        <Select
          className="h-9 max-w-52"
          value={status}
          onChange={(e) => setStatus(e.target.value as WorkCurveStatus | '')}
          aria-label="Situação da curva"
        >
          <option value="">Todas as situações</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {CURVE_STATUS[s].label}
            </option>
          ))}
        </Select>
        <ReferenceMonthInput value={reference} onChange={setReference} />
      </div>

      {query.isLoading ? (
        <Skeleton className="h-[60vh]" />
      ) : query.isError || !data ? (
        <Alert tone="error">{errorMessage(query.error)}</Alert>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus((prev) => (prev === s ? '' : s))}
                className={cn(
                  'rounded-card border bg-surface px-4 py-3 text-left shadow-card transition-colors hover:border-primary',
                  status === s ? 'border-primary' : 'border-border',
                )}
              >
                <p className="text-xs font-medium text-text-muted">{CURVE_STATUS[s].label}</p>
                <p className="tabular mt-1 text-lg font-semibold">{data.counts[s]}</p>
                <p className="text-xs text-text-muted">{CURVE_STATUS[s].hint}</p>
              </button>
            ))}
            <Card className="px-4 py-3">
              <p className="text-xs font-medium text-text-muted">Projeções a recalcular</p>
              <p className="tabular mt-1 text-lg font-semibold">{data.counts.needsRecalc}</p>
              {can('EDITOR') ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-1"
                  loading={sync.isPending}
                  disabled={data.counts.needsRecalc === 0}
                  onClick={() => sync.mutate()}
                >
                  Sincronizar projeções
                </Button>
              ) : (
                <p className="text-xs text-text-muted">
                  Curva em vigor mudou desde a última versão.
                </p>
              )}
            </Card>
          </div>

          <GraphSyncPanel />

          {sync.isSuccess && (
            <Alert tone="success">
              {sync.data.recalculated} projeção(ões) recalculada(s)
              {sync.data.markedStale > 0 &&
                ` · ${sync.data.markedStale} marcada(s) para revisão por terem ajustes manuais`}
              .
            </Alert>
          )}
          {sync.isError && <Alert tone="error">{errorMessage(sync.error)}</Alert>}

          <div className="flex items-center justify-between gap-3">
            <div className="flex rounded-control border border-border bg-surface p-0.5 text-xs">
              {(['monthly', 'cumulative'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    'rounded-[6px] px-2.5 py-1 font-medium',
                    view === v ? 'bg-secondary text-white' : 'text-ink-600',
                  )}
                >
                  {v === 'monthly' ? '% mensal' : '% acumulado'}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              Valores em verde vêm da curva própria da obra; os demais, da curva paramétrica.
            </p>
          </div>

          {items.length === 0 ? (
            <Card>
              <EmptyState title="Nenhuma obra encontrada" description="Ajuste os filtros." />
            </Card>
          ) : (
            <WorkCurvesGrid data={data} items={items} view={view} />
          )}
        </div>
      )}
    </>
  );
}
