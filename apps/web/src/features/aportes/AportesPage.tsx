import type { AporteCompany, AportesDto } from '@unita/contracts';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format';
import { useAportes } from './hooks';

const COMPANY: Record<AporteCompany, { label: string; tone: 'primary' | 'info' | 'warning' }> = {
  JOY: { label: 'Joy+', tone: 'primary' },
  UNITA: { label: 'Unità', tone: 'info' },
  OTHER: { label: 'Não identificada', tone: 'warning' },
};

/** "Aportes": contributions made up to today — Joy+ (transfers) and investors (Recebidas). */
export function AportesPage() {
  const query = useAportes();
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Aportes"
        description="Aportes feitos até hoje, lidos da planilha BD´s_JOY_EVANS (SharePoint): Joy+ pelas Transferências Bancárias para a empresa 73 e investidores pela tabela Recebidas."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />
      {query.isLoading ? (
        <Skeleton className="h-[60vh]" />
      ) : query.isError || !data ? (
        <Alert tone="error">{errorMessage(query.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <Summary data={data} />
          {data.issues.length > 0 && (
            <Alert tone="warning" title={`Apontamentos (${data.issues.length})`}>
              <ul className="list-disc space-y-0.5 pl-5">
                {data.issues.map((i, n) => (
                  <li key={n}>
                    <span className="font-medium">{i.source}:</span> {i.message}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            <TransfersTable data={data} />
            <ReceiptsTable data={data} />
          </div>
          <p className="text-xs text-text-muted">
            Posição até {formatDate(data.asOf)} · lido em {formatDateTime(data.readAt)}
          </p>
        </div>
      )}
    </>
  );
}

function Summary({ data }: { data: AportesDto }) {
  const t = data.totals;
  const by = t.joyByCompany;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Kpi label="Aportes Joy+" value={t.joy}>
        <span>Joy+ {formatCurrency(by.JOY)}</span>
        <span>Unità {formatCurrency(by.UNITA)}</span>
        {by.OTHER !== '0.00' && (
          <span className="text-warning">Não identificada {formatCurrency(by.OTHER)}</span>
        )}
      </Kpi>
      <Kpi label="Aportes investidores" value={t.investors}>
        <span>{data.receipts.length} recebimento(s)</span>
      </Kpi>
      <Kpi label="Joy+ e investidores" value={t.total} highlight>
        <span>Total aportado até {formatDate(data.asOf)}</span>
      </Kpi>
    </div>
  );
}

function Kpi({
  label,
  value,
  highlight,
  children,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className={highlight ? 'border-primary px-5 py-4' : 'px-5 py-4'}>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{formatCurrency(value)}</p>
      <div className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {children}
      </div>
    </Card>
  );
}

const th = 'whitespace-nowrap px-4 py-3';
const td = 'whitespace-nowrap px-4 py-2.5';

function TransfersTable({ data }: { data: AportesDto }) {
  return (
    <Card>
      <CardHeader
        title="Joy+ — Transferências Bancárias"
        description="Empresa_tb diferente de 73 e EmpresaCred_tb = 73."
      />
      {data.transfers.length === 0 ? (
        <EmptyState title="Nenhuma transferência até hoje" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th className={th}>Data</th>
                <th className={th}>Empresa</th>
                <th className={th}>Doc.</th>
                <th className={th}>Observação</th>
                <th className={`${th} text-right`}>Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.transfers.map((t, i) => (
                <tr
                  key={i}
                  className={t.company === 'OTHER' ? 'bg-warning-soft' : 'hover:bg-ink-50'}
                >
                  <td className={`tabular ${td}`}>{formatDate(t.date)}</td>
                  <td className={td}>
                    <Badge tone={COMPANY[t.company].tone}>
                      {COMPANY[t.company].label}
                      {t.company === 'OTHER' && ` (${t.companyCode})`}
                    </Badge>
                  </td>
                  <td className={td}>{t.document}</td>
                  <td className={`${td} max-w-64 truncate`} title={t.note}>
                    {t.note}
                  </td>
                  <td className={`tabular ${td} text-right`}>{formatCurrency(t.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ReceiptsTable({ data }: { data: AportesDto }) {
  return (
    <Card>
      <CardHeader
        title="Investidores — Recebidas"
        description="Valor líquido de cada parcela recebida."
      />
      {data.receipts.length === 0 ? (
        <EmptyState title="Nenhum recebimento até hoje" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th className={th}>Data</th>
                <th className={th}>Receb. / Parc.</th>
                <th className={th}>Objeto</th>
                <th className={`${th} text-right`}>Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.receipts.map((r, i) => (
                <tr key={i} className="hover:bg-ink-50">
                  <td className={`tabular ${td}`}>{formatDate(r.date)}</td>
                  <td className={`tabular ${td}`}>
                    {r.receipt} / {r.installment}
                  </td>
                  <td className={`${td} max-w-72 truncate`} title={`${r.payer} — ${r.description}`}>
                    {r.description}
                  </td>
                  <td className={`tabular ${td} text-right`}>{formatCurrency(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
