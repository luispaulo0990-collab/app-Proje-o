import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { buildSchedule } from '@unita/engine';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Skeleton } from '@/components/ui';
import { useCurves } from '@/features/curves/hooks';
import { INCC_PERIODICITY_OPTIONS } from '@/features/fee-terms/feeTerms';
import { errorMessage } from '@/services/api/client';
import { formatDate } from '@/utils/format';
import { useClients, useSaveWork, useWork } from './hooks';
import { WORK_STATUS } from './status';
import {
  CONSTRUCTION_SYSTEMS,
  emptyWorkForm,
  formToBody,
  workFormSchema,
  workToForm,
  type WorkFormValues,
} from './workForm';

export function WorkFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const work = useWork(id);
  const curves = useCurves();
  const clients = useClients();
  const save = useSaveWork(id);
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, reset, setValue, control, formState } = useForm<WorkFormValues>({
    resolver: zodResolver(workFormSchema),
    defaultValues: emptyWorkForm,
  });
  const errors = formState.errors;

  useEffect(() => {
    if (work.data) reset(workToForm(work.data));
  }, [work.data, reset]);

  const [curveId, curveVersionId, startDate, durationMonths] = useWatch({
    control,
    name: ['curveId', 'curveVersionId', 'startDate', 'durationMonths'],
  });
  const activeCurves = useMemo(
    () => (curves.data?.items ?? []).filter((c) => c.status === 'ACTIVE' || c.id === curveId),
    [curves.data, curveId],
  );
  const selectedCurve = activeCurves.find((c) => c.id === curveId);
  const outdatedVersion =
    selectedCurve && curveVersionId && selectedCurve.latestVersionId !== curveVersionId;

  // Preview uses the same engine package as the API (no duplicated calendar rule).
  const schedule = useMemo(() => {
    try {
      return startDate && durationMonths ? buildSchedule(startDate, Number(durationMonths)) : null;
    } catch {
      return null;
    }
  }, [startDate, durationMonths]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const saved = await save.mutateAsync(formToBody(values));
      navigate(`/obras/${saved.id}`);
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  if (editing && work.isLoading) return <Skeleton className="h-96" />;
  if (editing && work.isError) return <Alert tone="error">{errorMessage(work.error)}</Alert>;

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow={editing ? 'Editar obra' : 'Nova obra'}
        title={editing ? work.data?.name : 'Cadastro de obra'}
        description="Ao salvar, a projeção é gerada pelo motor de cálculo a partir da curva selecionada."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              Salvar
            </Button>
          </>
        }
      />
      {serverError && (
        <Alert tone="error" title="Não foi possível salvar">
          {serverError}
        </Alert>
      )}

      <Card>
        <CardHeader title="Identificação" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Nome da obra" error={errors.name?.message} className="sm:col-span-2">
            <Input {...register('name')} />
          </Field>
          <Field
            label="Cliente"
            error={errors.clientName?.message}
            hint="Selecione ou digite um novo cliente."
          >
            <Input list="clients" autoComplete="off" {...register('clientName')} />
          </Field>
          <datalist id="clients">
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <Field label="Quantidade de unidades (UH)" error={errors.units?.message}>
            <Input inputMode="numeric" {...register('units')} />
          </Field>
          <Field label="Status" error={errors.status?.message}>
            <Select {...register('status')}>
              {Object.entries(WORK_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Parâmetros" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Orçamento raso (R$)"
            error={errors.budget?.message}
            hint="Ex.: 29.254.015,86"
          >
            <Input inputMode="decimal" {...register('budget')} />
          </Field>
          <Field
            label="Taxa de administração (%)"
            error={errors.feeRatePct?.message}
            hint="Ex.: 9 ou 9,5"
          >
            <Input inputMode="decimal" {...register('feeRatePct')} />
          </Field>
          <Field
            label="Correção pelo INCC"
            error={errors.inccPeriodicity?.message}
            hint="Mudanças futuras de taxa ou de correção: aba Taxa e INCC da obra."
          >
            <Select {...register('inccPeriodicity')}>
              {INCC_PERIODICITY_OPTIONS.map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Mês-base do INCC"
            error={errors.inccBaseMonth?.message}
            hint="Conta os períodos da correção (trimestre, ano…). Vazio = mês de início."
          >
            <Input type="month" {...register('inccBaseMonth')} />
          </Field>
          <Field label="Sistema construtivo" error={errors.constructionSystem?.message}>
            <Input list="systems" autoComplete="off" {...register('constructionSystem')} />
          </Field>
          <datalist id="systems">
            {CONSTRUCTION_SYSTEMS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Field
            label="Curva"
            error={errors.curveId?.message ?? errors.curveVersionId?.message}
            className="sm:col-span-2"
          >
            <Select
              {...register('curveId', {
                onChange: (e: { target: { value: string } }) => {
                  const c = activeCurves.find((x) => x.id === e.target.value);
                  setValue('curveVersionId', c?.latestVersionId ?? '', { shouldValidate: true });
                },
              })}
              disabled={curves.isLoading}
            >
              <option value="">Selecione…</option>
              {activeCurves.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — V{c.latestVersion} ({c.periods} meses)
                </option>
              ))}
            </Select>
          </Field>
          {outdatedVersion && (
            <Alert tone="info" className="sm:col-span-2">
              Esta obra usa uma versão anterior da curva.{' '}
              <button
                type="button"
                className="font-semibold text-primary underline"
                onClick={() =>
                  setValue('curveVersionId', selectedCurve.latestVersionId, { shouldDirty: true })
                }
              >
                Atualizar para V{selectedCurve.latestVersion}
              </button>
            </Alert>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Cronograma" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Data de início" error={errors.startDate?.message}>
            <Input type="date" {...register('startDate')} />
          </Field>
          <Field label="Duração (meses)" error={errors.durationMonths?.message}>
            <Input inputMode="numeric" {...register('durationMonths')} />
          </Field>
          <div className="flex flex-col justify-end rounded-control bg-ink-50 px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Término calculado
            </span>
            <span className="tabular text-lg font-semibold">
              {schedule ? formatDate(schedule.endDate) : '—'}
            </span>
            <span className="text-xs text-text-muted">
              {schedule
                ? `${schedule.periods.length} períodos · ${schedule.periods[0]?.label} a ${schedule.periods.at(-1)?.label}`
                : 'Informe início e duração'}
            </span>
          </div>
        </div>
      </Card>
    </form>
  );
}
