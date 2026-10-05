import { useDeferredValue, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReferenceMonthInput, toReferenceDate } from '@/components/forms/ReferenceMonthInput';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { scrollToMonth } from '@/hooks/useScrollToMonth';
import { formatMonth } from '@/utils/format';
import { useAuth } from '@/features/auth/useAuth';
import { errorMessage } from '@/services/api/client';
import { ConsolidatedGrid } from './ConsolidatedGrid';
import { ConsolidatedKpis } from './ConsolidatedKpis';
import { InccPanel } from './InccPanel';
import { useConsolidated } from './hooks';

const INCC_PREF = 'unita.consolidado.incc';

/** Browser storage may be unavailable (private mode, blocked): preferences are best effort. */
function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * "Consolidado": the "Painel de obras" columns and the month-by-month projection (physical
 * progress and fee) in one grid, like the "Painel (2)" sheet.
 */
export function ConsolidatedPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  // Panel columns are shown by default; ?painel=0 keeps only the fee columns before the months.
  const showDetails = params.get('painel') !== '0';
  const toggleDetails = () =>
    setParams(
      (p) => {
        if (showDetails) p.set('painel', '0');
        else p.delete('painel');
        return p;
      },
      { replace: true },
    );
  // INCC panel visibility is remembered per browser (hidden = more room for the grid).
  const [showIncc, setShowIncc] = useState(() => readPreference(INCC_PREF) !== 'hidden');
  const toggleIncc = () =>
    setShowIncc((v) => {
      writePreference(INCC_PREF, v ? 'hidden' : 'visible');
      return !v;
    });
  const gridRef = useRef<HTMLDivElement>(null);
  const [reference, setReference] = useState('');
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q.trim());
  const query = useConsolidated({
    referenceDate: toReferenceDate(reference),
    q: deferredQ || undefined,
  });
  const data = query.data;
  const needsAttention = data?.works.filter((w) => w.isStale || w.needsRecalc).length ?? 0;
  const referenceMonth = data?.referenceMonth;

  // Compact view opens on the reference month; with the panel columns it opens on the panel.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || !referenceMonth) return;
    if (showDetails) el.scrollTo({ left: 0 });
    else scrollToMonth(el, referenceMonth);
  }, [referenceMonth, showDetails, data?.works.length]);

  return (
    <>
      <PageHeader
        title="Consolidado"
        description="Carteira de obras: dados cadastrados, avanço e status vindos da API, taxa emitida no mês, INCC e a projeção mês a mês de cada obra."
      />
      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
        <Input
          className="h-9 max-w-64"
          placeholder="Filtrar obra ou cliente…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filtrar"
        />
        <ReferenceMonthInput value={reference} onChange={setReference} />
        {data && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleIncc}
              aria-expanded={showIncc}
              aria-controls="painel-incc"
            >
              {showIncc ? 'Ocultar INCC' : 'Mostrar INCC'}
            </Button>
            <Button variant="secondary" size="sm" onClick={toggleDetails}>
              {showDetails ? 'Ocultar colunas do painel' : 'Mostrar colunas do painel'}
            </Button>
            {showDetails && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => gridRef.current?.scrollTo({ left: 0, behavior: 'smooth' })}
              >
                Ir para o painel
              </Button>
            )}
            <Button
              size="sm"
              onClick={() =>
                gridRef.current && scrollToMonth(gridRef.current, data.referenceMonth, 2, 'smooth')
              }
            >
              Ir para {formatMonth(data.referenceMonth)}
            </Button>
          </div>
        )}
      </div>

      {query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-[60vh]" />
        </div>
      ) : query.isError || !data ? (
        <Alert tone="error">{errorMessage(query.error)}</Alert>
      ) : data.works.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma obra com projeção"
            description="Cadastre obras para ver o consolidado da carteira."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <ConsolidatedKpis data={data} />
          {showIncc && (
            <div id="painel-incc">
              <InccPanel referenceMonth={data.referenceMonth} canEdit={can('EDITOR')} />
            </div>
          )}
          {needsAttention > 0 && (
            <Alert tone="warning">
              {needsAttention} obra(s) com projeção desatualizada em relação à curva em vigor. Veja
              a aba “Curvas das obras” para sincronizar.
            </Alert>
          )}
          <ConsolidatedGrid
            data={data}
            canEdit={can('EDITOR')}
            showDetails={showDetails}
            scrollRef={gridRef}
          />
          <p className="text-xs text-text-muted">
            Cada obra ocupa duas linhas — avanço físico e taxa — com os meses no eixo horizontal;
            coluna destacada = mês de referência, células em amarelo = ajuste manual e em verde =
            taxa emitida. Início = primeiro mês da curva própria da obra (API; * = sem curva
            própria, início da projeção). Término = mês em que a curva atinge 100%. Avanço =
            Realizado Acumulado da API. Status cliente = Atrasada quando o Replanejado Atual
            Acumulado - Cliente é menor que a Meta Acumulada - Atual. “Recebida” soma a taxa até a
            referência (inclusive); “A receber”, os meses seguintes. A taxa é recebida no mês
            seguinte ao avanço (competência M−1). Taxa emitida = valor faturado em{' '}
            {formatMonth(data.referenceMonth)}; a partir da primeira emissão, o saldo a receber é
            corrigido pelo INCC do mês anterior e projetado pela curva nos meses seguintes (cada
            alteração gera nova versão da projeção).
          </p>
        </div>
      )}
    </>
  );
}
