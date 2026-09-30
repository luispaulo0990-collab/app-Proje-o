import { memo, useMemo, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { ConsolidatedDto, ConsolidatedWorkDto } from '@unita/contracts';
import { Badge } from '@/components/ui';
import { CURVE_SOURCE } from '@/features/work-curves/curveStatus';
import { cn } from '@/utils/cn';
import { formatCurrency, formatMonth, formatNumber, formatPercent } from '@/utils/format';
import { ClientStatus, Progress, sub } from './ConsolidatedCells';
import { FeeRecalibrationCell } from './FeeRecalibrationCell';

type Month = ConsolidatedDto['months'][number];
type Totals = ConsolidatedDto['totals'];

/*
 * Consolidado = "Painel de obras" + projeção mês a mês, como na planilha:
 * três colunas congeladas (cliente, obra, série), as colunas do painel e os meses no eixo X.
 * Cada obra ocupa duas linhas (avanço físico e taxa); as colunas do painel ocupam as duas.
 * Quatro linhas de cabeçalho fixas: meses, taxa no mês, acumulado no ano e obras ativas.
 */
const COL_CLIENT = 'sticky left-0 z-10 w-28 min-w-28 max-w-28';
const COL_WORK = 'sticky left-28 z-10 w-48 min-w-48 max-w-48';
const COL_SERIES = 'sticky left-76 z-10 w-24 min-w-24 max-w-24 border-r';
const HEAD_ROW_TOP = ['top-0', 'top-12', 'top-21', 'top-30'] as const;
/** Zero values stay blank, as in the spreadsheet, to highlight each work's active window. */
const ZERO = /^-?0(\.0+)?$/;
const headCell = 'border-b border-border px-3 text-xs';
const bodyCell = 'h-9 border-b border-border px-3 whitespace-nowrap text-right';
const panelCell = 'border-b border-border px-3 py-1.5 align-middle whitespace-nowrap';

interface PanelColumn {
  key: string;
  label: string;
  /** Hidden when the panel is collapsed. */
  detail?: boolean;
  className?: string;
  headClassName?: string;
  /** Value shown in the "Taxa no mês" header row (portfolio total). */
  total?: (t: Totals) => ReactNode;
  render: (w: ConsolidatedWorkDto, ctx: { referenceMonth: string; canEdit: boolean }) => ReactNode;
}

const PANEL_COLUMNS: PanelColumn[] = [
  {
    key: 'budget',
    label: 'Orçamento raso',
    detail: true,
    className: 'text-right',
    total: (t) => formatCurrency(t.budgetTotal),
    render: (w) => formatCurrency(w.budget),
  },
  {
    key: 'units',
    label: 'UH',
    detail: true,
    className: 'text-right',
    total: (t) => formatNumber(t.unitsTotal),
    render: (w) => formatNumber(w.units),
  },
  {
    key: 'start',
    label: 'Início / meses incorridos',
    detail: true,
    className: 'text-center',
    render: (w) => (
      <span
        title={
          w.startSource === 'API'
            ? 'Primeiro mês da curva própria da obra (API)'
            : 'Obra sem curva própria: início da projeção paramétrica'
        }
      >
        {formatMonth(w.startMonth)}
        {w.startSource === 'PROJECTION' && <span className="text-text-muted">*</span>}
        <span className={sub}>{w.monthsIncurred} meses</span>
      </span>
    ),
  },
  {
    key: 'end',
    label: 'Término projetado / duração',
    detail: true,
    className: 'text-center',
    render: (w) => (
      <>
        {w.projectedEndMonth ? formatMonth(w.projectedEndMonth) : '—'}
        <span className={sub}>{w.curveMonths ? `${w.curveMonths} meses` : ''}</span>
      </>
    ),
  },
  {
    key: 'progress',
    label: 'Avanço ac. / mês',
    detail: true,
    className: 'text-right',
    render: (w) => <Progress progress={w.progress} />,
  },
  {
    key: 'status',
    label: 'Status cliente',
    detail: true,
    className: 'text-center',
    total: (t) =>
      t.delayedWorks > 0 ? <span className="text-error">{t.delayedWorks} atrasada(s)</span> : '',
    render: (w) => <ClientStatus progress={w.progress} />,
  },
  {
    key: 'feeProjected',
    label: 'Taxa prevista',
    detail: true,
    className: 'text-right',
    total: (t) => formatCurrency(t.feeProjected),
    render: (w) => formatCurrency(w.feeProjected),
  },
  {
    key: 'feeRealized',
    label: 'Recebida',
    detail: true,
    className: 'text-right',
    total: (t) => formatCurrency(t.feeRealized),
    render: (w) => formatCurrency(w.feeRealized),
  },
  {
    key: 'feeAtReference',
    label: 'Taxa mês',
    className: 'text-right font-medium',
    total: (t) => formatCurrency(t.feeAtReference),
    render: (w) => formatCurrency(w.feeAtReference),
  },
  {
    key: 'feeRemaining',
    label: 'A receber',
    className: 'text-right text-text-muted',
    total: (t) => formatCurrency(t.feeRemaining),
    render: (w) => formatCurrency(w.feeRemaining),
  },
  {
    key: 'recalibration',
    label: 'Ajuste projeção taxa',
    className: 'bg-primary-soft/40 border-r',
    headClassName: 'bg-primary text-white border-r',
    total: (t) => (t.recalibratedWorks > 0 ? `${t.recalibratedWorks} ajustada(s)` : ''),
    render: (w, ctx) => (
      <FeeRecalibrationCell work={w} referenceMonth={ctx.referenceMonth} canEdit={ctx.canEdit} />
    ),
  },
];

const monthClass = (m: Month) =>
  m.isReference ? 'bg-cell-current-period text-primary' : 'bg-ink-50';

function HeaderRows({ data, columns }: { data: ConsolidatedDto; columns: PanelColumn[] }) {
  const t = data.totals;
  const rows: { label: string; value: (m: Month) => string; strong?: boolean }[] = [
    { label: 'Taxa no mês', value: (m) => formatCurrency(m.feeTotal), strong: true },
    { label: 'Acumulado no ano', value: (m) => formatCurrency(m.feeYearToDate) },
    { label: 'Qtd. obras ativas', value: (m) => String(m.activeWorks) },
  ];
  const frozenHead = 'z-30 bg-ink-900 text-left font-semibold uppercase text-white';

  return (
    <thead>
      <tr>
        <th data-frozen className={cn(COL_CLIENT, HEAD_ROW_TOP[0], headCell, 'h-12', frozenHead)}>
          Cliente
        </th>
        <th data-frozen className={cn(COL_WORK, HEAD_ROW_TOP[0], headCell, 'h-12', frozenHead)}>
          Obra
        </th>
        <th
          data-frozen
          className={cn(COL_SERIES, HEAD_ROW_TOP[0], headCell, 'h-12 border-ink-700', frozenHead)}
        >
          Série
        </th>
        {columns.map((c) => (
          <th
            key={c.key}
            className={cn(
              'sticky z-20 h-12 min-w-28 bg-ink-900 text-center text-[11px] font-semibold uppercase leading-tight text-white',
              HEAD_ROW_TOP[0],
              headCell,
              c.key === 'recalibration' && 'min-w-48',
              c.headClassName,
            )}
          >
            {c.label}
          </th>
        ))}
        {data.months.map((m) => (
          <th
            key={m.month}
            data-month={m.month}
            className={cn(
              'sticky z-20 h-12 min-w-32 whitespace-nowrap text-right font-semibold',
              HEAD_ROW_TOP[0],
              headCell,
              monthClass(m),
            )}
          >
            {m.label}
          </th>
        ))}
      </tr>
      {rows.map((row, r) => {
        const top = HEAD_ROW_TOP[r + 1];
        return (
          <tr key={row.label}>
            <th
              colSpan={3}
              className={cn(
                'sticky left-0 z-30 h-9 border-r bg-ink-50 text-left whitespace-nowrap',
                top,
                headCell,
                row.strong ? 'font-semibold text-text' : 'font-medium text-text-muted',
              )}
            >
              {row.label}
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'sticky z-20 h-9 bg-ink-50 font-semibold whitespace-nowrap tabular',
                  top,
                  headCell,
                  c.className?.includes('text-center') ? 'text-center' : 'text-right',
                  c.key === 'recalibration' && 'border-r text-text-muted',
                )}
              >
                {r === 0 ? c.total?.(t) : null}
              </th>
            ))}
            {data.months.map((m) => (
              <th
                key={m.month}
                className={cn(
                  'sticky z-20 h-9 text-right whitespace-nowrap tabular',
                  top,
                  headCell,
                  monthClass(m),
                  row.strong ? 'font-semibold text-text' : 'font-normal text-text-muted',
                )}
              >
                {row.value(m)}
              </th>
            ))}
          </tr>
        );
      })}
    </thead>
  );
}

