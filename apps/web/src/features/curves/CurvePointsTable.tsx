import type { CurvePointDto } from '@unita/contracts';
import { formatPercent } from '@/utils/format';

/** Read-only table: período · % mensal · % acumulado. */
export function CurvePointsTable({
  points,
  labels,
}: {
  points: CurvePointDto[];
  labels?: string[];
}) {
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
          <tr>
            <th className="px-4 py-2">{labels ? 'Mês' : 'Período'}</th>
            <th className="px-4 py-2 text-right">% mensal</th>
            <th className="px-4 py-2 text-right">% acumulado</th>
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-border">
          {points.map((p, i) => (
            <tr key={p.period}>
              <td className="px-4 py-1.5">{labels?.[i] ?? p.period}</td>
              <td className="px-4 py-1.5 text-right">{formatPercent(p.monthlyPct, 4)}</td>
              <td className="px-4 py-1.5 text-right">{formatPercent(p.cumulativePct, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
