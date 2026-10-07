import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { WorkCurveItemDto, WorkCurvesResponse } from '@unita/contracts';
import { Badge } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate, formatMonth, formatPercent, shiftDecimal } from '@/utils/format';
import { useScrollToMonth } from '@/hooks/useScrollToMonth';
import { CURVE_STATUS } from './curveStatus';

export type CurveView = 'monthly' | 'cumulative';
type Month = WorkCurvesResponse['months'][number];

/** 1 − weight, as a decimal string ("0.60" → "0.4"), for the tooltip. */
const ONE_MINUS = (weight: string) =>
  shiftDecimal(String(100 - Number(shiftDecimal(weight, 2))), -2);

const COL_WORK = 'sticky left-0 z-10 w-64 min-w-64 max-w-64';
const cellBase = 'h-10 border-b border-border px-3 whitespace-nowrap';

const CurveRow = memo(function CurveRow({
  item,
  months,
  referenceMonth,
  view,
}: {
  item: WorkCurveItemDto;
  months: Month[];
  referenceMonth: string;
  view: CurveView;
}) {
  const cells = useMemo(() => new Map(item.cells.map((c) => [c.month, c])), [item.cells]);
  const status = CURVE_STATUS[item.curveStatus];
  const own = item.source === 'WORK_ACTUAL';
  /** Months after the last realized one are the trend (shown in italics). */
  const trendFrom = item.trend?.lastRealizedMonth ?? null;

  return (
    <tr className="group">
      <td className={cn(COL_WORK, cellBase, 'border-r bg-surface py-1.5 group-hover:bg-ink-50')}>
        <Link
          to={`/obras/${item.workId}/curva`}
          className="block truncate font-medium hover:text-primary"
          title={item.name}
        >
          {item.name}
        </Link>
        <p className="truncate text-xs text-text-muted">{item.clientName}</p>
      </td>
      <td className={cn(cellBase, 'group-hover:bg-ink-50')}>
        <div className="flex items-center gap-1" title={status.hint}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {item.needsRecalc && <Badge tone="warning">Recalcular</Badge>}
        </div>
        <p className="mt-0.5 max-w-44 truncate text-xs text-text-muted">
          {own && item.actual
            ? `${item.actual.source} · V${item.actual.version}`
            : `${item.parametric.name} · V${item.parametric.version}`}
        </p>
        {item.trend && (
          <p
            className="max-w-44 truncate text-xs text-info"
            title={`Realizado até ${formatMonth(item.trend.lastRealizedMonth)}; depois, tendência: ${formatPercent(item.trend.planWeight, 0)} do replanejado + ${formatPercent(ONE_MINUS(item.trend.planWeight), 0)} do ritmo médio dos últimos ${item.trend.windowMonths} meses.`}
          >
            Tendência · ritmo {formatPercent(item.trend.averagePace, 1)}/mês
          </p>
        )}
      </td>
      <td className={cn(cellBase, 'text-right tabular group-hover:bg-ink-50')}>
        {formatDate(item.startDate)}
      </td>
      <td className={cn(cellBase, 'text-right tabular group-hover:bg-ink-50')}>
        {formatDate(item.endDate)}
        <p className="text-xs text-text-muted">{item.durationMonths} meses</p>
      </td>
      <td
        className={cn(cellBase, 'border-r text-right font-semibold tabular group-hover:bg-ink-50')}
      >
        {formatPercent(item.physicalAccumulated)}
      </td>
      {months.map((m) => {
        const c = cells.get(m.month);
        const isRef = m.month === referenceMonth;
        const past = c && m.month <= referenceMonth;
        const isTrend = c && trendFrom !== null && m.month > trendFrom;
        return (
          <td
            key={m.month}
            className={cn(
              cellBase,
              'text-right tabular group-hover:bg-ink-50',
              isRef && 'bg-cell-current-period/60',
              c && own && !isTrend && 'text-success',
              isTrend && 'italic text-info',
              c && !own && (past ? 'text-text' : 'text-text-muted'),
            )}
          >
            {c ? formatPercent(view === 'monthly' ? c.monthly : c.cumulative) : ''}
          </td>
        );
      })}
    </tr>
  );
});

/** Works on Y, months on X; each row shows the curve in force (parametric or own). */
export function WorkCurvesGrid({
  data,
  items,
  view,
}: {
  data: WorkCurvesResponse;
  items: WorkCurveItemDto[];
  view: CurveView;
}) {
  const head =
    'sticky top-0 z-20 h-10 border-b border-border bg-ink-100 px-3 text-xs font-semibold uppercase text-text-muted whitespace-nowrap';
  const scrollRef = useScrollToMonth<HTMLDivElement>(data.referenceMonth);
  return (
    <div
      ref={scrollRef}
      className="relative max-h-[70vh] overflow-auto rounded-card border border-border bg-surface"
    >
      <table className="tabular border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th data-frozen className={cn(COL_WORK, head, 'z-30 border-r text-left')}>
              Obra
            </th>
            <th className={cn(head, 'text-left')}>Curva em vigor</th>
            <th className={cn(head, 'text-right')}>Início</th>
            <th className={cn(head, 'text-right')}>Término</th>
            <th className={cn(head, 'border-r text-right')}>Av. acum.</th>
            {data.months.map((m) => (
              <th
                key={m.month}
                data-month={m.month}
                className={cn(
                  head,
                  'min-w-24 text-right',
                  m.month === data.referenceMonth && 'bg-cell-current-period text-primary',
                )}
              >
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <CurveRow
              key={item.workId}
              item={item}
              months={data.months}
              referenceMonth={data.referenceMonth}
              view={view}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
