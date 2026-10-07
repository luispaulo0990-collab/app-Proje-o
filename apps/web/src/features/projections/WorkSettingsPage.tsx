import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, CardHeader, ConfirmDialog } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { useWorkAction } from '@/features/works/hooks';
import { errorMessage } from '@/services/api/client';
import { useWorkContext } from './WorkLayout';

export function WorkSettingsPage() {
  const w = useWorkContext();
  const { can } = useAuth();
  const navigate = useNavigate();
  const action = useWorkAction();
  const [confirm, setConfirm] = useState<'archive' | 'remove' | null>(null);

  const run = async (kind: 'duplicate' | 'archive' | 'remove') => {
    try {
      const result = await action.mutateAsync({ id: w.id, action: kind });
      setConfirm(null);
      if (kind === 'duplicate' && result)
        navigate(`/obras/${(result as { id: string }).id}/editar`);
      if (kind === 'remove') navigate('/obras');
    } catch {
      setConfirm(null); // error rendered from action.error
    }
  };

  return (
    <div className="space-y-5">
      {action.isError && <Alert tone="error">{errorMessage(action.error)}</Alert>}
      <Card>
        <CardHeader
          title="Parâmetros de cálculo"
          description="Taxa inicial, correção pelo INCC, curva e cronograma são editados no cadastro da obra; mudanças de taxa ao longo do tempo ficam na aba Taxa e INCC."
        />
        <div className="flex flex-wrap gap-2 p-5">
          {can('EDITOR') && (
            <Button variant="secondary" onClick={() => navigate(`/obras/${w.id}/editar`)}>
              Editar cadastro
            </Button>
          )}
        </div>
      </Card>
      {can('EDITOR') && (
        <Card>
          <CardHeader title="Ações" />
          <div className="flex flex-wrap gap-2 p-5">
            <Button
              variant="secondary"
              onClick={() => void run('duplicate')}
              loading={action.isPending}
            >
              Duplicar obra
            </Button>
            {w.status !== 'ARCHIVED' && (
              <Button variant="secondary" onClick={() => setConfirm('archive')}>
                Arquivar
              </Button>
            )}
            {can('ADMIN') && (
              <Button variant="danger" onClick={() => setConfirm('remove')}>
                Excluir
              </Button>
            )}
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'remove' ? 'Excluir obra?' : 'Arquivar obra?'}
        actions={
          confirm
            ? [
                {
                  label: confirm === 'remove' ? 'Excluir' : 'Arquivar',
                  variant: confirm === 'remove' ? 'danger' : 'primary',
                  onClick: () => void run(confirm),
                  loading: action.isPending,
                },
              ]
            : []
        }
      >
        {confirm === 'remove'
          ? 'A exclusão só é permitida para obras sem ajustes manuais no histórico.'
          : 'A obra sai da listagem padrão; histórico e projeções são mantidos.'}
      </ConfirmDialog>
    </div>
  );
}
