import { useState, type FormEvent } from 'react';
import type { InccIndexDto } from '@unita/contracts';
import { addMonthsIso } from '@unita/engine';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Skeleton,
} from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import {
  decimalToInput,
  formatDateTime,
  formatMonth,
  formatNumber,
  parseDecimalInput,
} from '@/utils/format';
import { signedPercent } from './ConsolidatedCells';
import { useDeleteIncc, useInccIndices, useSetIncc } from './hooks';

/** Months listed in the panel (most recent first). */
const VISIBLE_MONTHS = 12;
/** Positive number-index with up to 6 decimals. */
const INDEX = /^\d+(\.\d{1,6})?$/;
/** The INCC index is published with 3 decimals. */
const INDEX_DIGITS = 3;

const toMonthInput = (iso: string) => iso.slice(0, 7);

/**
 * "INCC do mês": the published number-index typed by the user. The engine derives the variation
 * (index M ÷ index M−1 − 1), which corrects the fee still to be received from M+1 on.
 * Saving recalculates every work with issued fee.
 */
export function InccPanel({
  referenceMonth,
  canEdit,
}: {
  referenceMonth: string;
  canEdit: boolean;
}) {
  const indices = useInccIndices();
  const save = useSetIncc();
  const remove = useDeleteIncc();
  const [month, setMonth] = useState(() => toMonthInput(addMonthsIso(referenceMonth, -1)));
  const [index, setIndex] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<InccIndexDto | null>(null);

  const all = indices.data?.items ?? [];
  const items = [...all].reverse().slice(0, VISIBLE_MONTHS);
  const first = all[0];
  const last = all.at(-1);

  const onSuccess = (recalculated: number, text: string) => {
    setError(null);
    setNotice(
      recalculated > 0
        ? `${text} ${recalculated} obra(s) com taxa emitida recalculada(s).`
        : `${text} Nenhuma obra tem taxa emitida ainda: a correção vale a partir da primeira emissão.`,
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseDecimalInput(index);
    if (!month || value === null || !INDEX.test(value) || Number(value) <= 0) {
      setError('Informe o mês e o número-índice do INCC (ex.: 1.296,889).');
      return;
    }
    save.mutate(
      { month: `${month}-01`, body: { index: value } },
      {
        onSuccess: (r) => {
          setIndex('');
          const variation = r.index?.rate
            ? ` Variação calculada: ${signedPercent(r.index.rate, 2)}.`
            : ' Sem índice do mês anterior: a variação deste mês não é calculada.';
          onSuccess(
            r.recalculatedWorks,
            `INCC de ${formatMonth(`${month}-01`)} salvo.${variation}`,
          );
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const edit = (item: InccIndexDto) => {
    setMonth(toMonthInput(item.month));
    setIndex(decimalToInput(item.index, INDEX_DIGITS));
  };

  return (
    <Card>
      <CardHeader
        title="INCC mensal (número-índice)"
        description={
          `Informe o índice INCC do mês; a variação (índice do mês ÷ índice do mês anterior − 1) corrige a taxa a receber a partir do mês seguinte (ex.: INCC de ${formatMonth(addMonthsIso(referenceMonth, -1))} corrige ${formatMonth(referenceMonth)}).` +
          (first && last
            ? ` Histórico: ${formatMonth(first.month)} a ${formatMonth(last.month)} (${all.length} meses).`
            : '')
        }
      />
      <div className="space-y-4 px-5 py-4">
        {canEdit && (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <Field label="Mês do índice" className="w-44">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="INCC do mês (índice)" className="w-44">
              <Input
                inputMode="decimal"
                placeholder="1.296,889"
                value={index}
                onChange={(e) => setIndex(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={save.isPending}>
              Salvar INCC
            </Button>
          </form>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {notice && !error && <Alert tone="success">{notice}</Alert>}

        {indices.isLoading ? (
          <Skeleton className="h-10" />
        ) : items.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhum INCC cadastrado.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="INCC cadastrados">
            {items.map((item) => (
              <li
                key={item.month}
                className="flex items-center gap-2 rounded-control border border-border bg-ink-50 px-3 py-1.5 text-sm"
                title={`${item.updatedBy ?? '—'} · ${formatDateTime(item.updatedAt)}${item.note ? ` · ${item.note}` : ''}`}
              >
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => edit(item)}
                  className="flex items-baseline gap-2 disabled:cursor-default"
                >
                  <span className="font-medium">{formatMonth(item.month)}</span>
                  <span className="tabular">{formatNumber(item.index, INDEX_DIGITS)}</span>
                  <span
                    className="tabular text-xs text-text-muted"
                    title="Variação no mês calculada a partir do índice anterior"
                  >
                    {item.rate === null ? '—' : signedPercent(item.rate, 2)}
                  </span>
                </button>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Remover INCC de ${formatMonth(item.month)}`}
                    className="rounded px-1 text-error hover:bg-error-soft"
                    onClick={() => setToRemove(item)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={toRemove !== null}
        title="Remover INCC?"
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
                onSuccess: (r) => onSuccess(r.recalculatedWorks, `INCC de ${label} removido.`),
                onError: (err) => setError(errorMessage(err)),
                onSettled: () => setToRemove(null),
              });
            },
          },
        ]}
      >
        A correção do INCC de {toRemove ? formatMonth(toRemove.month) : ''} deixa de ser aplicada e
        as obras com taxa emitida são recalculadas. A remoção fica registrada no histórico.
      </ConfirmDialog>
    </Card>
  );
}
