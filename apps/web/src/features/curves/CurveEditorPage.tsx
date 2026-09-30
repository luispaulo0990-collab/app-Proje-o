import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CurveDetailDto } from '@unita/contracts';
import {
  canonicalizeCurve,
  curveFromCumulative,
  normalizeCurveWeights,
  validateCurve,
  type CurvePointInput,
} from '@unita/engine';
import { CurveChart } from '@/components/charts/CurveChart';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Card, CardHeader, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { fractionToPercentInput, percentInputToFraction } from '@/utils/format';
import { useCurve, useSaveCurve } from './hooks';

type Mode = 'monthly' | 'cumulative';

/** Splits text pasted from Excel (one value per line/cell) into percentage strings. */
function splitPasted(text: string): string[] {
  return text
    .split(/[\n\t;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toPoints(values: string[], mode: Mode): CurvePointInput[] | null {
  const fractions = values.map(percentInputToFraction);
  if (fractions.some((f) => f === null)) return null;
  const list = fractions as string[];
  return mode === 'monthly'
    ? list.map((monthlyPct, i) => ({ period: i + 1, monthlyPct }))
    : curveFromCumulative(list);
}

/** Loads the base curve (new version flow) before mounting the editor with initial state. */
export function CurveEditorPage() {
  const { id } = useParams();
  const existing = useCurve(id);
  if (id && existing.isLoading) return <Skeleton className="h-96" />;
  if (id && (existing.isError || !existing.data))
    return <Alert tone="error">{errorMessage(existing.error)}</Alert>;
  return <CurveEditor key={existing.data?.latestVersionId ?? 'new'} curve={existing.data} />;
}

function CurveEditor({ curve }: { curve?: CurveDetailDto }) {
  const navigate = useNavigate();
  const isNewVersion = Boolean(curve);
  const save = useSaveCurve(curve?.id);

  const [name, setName] = useState(curve?.name ?? '');
  const [description, setDescription] = useState(curve?.description ?? '');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<Mode>('monthly');
  const [values, setValues] = useState<string[]>(
    curve ? curve.current.points.map((p) => fractionToPercentInput(p.monthlyPct)) : [''],
  );
  const [serverError, setServerError] = useState<string | null>(null);

  // Instant feedback with the same engine rules the API enforces on save.
  const points = useMemo(
    () =>
      toPoints(
        values.filter((v) => v.trim() !== ''),
        mode,
      ),
    [values, mode],
  );
  const issues = useMemo(() => (points ? validateCurve(points) : []), [points]);
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const canonical = useMemo(
    () => (points && errors.length === 0 ? canonicalizeCurve(points) : null),
    [points, errors.length],
  );

  const setValue = (index: number, value: string) =>
    setValues((prev) => prev.map((v, i) => (i === index ? value : v)));

  const normalize = () => {
    if (!points) return;
    try {
      const normalized = normalizeCurveWeights(points.map((p) => String(p.monthlyPct)));
      setMode('monthly');
      setValues(normalized.map((p) => fractionToPercentInput(p.monthlyPct)));
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Não foi possível normalizar.');
    }
  };

  const onSave = async () => {
    if (!canonical) return;
    setServerError(null);
    const payloadPoints = canonical.map((p) => ({ period: p.period, monthlyPct: p.monthlyPct }));
    try {
      const saved = await save.mutateAsync(
        isNewVersion
          ? { points: payloadPoints, notes: notes || undefined }
          : {
              name,
              description,
              type: 'PHYSICAL',
              points: payloadPoints,
              notes: notes || undefined,
            },
      );
      navigate(`/curvas/${saved.id}`);
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isNewVersion ? `Nova versão — ${curve?.name ?? ''}` : 'Nova curva'}
        title={isNewVersion ? `V${(curve?.latestVersion ?? 0) + 1}` : 'Cadastro de curva'}
        description="Informe os percentuais por período. Cole direto do Excel (uma linha por mês)."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void onSave()}
              disabled={!canonical || (!isNewVersion && name.trim().length < 2)}
              loading={save.isPending}
            >
              Salvar {isNewVersion ? 'versão' : 'curva'}
            </Button>
          </>
        }
      />
      {serverError && <Alert tone="error">{serverError}</Alert>}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Identificação" />
            <div className="space-y-4 p-5">
              {!isNewVersion && (
                <>
                  <Field label="Nome">
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Descrição">
                    <Textarea
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="Notas da versão" hint="Ex.: revisão após replanejamento.">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Pontos"
              actions={
                <div className="flex rounded-control border border-border p-0.5 text-xs">
                  {(['monthly', 'cumulative'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded-[6px] px-2.5 py-1 font-medium ${mode === m ? 'bg-secondary text-white' : 'text-ink-600'}`}
                    >
                      {m === 'monthly' ? '% mensal' : '% acumulado'}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="space-y-3 p-5">
              <Textarea
                rows={3}
                placeholder="Cole aqui os valores do Excel (ex.: 0,4 ↵ 1,2 ↵ 2 …)"
                onPaste={(e) => {
                  const pasted = splitPasted(e.clipboardData.getData('text'));
                  if (pasted.length > 1) {
                    e.preventDefault();
                    setValues(pasted);
                  }
                }}
                aria-label="Colar valores"
              />
              <div className="max-h-[360px] space-y-1.5 overflow-auto pr-1">
                {values.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="tabular w-10 text-right text-xs text-text-muted">{i + 1}</span>
                    <Input
                      className="h-8 tabular"
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => setValue(i, e.target.value)}
                      aria-label={`Período ${i + 1}`}
                    />
                    <span className="text-xs text-text-muted">%</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setValues((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remover"
                      disabled={values.length === 1}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setValues((prev) => [...prev, ''])}
                >
                  + Período
                </Button>
                <Button size="sm" variant="secondary" onClick={normalize} disabled={!points}>
                  Normalizar para 100%
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-3">
          {values.every((v) => v.trim() === '') ? (
            <Alert tone="info">
              Informe ou cole os percentuais de cada período para visualizar a curva.
            </Alert>
          ) : !points ? (
            <Alert tone="warning">
              Há valores inválidos. Use números como 2,5 (sem o símbolo %).
            </Alert>
          ) : errors.length > 0 ? (
            <Alert tone="error" title="A curva ainda não é válida">
              <ul className="list-disc pl-5">
                {errors.slice(0, 6).map((i, k) => (
                  <li key={k}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success">Curva válida: {canonical?.length} períodos, soma = 100%.</Alert>
          )}
          <Card>
            <CardHeader title="Pré-visualização" />
            <div className="p-4">
              <CurveChart
                points={(canonical ?? []).map((p) => ({
                  label: String(p.period),
                  monthly: p.monthlyPct,
                  cumulative: p.cumulativePct,
                }))}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
