import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { ConsolidatedDto, ConsolidatedWorkDto } from '@unita/contracts';
import { Badge } from '@/components/ui';
import { cn } from '@/utils/cn';
import {
  formatCurrency,
  formatDateTime,
  formatMonth,
  formatNumber,
  formatPercent,
} from '@/utils/format';
import { FeeRecalibrationCell } from './FeeRecalibrationCell';

/*
 * "Painel de obras": one line per work with the columns of the spreadsheet. Every figure
 * comes from the API (engine); this component only formats.
 */
const COL_CLIENT = 'sticky left-0 z-10 w-32 min-w-32 max-w-32';
const COL_WORK = 'sticky left-32 z-10 w-48 min-w-48 max-w-48 border-r';
const head =
  'sticky top-0 z-20 h-11 border-b border-border bg-ink-900 px-3 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-white';
const cell = 'border-b border-border px-3 py-2 align-middle';
const sub = 'block text-[11px] leading-4 text-text-muted';

function signedPercent(fraction: string | null): string {
  if (fraction === null) return '—';
  const text = formatPercent(fraction, 1);
  return fraction.startsWith('-') || /^0(\.0+)?$/.test(fraction) ? text : `+${text}`;
}

function ClientStatus({ progress }: { progress: ConsolidatedWorkDto['progress'] }) {
  if (progress.clientStatus === 'SEM_DADOS') {
    return (
      <span title="Sem Replanejado Cliente / Meta Acumulada até o mês de referência">
        <Badge>Sem dados</Badge>
      </span>
    );
  }
  const late = progress.clientStatus === 'ATRASADA';
  const title =
    `Replanejado cliente ${formatPercent(progress.clientReplannedCumulative, 1)} × ` +
    `meta ${formatPercent(progress.targetCumulative, 1)}` +
    (progress.statusMonth ? ` (${formatMonth(progress.statusMonth)})` : '');
  return (
    <span title={title} className="inline-flex flex-col items-center">
      <Badge tone={late ? 'error' : 'success'}>{late ? 'Atrasada' : 'OK'}</Badge>
      <span className={cn('tabular text-[11px]', late ? 'text-error' : 'text-text-muted')}>
        {signedPercent(progress.deviation)}
      </span>
    </span>
  );
}

function Progress({ progress }: { progress: ConsolidatedWorkDto['progress'] }) {
  if (progress.realizedCumulative === null) {
    return (
      <span className="text-text-muted" title="Realizado Acumulado ainda não recebido da API">
        —<span className={sub}>Aguardando API</span>
      </span>
    );
  }
  const title =
    `Realizado acumulado em ${formatMonth(progress.realizedMonth ?? '')}` +
    (progress.updatedAt ? ` · ${progress.source ?? ''} ${formatDateTime(progress.updatedAt)}` : '');
  return (
    <span title={title}>
      <span className="font-medium">{formatPercent(progress.realizedCumulative, 1)}</span>
      <span className={sub}>
        {progress.realizedMonthly === null ? '—' : formatPercent(progress.realizedMonthly, 1)} no
        mês
      </span>
    </span>
  );
}

