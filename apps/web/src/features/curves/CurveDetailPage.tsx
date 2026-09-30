import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CurveChart } from '@/components/charts/CurveChart';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, Card, CardHeader, Select, Skeleton } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { formatDateTime } from '@/utils/format';
import { CurvePointsTable } from './CurvePointsTable';
import { useCurve, useCurveVersion } from './hooks';

export function CurveDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const curve = useCurve(id);
  const [selected, setSelected] = useState<number | undefined>();
  const versionNumber = selected ?? curve.data?.latestVersion;
  const version = useCurveVersion(id, versionNumber);

  if (curve.isLoading) return <Skeleton className="h-96" />;
  if (curve.isError || !curve.data) return <Alert tone="error">{errorMessage(curve.error)}</Alert>;
  const c = curve.data;
  const v = version.data ?? (versionNumber === c.latestVersion ? c.current : undefined);

  return (
    <>
      <PageHeader
        eyebrow="Curva paramétrica"
        title={c.name}
        description={c.description}
        actions={
          can('ADMIN') && (
            <Button onClick={() => navigate(`/curvas/${c.id}/nova-versao`)}>Nova versão</Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={versionNumber}
          onChange={(e) => setSelected(Number(e.target.value))}
          className="max-w-48"
          aria-label="Versão"
        >
          {c.versions.map((ver) => (
            <option key={ver.id} value={ver.version}>
              V{ver.version}
              {ver.version === c.latestVersion ? ' (atual)' : ''}
            </option>
          ))}
        </Select>
        <Badge tone={c.status === 'ACTIVE' ? 'success' : 'warning'}>
          {c.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'}
        </Badge>
        {v && (
          <span className="text-sm text-text-muted">
            {v.periods} períodos · criada em {formatDateTime(v.createdAt)}
            {v.createdBy ? ` por ${v.createdBy}` : ''} · usada por {v.usedByWorks} obra(s)
          </span>
        )}
      </div>
      {v?.notes && (
        <Alert tone="info" className="mb-4">
          {v.notes}
        </Alert>
      )}
      {!v ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="Distribuição" description="Barras: % mensal · Linha: % acumulado" />
            <div className="p-4">
              <CurveChart
                points={v.points.map((p) => ({
                  label: String(p.period),
                  monthly: p.monthlyPct,
                  cumulative: p.cumulativePct,
                }))}
              />
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Pontos" />
            <CurvePointsTable points={v.points} />
          </Card>
        </div>
      )}
    </>
  );
}
