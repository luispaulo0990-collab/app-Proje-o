import { useState } from 'react';
import { Alert, Button, Card, CardHeader, EmptyState, TableSkeleton } from '@/components/ui';
import { useWorkAudit } from '@/features/works/hooks';
import { errorMessage } from '@/services/api/client';
import { formatDateTime } from '@/utils/format';
import { useWorkContext } from './WorkLayout';

const ACTIONS: Record<string, string> = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  EDIT_CELL: 'Ajuste manual',
  RESET_CELL: 'Ajuste removido',
  RECALCULATE: 'Recálculo',
  FEE_ISSUANCE: 'Taxa emitida',
  FEE_ISSUANCE_REMOVED: 'Taxa emitida removida',
  FEE_RECALIBRATION: 'Ajuste de taxa (antigo)',
  FEE_RECALIBRATION_CLEARED: 'Ajuste de taxa removido (antigo)',
  PROJECTION_STALE: 'Projeção desatualizada',
  ARCHIVE: 'Arquivamento',
  DELETE: 'Exclusão',
};

export function WorkHistoryPage() {
  const w = useWorkContext();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useWorkAudit(w.id, page);

  return (
    <Card>
      <CardHeader
        title="Histórico de alterações"
        description="Toda alteração relevante fica registrada com usuário, data, valor anterior e novo valor."
      />
      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : isError ? (
        <Alert tone="error" className="m-4">
          {errorMessage(error)}
        </Alert>
      ) : !data?.items.length ? (
        <EmptyState title="Sem registros" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                {['Data/hora', 'Usuário', 'Ação', 'Campo', 'Anterior', 'Novo', 'Origem'].map(
                  (h) => (
                    <th key={h} className="px-4 py-3">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-text-muted">
                    {formatDateTime(a.createdAt)}
                  </td>
                  <td className="px-4 py-2">{a.user ?? 'Sistema'}</td>
                  <td className="px-4 py-2">{ACTIONS[a.action] ?? a.action}</td>
                  <td className="px-4 py-2">{a.field ?? '—'}</td>
                  <td className="tabular px-4 py-2">{a.oldValue ?? '—'}</td>
                  <td className="tabular px-4 py-2">{a.newValue ?? '—'}</td>
                  <td className="px-4 py-2">{a.origin ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </Card>
  );
}
