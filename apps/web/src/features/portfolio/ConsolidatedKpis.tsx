import type { ConsolidatedDto } from '@unita/contracts';
import { Card } from '@/components/ui';
import { formatCurrency, formatMonth } from '@/utils/format';

/** Portfolio KPIs — straight from the API (engine), never recomputed here. */
export function ConsolidatedKpis({ data }: { data: ConsolidatedDto }) {
  const t = data.totals;
  const ref = formatMonth(data.referenceMonth);
  const items = [
    { label: 'Taxa total projetada', value: formatCurrency(t.feeProjected) },
    { label: `Recebida até ${ref}`, value: formatCurrency(t.feeRealized) },
    { label: 'A receber', value: formatCurrency(t.feeRemaining) },
    { label: `Taxa em ${ref}`, value: formatCurrency(t.feeAtReference) },
    {
      label: `Acumulado ${data.referenceMonth.slice(0, 4)}`,
      value: formatCurrency(t.feeYearToDateAtReference),
    },
    {
      label: `Obras ativas em ${ref}`,
      value: `${t.activeWorksAtReference} / ${t.worksCount}`,
    },
    { label: 'Obras atrasadas (cliente)', value: String(t.delayedWorks) },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        {items.map((k) => (
          <Card key={k.label} className="px-4 py-3">
            <p className="text-xs font-medium text-text-muted">{k.label}</p>
            <p className="tabular mt-1 text-lg font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>
      {data.years.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Taxa por ano">
          {data.years.map((y) => (
            <span
              key={y.year}
              className="tabular rounded-full border border-border bg-surface px-3 py-1 text-xs"
            >
              <span className="text-text-muted">Acumulado {y.year}</span>{' '}
              <strong>{formatCurrency(y.feeTotal)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
