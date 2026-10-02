import type { CurveSyncReportDto } from '@unita/contracts';
import { Alert, Badge, Button, Card, CardHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { cn } from '@/utils/cn';
import { formatCurrency, formatDateTime, formatMonth, formatNumber } from '@/utils/format';
import { useGraphCurveSync, useIntegrationStatus } from './hooks';

const OUTCOME: Record<
  CurveSyncReportDto['items'][number]['outcome'],
  { label: string; tone: 'success' | 'neutral' | 'info' | 'error' }
> = {
  IMPORTED: { label: 'Importada', tone: 'success' },
  WOULD_IMPORT: { label: 'Seria importada', tone: 'info' },
  UNCHANGED: { label: 'Sem alteração', tone: 'neutral' },
  REJECTED: { label: 'Rejeitada', tone: 'error' },
};

/** Import of own curves from "Consolidado Físico - Obras.xlsx" (sheet BD_Infos Gerais). */
export function GraphSyncPanel() {
  const { can } = useAuth();
  const status = useIntegrationStatus();
  const sync = useGraphCurveSync();
  const graph = status.data?.microsoftGraph;
  if (!graph) return null;
  const report = sync.data;

  return (
    <Card>
      <CardHeader
        title="Importar do SharePoint (BD Físico geral)"
        description={
          graph.configured
            ? `${graph.description}. Obras casadas pelo nome cadastrado no sistema.`
            : 'Integração não configurada no servidor (variáveis MS_GRAPH_* — ver README).'
        }
        actions={
          graph.configured &&
          can('EDITOR') && (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={sync.isPending && sync.variables === true}
                disabled={sync.isPending}
                onClick={() => sync.mutate(true)}
              >
                Simular
              </Button>
              <Button
                size="sm"
                loading={sync.isPending && sync.variables === false}
                disabled={sync.isPending}
                onClick={() => sync.mutate(false)}
              >
                Importar curvas e IEC
              </Button>
            </>
          )
        }
      />
      {sync.isError && (
        <Alert tone="error" className="m-4">
          {errorMessage(sync.error)}
        </Alert>
      )}
      {report && <SyncReport report={report} />}
    </Card>
  );
}

function SyncReport({ report }: { report: CurveSyncReportDto }) {
  const t = report.totals;
  return (
    <div className="space-y-4 p-5 text-sm">
      <p className="text-text-muted">
        {report.dryRun ? 'Simulação' : 'Importação'} em {formatDateTime(report.readAt)} ·{' '}
        {t.sheetWorks} obra(s) na planilha · {t.matched} casada(s) ·{' '}
        {report.dryRun ? `${t.imported} seriam importadas` : `${t.imported} importada(s)`} ·{' '}
        {t.unchanged} sem alteração · {t.rejected} rejeitada(s) · {t.withIndicators} com indicadores
        do Consolidado (realizado / replanejado cliente / meta)
      </p>

      {report.unmatched.length > 0 && (
        <Alert
          tone="warning"
          title="Obras da planilha que não foram casadas com nenhuma obra cadastrada"
        >
          {report.unmatched.map((u) => u.sheetName).join(' · ')}
        </Alert>
      )}
      {report.missingInSheet.length > 0 && (
        <Alert tone="info" title="Obras cadastradas que não estão na planilha">
          {report.missingInSheet.map((w) => w.workName).join(' · ')}
        </Alert>
      )}

      {report.items.length > 0 && (
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-text-muted">
            <tr>
              <th className="py-1.5">Obra</th>
              <th>Resultado</th>
              <th>Início</th>
              <th className="text-right">Meses</th>
              <th className="text-right">Versão</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.items.map((i) => (
              <tr key={i.workId}>
                <td className="py-1.5">
                  <p className="font-medium">{i.workName}</p>
                  {i.match === 'APPROXIMATE' && (
                    <p
                      className="text-xs text-warning"
                      title="Nome diferente na planilha — confira"
                    >
                      planilha: {i.sheetName}
                    </p>
                  )}
                </td>
                <td>
                  <Badge tone={OUTCOME[i.outcome].tone}>{OUTCOME[i.outcome].label}</Badge>
                </td>
                <td className="tabular">{i.startMonth ? formatMonth(i.startMonth) : '—'}</td>
                <td className="tabular text-right">{i.periods ?? '—'}</td>
                <td className="tabular text-right">{i.version ? `V${i.version}` : '—'}</td>
                <td className="text-xs text-text-muted">
                  {i.issues.map((x) => x.message).join(' ') ||
                    (i.projection === 'MARKED_STALE'
                      ? 'Projeção com ajustes manuais: revisar em Recalcular.'
                      : i.projection === 'NOT_IN_FORCE'
                        ? 'Obra ainda não iniciada: vale a paramétrica.'
                        : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.readIssues.length > 0 && (
        <p className="text-xs text-warning">
          {report.readIssues.length} linha(s) ignorada(s) na planilha:{' '}
          {report.readIssues
            .slice(0, 5)
            .map((r) => `linha ${r.row} (${r.message})`)
            .join('; ')}
        </p>
      )}
      {report.economic && <EconomicReport economic={report.economic} dryRun={report.dryRun} />}
    </div>
  );
}

const ECONOMIC_OUTCOME: Record<
  NonNullable<CurveSyncReportDto['economic']>['items'][number]['outcome'],
  { label: string; tone: 'success' | 'neutral' | 'info' }
> = {
  SAVED: { label: 'Gravado', tone: 'success' },
  WOULD_SAVE: { label: 'Seria gravado', tone: 'info' },
  UNCHANGED: { label: 'Sem alteração', tone: 'neutral' },
};

/** "IEC Obra" read from BD_Econômico in the same run. */
function EconomicReport({
  economic,
  dryRun,
}: {
  economic: NonNullable<CurveSyncReportDto['economic']>;
  dryRun: boolean;
}) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="font-medium">IEC Obra — {economic.description}</p>
      <p className="text-text-muted">
        {economic.sheetWorks} obra(s) na aba · {economic.items.length} casada(s) ·{' '}
        {dryRun ? `${economic.saved} seriam gravadas` : `${economic.saved} gravada(s)`} ·{' '}
        {economic.unchanged} sem alteração
      </p>
      {economic.unmatched.length > 0 && (
        <Alert tone="warning" title="Obras do BD_Econômico sem obra cadastrada">
          {economic.unmatched.join(' · ')}
        </Alert>
      )}
      {economic.items.length > 0 && (
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-text-muted">
            <tr>
              <th className="py-1.5">Obra</th>
              <th>Resultado</th>
              <th>Último fechamento</th>
              <th className="text-right">IEC</th>
              <th className="text-right">Resultado projetado</th>
              <th className="text-right">Meses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {economic.items.map((i) => (
              <tr key={i.workId}>
                <td className="py-1.5">
                  <p className="font-medium">{i.workName}</p>
                  {i.match === 'APPROXIMATE' && (
                    <p className="text-xs text-warning">planilha: {i.sheetName}</p>
                  )}
                </td>
                <td>
                  <Badge tone={ECONOMIC_OUTCOME[i.outcome].tone}>
                    {ECONOMIC_OUTCOME[i.outcome].label}
                  </Badge>
                </td>
                <td className="tabular">{i.lastMonth ? formatMonth(i.lastMonth) : '—'}</td>
                <td className="tabular text-right">
                  {i.lastIec === null ? '—' : formatNumber(i.lastIec, 2)}
                </td>
                <td
                  className={cn(
                    'tabular text-right',
                    i.lastProjectedResult?.startsWith('-') && 'text-error',
                  )}
                >
                  {formatCurrency(i.lastProjectedResult)}
                </td>
                <td className="tabular text-right">{i.months}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {economic.readIssues.length > 0 && (
        <p className="text-xs text-warning">
          {economic.readIssues
            .slice(0, 5)
            .map((r) => (r.row > 0 ? `linha ${r.row} (${r.message})` : r.message))
            .join('; ')}
        </p>
      )}
    </div>
  );
}