const Row = memo(function Row({
  work,
  referenceMonth,
  canEdit,
}: {
  work: ConsolidatedWorkDto;
  referenceMonth: string;
  canEdit: boolean;
}) {
  const late = work.progress.clientStatus === 'ATRASADA';
  return (
    <tr className="group">
      <td className={cn(COL_CLIENT, cell, 'bg-surface font-semibold group-hover:bg-ink-50')}>
        <span className="block truncate" title={work.clientName}>
          {work.clientName}
        </span>
      </td>
      <td className={cn(COL_WORK, cell, 'bg-surface group-hover:bg-ink-50')}>
        <Link
          to={`/obras/${work.workId}`}
          className="block truncate font-medium hover:text-primary"
          title={work.name}
        >
          {work.name}
        </Link>
        {(work.isStale || work.needsRecalc) && (
          <Badge tone="warning" className="mt-0.5">
            {work.isStale ? 'Revisar ajustes' : 'Recalcular'}
          </Badge>
        )}
      </td>
      <td className={cn(cell, 'text-right tabular')}>{formatCurrency(work.budget)}</td>
      <td className={cn(cell, 'text-right tabular')}>{formatNumber(work.units)}</td>
      <td className={cn(cell, 'text-center tabular')}>
        <span
          title={
            work.startSource === 'API'
              ? 'Primeiro mês da curva própria da obra (API)'
              : 'Obra sem curva própria: início da projeção paramétrica'
          }
        >
          {formatMonth(work.startMonth)}
          {work.startSource === 'PROJECTION' && <span className="text-text-muted">*</span>}
        </span>
        <span className={sub}>{work.monthsIncurred} meses</span>
      </td>
      <td className={cn(cell, 'text-center tabular')}>
        {work.projectedEndMonth ? formatMonth(work.projectedEndMonth) : '—'}
        <span className={sub}>{work.curveMonths ? `${work.curveMonths} meses` : ''}</span>
      </td>
      <td className={cn(cell, 'text-right tabular')}>
        <Progress progress={work.progress} />
      </td>
      <td className={cn(cell, 'text-center', late && 'bg-error-soft/60')}>
        <ClientStatus progress={work.progress} />
      </td>
      <td className={cn(cell, 'text-right font-medium tabular')}>
        {formatCurrency(work.feeAtReference)}
      </td>
      <td className={cn(cell, 'text-right tabular text-text-muted')}>
        {formatCurrency(work.feeRemaining)}
      </td>
      <td className={cn(cell, 'bg-primary-soft/40')}>
        <FeeRecalibrationCell work={work} referenceMonth={referenceMonth} canEdit={canEdit} />
      </td>
    </tr>
  );
});

/** Portfolio table with the columns of the "Painel de obras" spreadsheet. */
export function ConsolidatedPanelTable({
  data,
  canEdit,
}: {
  data: ConsolidatedDto;
  canEdit: boolean;
}) {
  const ref = formatMonth(data.referenceMonth);
  const t = data.totals;
  const headers = [
    { label: 'Orçamento raso', className: 'min-w-36' },
    { label: 'UH', className: 'min-w-16' },
    { label: 'Início de obra / meses incorridos', className: 'min-w-32' },
    { label: 'Término projetado / duração', className: 'min-w-32' },
    { label: 'Avanço ac. / mês', className: 'min-w-28' },
    { label: 'Status cliente', className: 'min-w-28' },
    { label: `Taxa mês (${ref})`, className: 'min-w-32' },
    { label: 'Taxa a receber', className: 'min-w-36' },
    { label: 'Ajuste projeção taxa', className: 'min-w-48 bg-primary text-white' },
  ];
  return (
    <div className="relative max-h-[70vh] overflow-auto rounded-card border border-border bg-surface">
      <table className="tabular w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(COL_CLIENT, head, 'z-30 text-left')}>Cliente</th>
            <th className={cn(COL_WORK, head, 'z-30 border-ink-700 text-left')}>Obra</th>
            {headers.map((h) => (
              <th key={h.label} className={cn(head, h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.works.map((w) => (
            <Row key={w.workId} work={w} referenceMonth={data.referenceMonth} canEdit={canEdit} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className={cn(COL_CLIENT, cell, 'sticky bottom-0 z-20 bg-ink-100')}>Total</td>
            <td className={cn(COL_WORK, cell, 'sticky bottom-0 z-20 bg-ink-100 text-text-muted')}>
              {t.worksCount} obras
            </td>
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100 text-right')}>
              {formatCurrency(t.budgetTotal)}
            </td>
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100 text-right')}>
              {formatNumber(t.unitsTotal)}
            </td>
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100')} colSpan={3} />
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100 text-center text-error')}>
              {t.delayedWorks > 0 ? `${t.delayedWorks} atrasada(s)` : ''}
            </td>
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100 text-right')}>
              {formatCurrency(t.feeAtReference)}
            </td>
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100 text-right')}>
              {formatCurrency(t.feeRemaining)}
            </td>
            <td className={cn(cell, 'sticky bottom-0 bg-ink-100 text-right text-text-muted')}>
              {t.recalibratedWorks > 0 ? `${t.recalibratedWorks} ajustada(s)` : ''}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
