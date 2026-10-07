import { useState } from 'react';
import type { ConsolidatedWorkDto } from '@unita/contracts';
import { addMonthsIso } from '@unita/engine';
import { InlineMoneyInput } from '@/components/forms/InlineMoneyInput';
import { ConfirmDialog } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDateTime, formatMonth } from '@/utils/format';
import { useDeleteFeeIssuance, useSetFeeIssuance } from './hooks';

/**
 * "Taxa emitida": the fee invoiced for the work in the reference month (competência M−1 — it
 * refers to the progress of the previous month). The API stores it and the engine projects the
 * INCC-corrected balance over the next months; nothing is calculated here.
 */
export function FeeIssuanceCell({
  work,
  referenceMonth,
  canEdit,
}: {
  work: ConsolidatedWorkDto;
  referenceMonth: string;
  canEdit: boolean;
}) {
  const issuance = work.feeIssuance;
  const editable = canEdit && work.acceptsIssuance;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useSetFeeIssuance();
  const remove = useDeleteFeeIssuance();
  const target = { workId: work.workId, month: referenceMonth };

  const startEdit = () => {
    if (!editable || save.isPending) return;
    setError(null);
    setEditing(true);
  };

  /** Empty field = nothing to save (removal goes through the × button). */
  const commit = (amount: string | null) => {
    setEditing(false);
    if (amount === null) return;
    save.mutate({ ...target, body: { amount } }, { onError: (e) => setError(errorMessage(e)) });
  };

  const competence = formatMonth(addMonthsIso(referenceMonth, -1));

  return (
    <div className="min-w-44">
      {editing ? (
        <InlineMoneyInput
          initial={issuance?.amount ?? null}
          placeholder={formatCurrency(work.feeAtReference)}
          ariaLabel={`Taxa emitida em ${formatMonth(referenceMonth)} — ${work.name}`}
          onCommit={commit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          disabled={!editable}
          title={
            editable
              ? `Informe a taxa emitida em ${formatMonth(referenceMonth)} (avanço de ${competence})`
              : canEdit
                ? 'Mês fora do período de recebimento da obra'
                : undefined
          }
          className={cn(
            'flex h-8 w-full items-center justify-end rounded-control border px-2 text-sm tabular transition-colors',
            issuance
              ? 'border-cell-issued bg-cell-issued font-semibold'
              : 'border-dashed border-border text-text-muted',
            editable ? 'hover:border-primary' : 'cursor-default',
          )}
        >
          {save.isPending
            ? 'Salvando…'
            : issuance
              ? formatCurrency(issuance.amount)
              : editable
                ? 'Informar'
                : '—'}
        </button>
      )}
      {issuance && (
        <p
          className="mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-4 text-text-muted"
          title={`${issuance.updatedBy ?? '—'} · ${formatDateTime(issuance.updatedAt)}${issuance.note ? ` · ${issuance.note}` : ''}`}
        >
          <span>avanço de {competence}</span>
          {canEdit && (
            <button
              type="button"
              className="rounded px-1 text-error hover:bg-error-soft"
              aria-label={`Remover taxa emitida — ${work.name}`}
              onClick={() => setConfirmRemove(true)}
            >
              ×
            </button>
          )}
        </p>
      )}
      {error && <p className="mt-0.5 text-right text-[11px] text-error">{error}</p>}

      <ConfirmDialog
        open={confirmRemove}
        title="Remover taxa emitida?"
        onClose={() => setConfirmRemove(false)}
        actions={[
          {
            label: 'Remover',
            variant: 'danger',
            loading: remove.isPending,
            onClick: () =>
              remove.mutate(target, {
                onSuccess: () => setConfirmRemove(false),
                onError: (e) => {
                  setConfirmRemove(false);
                  setError(errorMessage(e));
                },
              }),
          },
        ]}
      >
        O valor emitido em {formatMonth(referenceMonth)} para <strong>{work.name}</strong> será
        removido e a taxa volta a ser projetada pela curva. Uma nova versão da projeção será criada
        e a remoção fica registrada no histórico.
      </ConfirmDialog>
    </div>
  );
}
