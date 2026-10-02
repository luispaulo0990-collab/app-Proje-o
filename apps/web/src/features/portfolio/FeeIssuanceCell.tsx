import { useRef, useState, type KeyboardEvent } from 'react';
import type { ConsolidatedWorkDto } from '@unita/contracts';
import { addMonthsIso } from '@unita/engine';
import { ConfirmDialog } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { cn } from '@/utils/cn';
import {
  decimalToInput,
  formatCurrency,
  formatDateTime,
  formatMonth,
  parseMoneyInput,
} from '@/utils/format';
import { useDeleteFeeIssuance, useSetFeeIssuance } from './hooks';

const MONEY = /^\d+(\.\d{1,2})?$/;

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
  const [draft, setDraft] = useState<string | null>(null);
  // Escape closes the editor without saving even if the browser fires blur afterwards.
  const discard = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useSetFeeIssuance();
  const remove = useDeleteFeeIssuance();
  const target = { workId: work.workId, month: referenceMonth };

  const startEdit = () => {
    if (!editable || save.isPending) return;
    discard.current = false;
    setError(null);
    setDraft(issuance ? decimalToInput(issuance.amount) : '');
  };

  const close = () => {
    setDraft(null);
    setError(null);
  };

  /** Single save path: the input's blur (Enter blurs it; Escape discards first). */
  const commit = () => {
    if (draft === null) return;
    if (discard.current || draft.trim() === '') return close();
    const amount = parseMoneyInput(draft);
    if (amount === null || !MONEY.test(amount)) {
      setError('Informe um valor em R$ (até 2 casas).');
      return;
    }
    setDraft(null);
    if (issuance && Number(issuance.amount) === Number(amount)) return;
    save.mutate({ ...target, body: { amount } }, { onError: (e) => setError(errorMessage(e)) });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      discard.current = true;
      e.currentTarget.blur();
    }
  };

  const competence = formatMonth(addMonthsIso(referenceMonth, -1));

  return (
    <div className="min-w-44">
      {draft !== null ? (
        <input
          autoFocus
          inputMode="decimal"
          aria-label={`Taxa emitida em ${formatMonth(referenceMonth)} — ${work.name}`}
          placeholder={decimalToInput(work.feeAtReference)}
          className="h-8 w-full rounded-control border border-primary bg-surface px-2 text-right text-sm tabular focus:outline-none focus:ring-2 focus:ring-primary/20"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
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
