import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Badge, Button, Card, EmptyState, TableSkeleton } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { formatDateTime } from '@/utils/format';
import { useCurves } from './hooks';

export function CurvesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useCurves();

  return (
    <>
      <PageHeader
        title="Curvas paramétricas"
        description="Modelos de distribuição do avanço físico. Cada alteração gera uma nova versão; obras mantêm a versão que utilizam."
        actions={
          can('ADMIN') && <Button onClick={() => navigate('/curvas/nova')}>Nova curva</Button>
        }
      />
      <Card>
        {isLoading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : isError ? (
          <Alert tone="error" className="m-4">
            {errorMessage(error)}
          </Alert>
        ) : !data?.items.length ? (
          <EmptyState
            title="Nenhuma curva cadastrada"
            description="Cadastre uma curva para poder criar obras."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3">Curva</th>
                <th className="px-4 py-3">Versão atual</th>
                <th className="px-4 py-3">Períodos</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Atualizada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((c) => (
                <tr key={c.id} className="hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <Link to={`/curvas/${c.id}`} className="font-medium hover:text-primary">
                      {c.name}
                    </Link>
                    {c.description && <p className="text-xs text-text-muted">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3">V{c.latestVersion}</td>
                  <td className="tabular px-4 py-3">{c.periods} meses</td>
                  <td className="px-4 py-3">
                    <Badge tone={c.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {c.status === 'ACTIVE' ? 'Ativa' : 'Arquivada'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{formatDateTime(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
