import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/utils/cn';
import { decimalToInput, parseMoneyInput } from '@/utils/format';

/** R$ with up to 2 decimals, as the API expects ("1234.56"). */
const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Inline editor of a value in R$ used inside grid cells. Enter (or leaving the field) saves,
 * Escape discards. An empty field calls `onCommit(null)` — each caller decides what "empty"
 * means (nothing to do, or "remove the adjustment").
 */
export function InlineMoneyInput({
  initial,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
  className,
}: {
  /** Current value (API decimal string) shown in the field; null = empty field. */
  initial: string | null;
  placeholder?: string;
  ariaLabel: string;
  onCommit: (amount: string | null) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial === null ? '' : decimalToInput(initial));
  const [error, setError] = useState<string | null>(null);
  // Escape closes the editor without saving even if the browser fires blur afterwards.
  const discard = useRef(false);

  /** Single save path: the input's blur (Enter blurs it; Escape discards first). */
  const commit = () => {
    if (discard.current) return onCancel();
    if (draft.trim() === '') return onCommit(null);
    const amount = parseMoneyInput(draft);
    if (amount === null || !MONEY.test(amount)) {
      setError('Informe um valor em R$ (até 2 casas).');
      return;
    }
    if (initial !== null && Number(initial) === Number(amount)) return onCancel();
    onCommit(amount);
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

  return (
    <>
      <input
        autoFocus
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        placeholder={placeholder}
        className={cn(
          'h-8 w-full rounded-control border border-primary bg-surface px-2 text-right text-sm tabular focus:outline-none focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-error',
          className,
        )}
        value={draft}
        onChange={(e) => {
          setError(null);
          setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
      {error && <p className="mt-0.5 text-right text-[11px] text-error">{error}</p>}
    </>
  );
}
