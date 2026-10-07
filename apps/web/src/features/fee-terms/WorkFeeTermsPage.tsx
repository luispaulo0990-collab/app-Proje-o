import { useState, type FormEvent } from 'react';
import type { FeeTermDto, FeeTermListResponse, InccPeriodicity } from '@unita/contracts';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Select,
  TableSkeleton,
} from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { useWorkContext } from '@/features/projections/WorkLayout';
import { errorMessage } from '@/services/api/client';
import {
  currentMonthInput,
  formatDateTime,
  formatMonth,
  formatPercent,
  fractionToPercentInput,
  percentInputToFraction,
} from '@/utils/format';
import { INCC_PERIODICITY, INCC_PERIODICITY_OPTIONS, conditionsAt } from './feeTerms';
import { useDeleteFeeTerm, useFeeTerms, useSetFeeTerm } from './hooks';

/** Form state: month as `AAAA-MM`, rate as typed in pt-BR ("9,5"). */
interface TermForm {
  month: string;
  feeRatePct: string;
  inccPeriodicity: InccPeriodicity;
  note: string;
}

/** Pre-fills the form with the conditions in force in the month, so only what changes is typed. */
function formFor(data: FeeTermListResponse, month: string): TermForm {
  const current = conditionsAt(data, `${month}-01`);
  return {
    month,
    feeRatePct: fractionToPercentInput(current.feeRate),
    inccPeriodicity: current.inccPeriodicity,
    note: current.term?.month === `${month}-01` ? (current.term.note ?? '') : '',
  };
}

/**
 * "Taxa e INCC" of a work: the fee conditions over time. The registration (cadastro) applies
 * until the first change; each change ("vigência") sets the NEW fee rate and the INCC correction
 * periodicity from a month on. Saving regenerates the projection (manual cells preserved).
 */
