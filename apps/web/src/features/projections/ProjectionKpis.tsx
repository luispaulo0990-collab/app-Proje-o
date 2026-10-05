import type { KpisDto } from '@unita/contracts';
import { Card } from '@/components/ui';
import { formatCurrency, formatDate, formatMonth, formatPercent } from '@/utils/format';

/** KPIs come straight from the engine result (single source of truth). */
export function ProjectionKpis({ kpis }: { kpis: KpisDto }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: 'Taxa total projetada', value: formatCurrency(kpis.feeProjected) },
    { label: 'Realizado até a referência', value: formatCurrency(kpis.feeRealized) },
    { label: 'A receber', value: formatCurrency(kpis.feeRemaining) },
    { label: '% físico projetado', value: formatPercent(kpis.physicalProjected) },
    // Measured progress ("Realizado Acumulado", SharePoint) when available; projection otherwise.
    kpis.physicalRealized
      ? {
          label: '% físico acumulado',
          value: formatPercent(kpis.physicalRealized),
          hint: `Realizado · ${kpis.physicalRealizedMonth ? formatMonth(kpis.physicalRealizedMonth) : ''}`,
        }
      : {
          label: '% físico acumulado',
          value: formatPercent(kpis.physicalAccumulated),
          hint: 'Projetado (sem realizado)',
        },
    {
      label: 'Duração',
      value: `${kpis.elapsedMonths}/${kpis.durationMonths} meses`,
      hint: `Término ${formatDate(kpis.endDate)}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => (
        <Card key={k.label} className="px-4 py-3">
          <p className="text-xs font-medium text-text-muted">{k.label}</p>
          <p className="tabular mt-1 text-lg font-semibold">{k.value}</p>
          {k.hint && <p className="text-xs text-text-muted">{k.hint}</p>}
        </Card>
      ))}
    </div>
  );
}
