import { useState } from 'react';
import { Button, ConfirmDialog } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { useRecalculate } from './hooks';

/**
 * Recalculation flow (spec §15): first asks the API how many manual cells exist (dryRun);
 * with manual cells the user chooses to preserve or replace them — never silent overwrite.
 */
export function RecalculateButton({ workId }: { workId: string }) {
  const recalc = useRecalculate(workId);
  const [manualCount, setManualCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const impact = await recalc.mutateAsync({ mode: 'PRESERVE_MANUAL', dryRun: true });
      const count = 'dryRun' in impact ? impact.manualCount : 0;
      if (count === 0) await recalc.mutateAsync({ mode: 'REPLACE_MANUAL' });
      else setManualCount(count);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const run = async (mode: 'PRESERVE_MANUAL' | 'REPLACE_MANUAL') => {
    try {
      await recalc.mutateAsync({ mode });
      setManualCount(null);
    } catch (err) {
      setManualCount(null);
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => void start()}
        loading={recalc.isPending && manualCount === null}
      >
        Recalcular
      </Button>
      {error && <span className="text-sm text-error">{error}</span>}
      <ConfirmDialog
        open={manualCount !== null}
        onClose={() => setManualCount(null)}
        title="Existem ajustes manuais"
        actions={[
          {
            label: 'Recalcular preservando ajustes',
            variant: 'primary',
            onClick: () => void run('PRESERVE_MANUAL'),
            loading: recalc.isPending,
          },
          {
            label: 'Substituir ajustes',
            variant: 'danger',
            onClick: () => void run('REPLACE_MANUAL'),
            loading: recalc.isPending,
          },
        ]}
      >
        Existem {manualCount} valores ajustados manualmente. Deseja recalcular utilizando a curva e
        substituir esses ajustes, ou preservá-los redistribuindo o saldo nos demais meses? Em ambos
        os casos uma nova versão da projeção é criada.
      </ConfirmDialog>
    </>
  );
}
