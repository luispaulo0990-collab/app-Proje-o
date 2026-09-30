import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface DialogAction {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
  loading?: boolean;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions: DialogAction[];
  onClose: () => void;
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc for free). */
export function ConfirmDialog({ open, title, children, actions, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,30rem)] rounded-card border border-border bg-surface p-0 text-text shadow-overlay backdrop:bg-ink-900/40"
    >
      <div className="px-6 pt-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children && <div className="mt-2 text-sm text-ink-600">{children}</div>}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border bg-ink-50 px-6 py-4">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        {actions.map((a) => (
          <Button
            key={a.label}
            variant={a.variant ?? 'primary'}
            onClick={a.onClick}
            loading={a.loading}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </dialog>
  );
}
