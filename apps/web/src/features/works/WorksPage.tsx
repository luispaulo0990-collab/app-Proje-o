import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { WorkDto } from '@unita/contracts';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  TableSkeleton,
} from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '@/utils/format';
import { useWorkAction, useWorks } from './hooks';
import { WORK_STATUS } from './status';

const PAGE_SIZE = 25;
type PendingAction = { work: WorkDto; action: 'archive' | 'remove' } | null;

export function WorksPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<PendingAction>(null);
  const { data, isLoading, isError, error, isFetching } = useWorks({
    q,
    status: status || undefined,
    includeArchived,
    page,
    pageSize: PAGE_SIZE,
  });
  const action = useWorkAction();

  const run = async (work: WorkDto, kind: 'duplicate' | 'archive' | 'remove') => {
    const result = await action.mutateAsync({ id: work.id, action: kind });
    setPending(null);
    if (kind === 'duplicate' && result) navigate(`/obras/${(result as WorkDto).id}/editar`);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Obras"
        description="Cadastro de obras e acesso às projeções físico-financeiras."
        actions={
          can('EDITOR') && <Button onClick={() => navigate('/obras/nova')}>Nova obra</Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Input
            placeholder="Buscar por obra ou cliente…"
            className="max-w-xs"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="Buscar"
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="max-w-44"
            aria-label="Status"
          >
            <option value="">Todos os status</option>
            {Object.entries(WORK_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="accent-primary"
            />
            Incluir arquivadas
          </label>
          {isFetching && !isLoading && (
            <span className="text-xs text-text-muted">Atualizando…</span>
          )}
        </div>

        {action.isError && (
          <Alert tone="error" className="m-4">
            {errorMessage(action.error)}
          </Alert>
        )}
        {isLoading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : isError ? (
          <Alert tone="error" className="m-4">
            {errorMessage(error)}
          </Alert>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="Nenhuma obra encontrada"
            description="Cadastre a primeira obra para gerar a projeção automaticamente a partir de uma curva."
            action={
              can('EDITOR') && <Button onClick={() => navigate('/obras/nova')}>Nova obra</Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                <tr>
                  {[
                    'Obra',
                    'Cliente',
                    'UH',
                    'Orçamento',
                    'Taxa',
                    'Sistema construtivo',
                    'Curva',
                    'Início',
                    'Duração',
                    'Término',
                    'Status',
                    'Atualizada',
                    '',
                  ].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((w) => (
                  <tr key={w.id} className="hover:bg-ink-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link to={`/obras/${w.id}`} className="hover:text-primary">
                        {w.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{w.client.name}</td>
                    <td className="tabular px-4 py-3 text-right">{formatNumber(w.units)}</td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-right">
                      {formatCurrency(w.budget)}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{formatPercent(w.feeRate)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{w.constructionSystem}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {w.curve.name} <span className="text-text-muted">V{w.curve.version}</span>
                    </td>
                    <td className="tabular px-4 py-3">{formatDate(w.startDate)}</td>
                    <td className="tabular whitespace-nowrap px-4 py-3">
                      {w.durationMonths} meses
                    </td>
                    <td className="tabular px-4 py-3">{formatDate(w.endDate)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={WORK_STATUS[w.status].tone}>{WORK_STATUS[w.status].label}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                      {formatDateTime(w.updatedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/obras/${w.id}`)}
                        >
                          Ver
                        </Button>
                        {can('EDITOR') && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/obras/${w.id}/editar`)}
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void run(w, 'duplicate')}
                            >
                              Duplicar
                            </Button>
                            {w.status !== 'ARCHIVED' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPending({ work: w, action: 'archive' })}
                              >
                                Arquivar
                              </Button>
                            )}
                          </>
                        )}
                        {can('ADMIN') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-error"
                            onClick={() => setPending({ work: w, action: 'remove' })}
                          >
                            Excluir
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-text-muted">{data.total} obras</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.action === 'remove' ? 'Excluir obra?' : 'Arquivar obra?'}
        actions={
          pending
            ? [
                {
                  label: pending.action === 'remove' ? 'Excluir' : 'Arquivar',
                  variant: pending.action === 'remove' ? 'danger' : 'primary',
                  loading: action.isPending,
                  onClick: () =>
                    void run(pending.work, pending.action).catch(() => setPending(null)),
                },
              ]
            : []
        }
      >
        {pending?.action === 'remove'
          ? `"${pending.work.name}" será removida. Obras com ajustes manuais no histórico não podem ser excluídas — arquive-as.`
          : `"${pending?.work.name}" deixará de aparecer na listagem padrão. O histórico é mantido.`}
      </ConfirmDialog>
    </>
  );
}
