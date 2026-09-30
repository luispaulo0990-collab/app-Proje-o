import type { ProjectionCellDto } from '@unita/contracts';
import { formatCurrency, formatPercent } from '@/utils/format';
import { cn } from '@/utils/cn';

interface Row {
  label: string;
  cells: ProjectionCellDto[];
  value: (c: ProjectionCellDto) => string;
  total: string;
  strong?: boolean;
}

/**
 * Read-only horizontal preview (months on X, series on Y) with frozen first column and
 * sticky header. The full editable, virtualised grid is Phase 6.
 */
export function ProjectionPreviewGrid({
  physical,
  fee,
  referenceMonth,
  totals,
}: {
  physical: ProjectionCellDto[];
  fee: ProjectionCellDto[];
  referenceMonth: string;
  totals: { physical: string; fee: string };
}) {
  const months = fee.length >= physical.length ? fee : physical;
  const byMonth = (cells: ProjectionCellDto[]) => new Map(cells.map((c) => [c.month, c]));
  const phys = byMonth(physical);
  const f = byMonth(fee);
  const rows: Row[] = [
    {
      label: 'Avanço físico (mês)',
      cells: physical,
      value: (c) => formatPercent(c.current),
      total: formatPercent(totals.physical),
      strong: true,
    },
    {
      label: 'Avanço físico (acum.)',
      cells: physical,
      value: (c) => formatPercent(c.cumulative),
      total: '',
    },
    {
      label: 'Taxa (R$)',
      cells: fee,
      value: (c) => formatCurrency(c.current),
      total: formatCurrency(totals.fee),
      strong: true,
    },
    {
      label: 'Taxa acumulada (R$)',
      cells: fee,
      value: (c) => formatCurrency(c.cumulative),
      total: '',
    },
  ];
  const lookup = (row: Row, month: string) => (row.cells === physical ? phys : f).get(month);

  return (
    <div className="relative max-h-[60vh] overflow-auto rounded-card border border-border bg-surface">
      <table className="tabular border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 min-w-56 border-b border-r border-border bg-ink-50 px-4 py-2 text-left text-xs font-semibold uppercase text-text-muted">
              Item
            </th>
            {months.map((m) => (
              <th
                key={m.month}
                className={cn(
                  'sticky top-0 z-10 min-w-32 border-b border-border px-3 py-2 text-right text-xs font-semibold',
                  m.month === referenceMonth
                    ? 'bg-cell-current-period text-primary'
                    : 'bg-ink-50 text-text-muted',
                )}
              >
                {m.label}
              </th>
            ))}
            <th className="sticky top-0 z-10 min-w-36 border-b border-l border-border bg-ink-100 px-3 py-2 text-right text-xs font-semibold">
              TOTAL
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="group">
              <td
                className={cn(
                  'sticky left-0 z-10 border-b border-r border-border bg-surface px-4 py-2 group-hover:bg-ink-50',
                  row.strong ? 'font-medium' : 'text-text-muted',
                )}
              >
                {row.label}
              </td>
              {months.map((m) => {
                const cell = lookup(row, m.month);
                const manual = cell?.origin === 'MANUAL';
                return (
                  <td
                    key={m.month}
                    title={
                      manual
                        ? `Ajuste manual · curva: ${row.cells === physical ? formatPercent(cell.original) : formatCurrency(cell.original)}`
                        : undefined
                    }
                    className={cn(
                      'whitespace-nowrap border-b border-border px-3 py-2 text-right group-hover:bg-ink-50',
                      manual && 'bg-cell-manual',
                      m.month === referenceMonth && !manual && 'bg-cell-current-period/60',
                      !row.strong && 'text-text-muted',
                    )}
                  >
                    {cell ? row.value(cell) : ''}
                  </td>
                );
              })}
              <td className="whitespace-nowrap border-b border-l border-border bg-ink-50 px-3 py-2 text-right font-semibold">
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