const WorkRows = memo(function WorkRows({
  work,
  months,
  columns,
  referenceMonth,
  canEdit,
}: {
  work: ConsolidatedWorkDto;
  months: Month[];
  columns: PanelColumn[];
  referenceMonth: string;
  canEdit: boolean;
}) {
  const physical = useMemo(() => new Map(work.physical.map((c) => [c.month, c])), [work.physical]);
  const fee = useMemo(() => new Map(work.fee.map((c) => [c.month, c])), [work.fee]);
  const series = [
    { key: 'physical', label: 'Avanço físico', cells: physical, format: formatPercent },
    { key: 'fee', label: 'Taxa (R$)', cells: fee, format: formatCurrency },
  ] as const;
  const late = work.progress.clientStatus === 'ATRASADA';
  const frozenBody =
    'border-b border-border bg-surface px-3 py-1.5 align-middle group-hover:bg-ink-50';

  return (
    <>
      {series.map((s, i) => (
        <tr key={s.key} className="group">
          {i === 0 && (
            <>
              <td rowSpan={2} className={cn(COL_CLIENT, frozenBody, 'font-semibold')}>
                <span className="block truncate" title={work.clientName}>
                  {work.clientName}
                </span>
              </td>
              <td rowSpan={2} className={cn(COL_WORK, frozenBody)}>
                <Link
                  to={`/obras/${work.workId}`}
                  className="block truncate font-medium hover:text-primary"
                  title={work.name}
                >
                  {work.name}
                </Link>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={CURVE_SOURCE[work.curveSource].tone}>
                    {CURVE_SOURCE[work.curveSource].label}
                  </Badge>
                  {(work.isStale || work.needsRecalc) && (
                    <Badge tone="warning">{work.isStale ? 'Revisar ajustes' : 'Recalcular'}</Badge>
                  )}
                </div>
              </td>
            </>
          )}
          <td
            className={cn(
              COL_SERIES,
              'h-9 border-b border-border bg-surface px-3 text-xs whitespace-nowrap text-text-muted group-hover:bg-ink-50',
            )}
          >
            {s.label}
          </td>
          {i === 0 &&
            columns.map((c) => (
              <td
                key={c.key}
                rowSpan={2}
                className={cn(
                  panelCell,
                  'tabular',
                  c.className,
                  c.key === 'status' && late && 'bg-error-soft/60',
                )}
              >
                {c.render(work, { referenceMonth, canEdit })}
              </td>
            ))}
          {months.map((m) => {
            const cell = s.cells.get(m.month);
            const manual = cell?.origin === 'MANUAL';
            return (
              <td
                key={m.month}
                title={manual ? 'Ajuste manual' : undefined}
                className={cn(
                  bodyCell,
                  'tabular group-hover:bg-ink-50',
                  s.key === 'physical' ? 'text-text-muted' : 'font-medium',
                  manual && 'bg-cell-manual',
                  m.isReference && !manual && 'bg-cell-current-period/60',
                )}
              >
                {cell && !ZERO.test(cell.value) ? s.format(cell.value) : ''}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
});

/**
 * Consolidado: works on Y (panel columns + two series each), months on X, portfolio totals in
 * the frozen header. `showDetails = false` keeps only the fee columns before the months.
 */
export function ConsolidatedGrid({
  data,
  canEdit,
  showDetails,
  scrollRef,
}: {
  data: ConsolidatedDto;
  canEdit: boolean;
  showDetails: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const columns = useMemo(
    () => PANEL_COLUMNS.filter((c) => showDetails || !c.detail),
    [showDetails],
  );
  return (
    <div
      ref={scrollRef}
      className="relative max-h-[75vh] overflow-auto rounded-card border border-border bg-surface"
    >
      <table className="tabular border-separate border-spacing-0 text-sm">
        <HeaderRows data={data} columns={columns} />
        <tbody>
          {data.works.map((w) => (
            <WorkRows
              key={w.workId}
              work={w}
              months={data.months}
              columns={columns}
              referenceMonth={data.referenceMonth}
              canEdit={canEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
