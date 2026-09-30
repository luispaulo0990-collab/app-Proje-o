import { useState, type KeyboardEvent } from 'react';
import type { ConsolidatedWorkDto } from '@unita/contracts';
import { ConfirmDialog } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { cn } from '@/utils/cn';
import {
  decimalToInput,
  formatCurrency,
  formatDateTime,
  formatMonth,
  parseDecimalInput,
} from '@/utils/format';
import { useClearFeeRecalibration, useSetFeeRecalibration } from './hooks';

/**
 * "Ajuste projeção de taxa": the user types the new Σ fee still to be received after the
 * reference month. The API stores it, the engine spreads it by the curve and a new projection
 * version is created — nothing is recalculated here.
 */
export function FeeRecalibrationCell({
  work,
  referenceMonth,
  canEdit,
}: {
  work: ConsolidatedWorkDto;
  referenceMonth: string;
  canEdit: boolean;
}) {
  const current = work.feeRecalibration;
  // Fee horizon already over: the engine would reject a recalibration (nothing to spread).
  const editable = canEdit && (work.feeMonthsAfterReference > 0 || Boolean(current));
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const save = useSetFeeRecalibration();
  const clear = useClearFeeRecalibration();

  const startEdit = () => {
    if (!editable || save.isPending) return;
    setError(null);
    setDraft(current ? decimalToInput(current.remainingTotal) : '');
  };

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (text === '') {
      setDraft(null);
      return;
    }
    const parsed = parseDecimalInput(text);
    if (parsed === null || parsed.startsWith('-') || (parsed.split('.')[1]?.length ?? 0) > 2) {
      setError('Informe um valor em R$ (até 2 casas).');
      return;
    }
    const same =
      current &&
      current.referenceMonth === referenceMonth &&
      Number(current.remainingTotal) === Number(parsed);
    setDraft(null);
    if (same) return;
    save.mutate(
      { workId: work.workId, body: { referenceMonth, remainingTotal: parsed } },
      { onError: (e) => setError(errorMessage(e)) },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setDraft(null);
      setError(null);
    }
  };

  return (
    <div className="min-w-44">
      {draft !== null ? (
        <input
          autoFocus
          inputMode="decimal"
          aria-label={`Novo valor de taxa a receber — ${work.name}`}
          placeholder={decimalToInput(work.feeRemaining)}
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
              ? 'Clique para informar o novo total de taxa a receber após o mês de referência'
              : canEdit
                ? 'A taxa desta obra já foi toda faturada até o mês de referência'
                : undefined
          }
          className={cn(
            'flex h-8 w-full items-center justify-end rounded-control border px-2 text-sm tabular transition-colors',
            current
              ? 'border-cell-manual bg-cell-manual font-semibold'
              : 'border-dashed border-border text-text-muted',
            editable ? 'hover:border-primary' : 'cursor-default',
          )}
        >
          {save.isPending
            ? 'Salvando…'
            : current
              ? formatCurrency(current.remainingTotal)
              : editable
                ? 'Ajustar'
                : '—'}
        </button>
      )}
      {current && (
        <p
          className="mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-4 text-text-muted"
          title={`${current.createdBy ?? 'Integração'} · ${formatDateTime(current.createdAt)}${current.note ? ` · ${current.note}` : ''}`}
        >
          <span>
            desde {formatMonth(current.fromMonth)} · era {formatCurrency(current.previousRemaining)}
          </span>
          {canEdit && (
            <button
              type="button"
              className="rounded px-1 text-error hover:bg-error-soft"
              aria-label={`Remover ajuste de taxa — ${work.name}`}
              onClick={() => setConfirmClear(true)}
            >
              ×
            </button>
          )}
        </p>
      )}
      {current && !current.applied && (
        <p className="text-right text-[11px] text-warning">Projeção ainda sem o ajuste</p>
      )}
      {error && <p className="mt-0.5 text-right text-[11px] text-error">{error}</p>}

      <ConfirmDialog
        open={confirmClear}
        title="Remover ajuste de taxa?"
        onClose={() => setConfirmClear(false)}
        actions={[
          {
            label: 'Remover ajuste',
            variant: 'danger',
            loading: clear.isPending,
            onClick: () =>
              clear.mutate(work.workId, {
                onSuccess: () => setConfirmClear(false),
                onError: (e) => {
                  setConfirmClear(false);
                  setError(errorMessage(e));
                },
              }),
          },
        ]}
      >
        A taxa de <strong>{work.name}</strong> volta a ser orçamento × taxa distribuída pela curva.
        Uma nova versão da projeção será criada e o ajuste fica registrado no histórico.
      </ConfirmDialog>
    </div>
  );
}
