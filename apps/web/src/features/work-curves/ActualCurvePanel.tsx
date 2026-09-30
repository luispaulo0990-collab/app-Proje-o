import { useState } from 'react';
import type { ImportActualCurveResponse } from '@unita/contracts';
import { Decimal } from '@unita/engine';
import { CurveChart } from '@/components/charts/CurveChart';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { formatDateTime, formatMonth, formatPercent, percentInputToFraction } from '@/utils/format';
import { CURVE_STATUS } from './curveStatus';
import { useActualCurve, useImportActualCurve } from './hooks';

const OUTCOME: Record<ImportActualCurveResponse['projection']['outcome'], string> = {
  RECALCULATED: 'Projeção recalculada com a curva própria.',
  MARKED_STALE:
    'A projeção tem ajustes manuais: ela foi marcada para revisão — use “Recalcular” na aba Projeção.',
  NOT_IN_FORCE: 'Curva salva. Ela passa a valer quando a obra iniciar.',
};

/** Own curve of the work (received via API) — status, current version, history and import. */
export function ActualCurvePanel({ workId, startDate }: { workId: string; startDate: string }) {
  const { can } = useAuth();
  const state = useActualCurve(workId);
  if (state.isLoading) return <Skeleton className="h-64" />;
  if (state.isError || !state.data) return <Alert tone="error">{errorMessage(state.error)}</Alert>;
  const { current, versions, effective } = state.data;
  const status = CURVE_STATUS[effective.status];

  return (
    <div className="space-y-5">
      <Alert tone={effective.status === 'STARTED_AWAITING_ACTUAL' ? 'warning' : 'info'}>
        <span className="font-semibold">
          Curva em vigor em {formatMonth(effective.referenceMonth)}:
        </span>{' '}
        {effective.source === 'WORK_ACTUAL' ? 'curva própria da obra' : 'curva paramétrica'} —{' '}
        {status.hint}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Curva própria (API)"
            description={
              current
                ? `V${current.version} · ${current.source}${current.externalRef ? ` · ${current.externalRef}` : ''} · recebida ${formatDateTime(current.createdAt)}`
                : 'Nenhuma curva recebida ainda.'
            }
            actions={current && <Badge tone="success">{current.periods} meses</Badge>}
          />
          <div className="p-4">
            {current ? (
              <CurveChart
                points={current.points.map((p) => ({
                  label: p.label,
                  monthly: p.monthlyPct,
                  cumulative: p.cumulativePct,
                }))}
              />
            ) : (
              <p className="text-sm text-text-muted">
                Quando o sistema de planejamento enviar a curva desta obra, ela aparece aqui.
              </p>
            )}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Versões recebidas" />
          {versions.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">Sem histórico.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div>
                    <p className="font-medium">
                      V{v.version} · {v.source}
                    </p>
                    <p className="text-xs text-text-muted">
                      {formatMonth(v.startMonth)} · {v.periods} meses ·{' '}
                      {v.receivedVia === 'API_KEY' ? 'via API' : (v.createdBy ?? 'usuário')}
                    </p>
                  </div>
                  <span className="text-xs text-text-muted">{formatDateTime(v.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can('EDITOR') && <ImportActualCurveForm workId={workId} startDate={startDate} />}

      <Card>
        <CardHeader
          title="Integração"
          description="Sistemas externos enviam a curva com a chave de integração (X-Api-Key)."
        />
        <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-ink-700">{`PUT /api/v1/works/${workId}/actual-curve
X-Api-Key: <chave definida em INTEGRATION_API_KEYS>
Content-Type: application/json

{ "source": "PLANEJAMENTO", "externalRef": "OBRA-123",
  "months": [ { "month": "2025-09", "monthlyPct": "0.003" },
              { "month": "2025-10", "monthlyPct": "0.008" } ] }`}</pre>
      </Card>
    </div>
  );
}

function ImportActualCurveForm({ workId, startDate }: { workId: string; startDate: string }) {
  const importCurve = useImportActualCurve(workId);
  const [source, setSource] = useState('MANUAL');
  const [startMonth, setStartMonth] = useState(startDate.slice(0, 7));
  const [text, setText] = useState('');
  const [normalize, setNormalize] = useState(false);

  const values = text
    .split(/[\n\t;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fractions = values.map(percentInputToFraction);
  const invalid = fractions.some((f) => f === null);
  // Preview only — the API revalidates with the engine rules on save.
  const total = invalid
    ? null
    : (fractions as string[]).reduce((acc, f) => acc.plus(f), new Decimal(0)).toString();

  const submit = () => {
    if (invalid || fractions.length === 0) return;
    importCurve.mutate({
      source: source.trim(),
      startMonth,
      normalize,
      points: (fractions as string[]).map((monthlyPct, i) => ({ period: i + 1, monthlyPct })),
    });
  };

  return (
    <Card>
      <CardHeader
        title="Lançar curva própria manualmente"
        description="Útil enquanto a integração não está ativa. Cole os % mensais do Excel (um por linha)."
      />
      <div className="grid gap-4 p-5 md:grid-cols-3">
        <Field label="Origem">
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label="Mês do 1º período">
          <Input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
            className="size-4 accent-primary"
          />
          Normalizar para 100%
        </label>
        <div className="md:col-span-3">
          <Textarea
            rows={4}
            placeholder="0,3 ↵ 0,8 ↵ 1,5 …"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Percentuais mensais"
          />
          <p className="mt-1 text-xs text-text-muted">
            {values.length} período(s)
            {total !== null && values.length > 0 && ` · soma ${formatPercent(total)}`}
            {invalid && ' · há valores inválidos'}
          </p>
        </div>
        <div className="flex items-center gap-3 md:col-span-3">
          <Button
            onClick={submit}
            loading={importCurve.isPending}
            disabled={invalid || values.length === 0 || source.trim().length < 2 || !startMonth}
          >
            Salvar nova versão
          </Button>
          {importCurve.isSuccess && (
            <span className="text-sm text-success">
              {OUTCOME[importCurve.data.projection.outcome]}
            </span>
          )}
        </div>
        {importCurve.isError && (
          <Alert tone="error" className="md:col-span-3">
            {errorMessage(importCurve.error)}
          </Alert>
        )}
      </div>
    </Card>
  );
}
