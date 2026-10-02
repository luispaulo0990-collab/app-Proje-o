import type { ConsolidatedWorkDto } from '@unita/contracts';
import { Badge } from '@/components/ui';
import { cn } from '@/utils/cn';
import {
  formatCurrency,
  formatDateTime,
  formatMonth,
  formatNumber,
  formatPercent,
} from '@/utils/format';

/* Cells of the Consolidado that only format values computed by the API (engine). */
export const sub = 'block text-[11px] leading-4 text-text-muted';

export function signedPercent(fraction: string | null, digits = 1): string {
  if (fraction === null) return '—';
  const text = formatPercent(fraction, digits);
  return fraction.startsWith('-') || /^0(\.0+)?$/.test(fraction) ? text : `+${text}`;
}

export function ClientStatus({ progress }: { progress: ConsolidatedWorkDto['progress'] }) {
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

export function Progress({ progress }: { progress: ConsolidatedWorkDto['progress'] }) {
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

/** "IEC Obra": index of the latest economic closing ≤ reference, with the projected result. */
export function EconomicIndex({ economic }: { economic: ConsolidatedWorkDto['economic'] }) {
  if (economic.month === null) {
    return (
      <span
        className="text-text-muted"
        title="Fechamento econômico (BD_Econômico) ainda não recebido"
      >
        —<span className={sub}>Aguardando API</span>
      </span>
    );
  }
  const loss = economic.projectedResult?.startsWith('-') ?? false;
  const title =
    `IEC Obra do fechamento de ${formatMonth(economic.month)}` +
    (economic.updatedAt ? ` · ${economic.source ?? ''} ${formatDateTime(economic.updatedAt)}` : '');
  return (
    <span title={title}>
      <span className="font-medium">
        {economic.iec === null ? '—' : formatNumber(economic.iec, 2)}
      </span>
      <span className={cn(sub, loss && 'text-error')}>
        {economic.projectedResult === null ? '—' : formatCurrency(economic.projectedResult)}
      </span>
    </span>
  );
}
