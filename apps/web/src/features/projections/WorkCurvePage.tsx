import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildSchedule } from '@unita/engine';
import { CurveChart } from '@/components/charts/CurveChart';
import { Alert, Card, CardHeader, Skeleton } from '@/components/ui';
import { CurvePointsTable } from '@/features/curves/CurvePointsTable';
import { useCurveVersion } from '@/features/curves/hooks';
import { errorMessage } from '@/services/api/client';
import { ActualCurvePanel } from '@/features/work-curves/ActualCurvePanel';
import { cn } from '@/utils/cn';
import { useWorkContext } from './WorkLayout';

type Tab = 'parametric' | 'actual';

export function WorkCurvePage() {
  const w = useWorkContext();
  const [tab, setTab] = useState<Tab>('parametric');
  return (
    <div className="space-y-5">
      <div className="flex w-fit rounded-control border border-border bg-surface p-0.5 text-sm">
        {(
          [
            ['parametric', 'Curva paramétrica'],
            ['actual', 'Curva própria (API)'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'rounded-[6px] px-3 py-1.5 font-medium',
              tab === key ? 'bg-secondary text-white' : 'text-ink-600',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'parametric' ? (
        <ParametricCurve />
      ) : (
        <ActualCurvePanel workId={w.id} startDate={w.startDate} />
      )}
    </div>
  );
}

function ParametricCurve() {
  const w = useWorkContext();
  const version = useCurveVersion(w.curve.id, w.curve.version);
  if (version.isLoading) return <Skeleton className="h-96" />;
  if (version.isError || !version.data)
    return <Alert tone="error">{errorMessage(version.error)}</Alert>;
  const v = version.data;
  const sameLength = v.periods === w.durationMonths;
  const labels = sameLength
    ? buildSchedule(w.startDate, w.durationMonths).periods.map((p) => p.label)
    : undefined;

  return (
    <div className="space-y-5">
      <Alert tone="info">
        Curva{' '}
        <Link to={`/curvas/${w.curve.id}`} className="font-semibold underline">
          {w.curve.name}
        </Link>{' '}
        — versão V{v.version} ({v.periods} períodos).
        {!sameLength &&
          ` A obra tem ${w.durationMonths} meses: a curva é reamostrada proporcionalmente pelo motor de cálculo.`}
      </Alert>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Gráfico da curva" />
          <div className="p-4">
            <CurveChart
              points={v.points.map((p, i) => ({
                label: labels?.[i] ?? String(p.period),
                monthly: p.monthlyPct,
                cumulative: p.cumulativePct,
              }))}
            />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Tabela mensal" />
          <CurvePointsTable points={v.points} labels={labels} />
        </Card>
      </div>
    </div>
  );
}
