import type { ConsolidatedWorkDto } from '@unita/contracts';
import { InlineMoneyInput } from '@/components/forms/InlineMoneyInput';
import { CELL_ORIGIN } from '@/features/projections/cellOrigin';
import { formatCurrency, formatMonth } from '@/utils/format';

/** One month of the fee row of a work, as sent by GET /portfolio/consolidated. */
type FeeCell = ConsolidatedWorkDto['fee'][number];

const ZERO = /^0(\.0+)?$/;

/**
 * Fee projection of one work × month in the Consolidado. Editors click to type the projected
 * value (manual adjustment); emptying a manual cell sends it back to the curve. Issued months are
 * changed in the "Taxa emitida no mês" column, never here. Purely presentational: saving is done
 * by the row (one mutation per work) and every number comes back recalculated by the engine.
 */
export function FeeProjectionCell({
  cell,
  workName,
  canEdit,
  editing,
  saving,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  cell: FeeCell;
  workName: string;
  canEdit: boolean;
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCommit: (value: string | null) => void;
  onCancel: () => void;
}) {
  const issued = cell.origin === 'ISSUED';
  const manual = cell.origin === 'MANUAL';
  const editable = canEdit && !issued;
  const label = `${formatMonth(cell.month)} — ${workName}`;

  if (editing) {
    return (
      <InlineMoneyInput
        initial={manual ? cell.value : null}
        placeholder={formatCurrency(cell.value)}
        ariaLabel={`Projeção de taxa em ${label}`}
        // Empty: removes a manual adjustment; on a curve cell there is nothing to change.
        onCommit={(value) => (value === null && !manual ? onCancel() : onCommit(value))}
        onCancel={onCancel}
        className="min-w-28"
      />
    );
  }
  const text = saving ? 'Salvando…' : ZERO.test(cell.value) ? '' : formatCurrency(cell.value);
  if (!editable) return <>{text}</>;
  return (
    <button
      type="button"
      onClick={onStartEdit}
      title={
        manual
          ? `${CELL_ORIGIN.MANUAL?.title}: clique para alterar (vazio = volta para a curva)`
          : 'Clique para projetar a taxa manualmente; os demais meses são recalculados'
      }
      className="w-full rounded-control px-1 text-right tabular hover:outline hover:outline-1 hover:outline-primary"
    >
      {text || <span className="text-text-muted">—</span>}
    </button>
  );
}