export function WorkFeeTermsPage() {
  const w = useWorkContext();
  const { can } = useAuth();
  const canEdit = can('EDITOR');
  const terms = useFeeTerms(w.id);
  const save = useSetFeeTerm(w.id);
  const remove = useDeleteFeeTerm(w.id);
  /** null = untouched: the form shows the conditions in force in the current month. */
  const [edited, setForm] = useState<TermForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<FeeTermDto | null>(null);

  if (terms.isLoading) return <TableSkeleton rows={4} cols={4} />;
  if (terms.isError || !terms.data) return <Alert tone="error">{errorMessage(terms.error)}</Alert>;
  const data = terms.data;
  const form = edited ?? formFor(data, currentMonthInput());

  const changeMonth = (month: string) => setForm(month ? formFor(data, month) : { ...form, month });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const feeRate = percentInputToFraction(form.feeRatePct);
    if (!form.month || feeRate === null || feeRate.startsWith('-') || Number(feeRate) > 1) {
      setError('Informe o mês e a nova taxa entre 0% e 100% (ex.: 9 ou 9,5).');
      return;
    }
    const month = `${form.month}-01`;
    save.mutate(
      {
        month,
        body: {
          feeRate,
          inccPeriodicity: form.inccPeriodicity,
          note: form.note.trim() || undefined,
        },
      },
      {
        onSuccess: (r) => {
          setError(null);
          setNotice(
            `A partir de ${formatMonth(month)}: taxa de ${formatPercent(feeRate)} e INCC ${INCC_PERIODICITY[form.inccPeriodicity].label.toLowerCase()}. Projeção recalculada (V${r.projectionVersion}).`,
          );
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const rows = [
    {
      key: 'base',
      from: 'Início (cadastro)',
      feeRate: data.base.feeRate,
      inccPeriodicity: data.base.inccPeriodicity,
      detail: `Mês-base do INCC: ${formatMonth(data.base.inccBaseMonth)}`,
      term: null as FeeTermDto | null,
    },
    ...data.items.map((t) => ({
      key: t.month,
      from: `A partir de ${formatMonth(t.month)}`,
      feeRate: t.feeRate,
      inccPeriodicity: t.inccPeriodicity,
      detail: [t.note, `${t.updatedBy ?? '—'} · ${formatDateTime(t.updatedAt)}`]
        .filter(Boolean)
        .join(' · '),
      term: t,
    })),
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Taxa e correção pelo INCC ao longo da obra"
          description="Cada linha vale do mês indicado até a próxima. A taxa se aplica à taxa recebida no mês (competência M−1); os meses anteriores a uma mudança não são alterados."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3">Vigência</th>
                <th className="px-4 py-3 text-right">Taxa</th>
                <th className="px-4 py-3">Correção pelo INCC</th>
                <th className="px-4 py-3">Detalhes</th>
                {canEdit && <th className="px-4 py-3" aria-label="Ações" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium">{r.from}</td>
                  <td className="tabular px-4 py-2 text-right">{formatPercent(r.feeRate)}</td>
                  <td className="px-4 py-2" title={INCC_PERIODICITY[r.inccPeriodicity].hint}>
                    {INCC_PERIODICITY[r.inccPeriodicity].label}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{r.detail}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {r.term && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => changeMonth(r.term?.month.slice(0, 7) ?? '')}
                          >
                            Editar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setToRemove(r.term)}>
                            Remover
                          </Button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!canEdit && data.items.length === 0 && (
          <p className="px-5 pb-4 text-sm text-text-muted">
            Nenhuma alteração: a obra segue as condições do cadastro.
          </p>
        )}
      </Card>

      {canEdit && (
        <Card>
          <CardHeader
            title="Alterar a partir de um mês"
            description="Digite a NOVA taxa (ex.: de 8% para 9% → informe 9), não a diferença. A periodicidade define de quanto em quanto tempo o saldo a receber é corrigido pela variação acumulada do INCC no período."
          />
          <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="A partir do mês">
              <Input
                type="month"
                value={form.month}
                onChange={(e) => changeMonth(e.target.value)}
              />
            </Field>
            <Field label="Nova taxa (%)" hint="Taxa vigente no mês já preenchida.">
              <Input
                inputMode="decimal"
                value={form.feeRatePct}
                onChange={(e) => setForm({ ...form, feeRatePct: e.target.value })}
              />
            </Field>
            <Field label="Correção pelo INCC" hint={INCC_PERIODICITY[form.inccPeriodicity].hint}>
              <Select
                value={form.inccPeriodicity}
                onChange={(e) =>
                  setForm({ ...form, inccPeriodicity: e.target.value as InccPeriodicity })
                }
              >
                {INCC_PERIODICITY_OPTIONS.map(([value, option]) => (
                  <option key={value} value={value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observação" hint="Opcional (ex.: aditivo contratual).">
              <Input
                value={form.note}
                maxLength={500}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
              <Button type="submit" loading={save.isPending}>
                Salvar alteração
              </Button>
              <span className="text-xs text-text-muted">
                Ajustes manuais da projeção são preservados; a alteração fica no histórico.
              </span>
            </div>
          </form>
          <div className="px-5 pb-5">
            {error && <Alert tone="error">{error}</Alert>}
            {notice && !error && <Alert tone="success">{notice}</Alert>}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={toRemove !== null}
        title="Remover alteração?"
        onClose={() => setToRemove(null)}
        actions={[
          {
            label: 'Remover',
            variant: 'danger',
            loading: remove.isPending,
            onClick: () => {
              if (!toRemove) return;
              const label = formatMonth(toRemove.month);
              remove.mutate(toRemove.month, {
                onSuccess: (r) => {
                  setError(null);
                  setNotice(
                    `Alteração de ${label} removida. Projeção recalculada (V${r.projectionVersion}).`,
                  );
                },
                onError: (err) => setError(errorMessage(err)),
                onSettled: () => setToRemove(null),
              });
            },
          },
        ]}
      >
        A partir de {toRemove ? formatMonth(toRemove.month) : ''} voltam a valer as condições
        anteriores. A remoção fica registrada no histórico.
      </ConfirmDialog>
    </div>
  );
}
