import { useState } from 'react';
import { Alert, Badge, Card, CardHeader, Input, Skeleton } from '@/components/ui';
import { CURVE_SOURCE } from '@/features/work-curves/curveStatus';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { formatDateTime } from '@/utils/format';
import { useProjection } from './hooks';
import { ProjectionKpis } from './ProjectionKpis';
import { ProjectionPreviewGrid } from './ProjectionPreviewGrid';
import { RecalculateButton } from './RecalculateDialog';
import { useWorkContext } from './WorkLayout';

export function ProjectionPage() {
  const work = useWorkContext();
  const { can } = useAuth();
  const [reference, setReference] = useState('');
  const projection = useProjection(work.id, reference ? `${reference}-01` : undefined);

  if (projection.isLoading) return <Skeleton className="h-[60vh]" />;
  if (projection.isError || !projection.data)
    return <Alert tone="error">{errorMessage(projection.error)}</Alert>;
  const p = projection.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-text-muted">
          Projeção <strong className="text-text">V{p.version}</strong> ·{' '}
          {formatDateTime(p.createdAt)}
          {p.createdBy ? ` · ${p.createdBy}` : ''} · {p.manualCount} ajuste(s) manual(is) ·{' '}
          <Badge tone={CURVE_SOURCE[p.curveSource].tone}>{CURVE_SOURCE[p.curveSource].label}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-600">
            Referência
            <Input
              type="month"
              className="h-9 w-40"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          {can('EDITOR') && <RecalculateButton workId={work.id} />}
        </div>
      </div>

      {p.isStale && (
        <Alert tone="warning" title="Parâmetros da obra alterados">
          A obra foi alterada após esta projeção e existem ajustes manuais. Use “Recalcular” para
          escolher entre preservar ou substituir os ajustes.
        </Alert>
      )}
      {p.validations.map((v, i) => (
        <Alert key={i} tone="warning">
          {v.message}
        </Alert>
      ))}

      <ProjectionKpis kpis={p.kpis} />

      <Card>
        <CardHeader
          title="Projeção mensal"
          description="Células em amarelo foram ajustadas manualmente; a coluna destacada é o mês de referência. Edição direta na grade chega na Fase 6."
        />
        <div className="p-4">
          <ProjectionPreviewGrid
            physical={p.physical}
            fee={p.fee}
            referenceMonth={p.kpis.referenceMonth}
            totals={p.totals}
          />
        </div>
      </Card>
    </div>
  );
}
