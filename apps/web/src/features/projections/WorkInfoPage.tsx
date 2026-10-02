import { useNavigate } from 'react-router-dom';
import { Button, Card, CardHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/utils/format';
import { useWorkContext } from './WorkLayout';

export function WorkInfoPage() {
  const w = useWorkContext();
  const { can } = useAuth();
  const navigate = useNavigate();
  const rows: [string, string][] = [
    ['Nome', w.name],
    ['Cliente', w.client.name],
    ['Unidades (UH)', formatNumber(w.units)],
    ['Orçamento raso', formatCurrency(w.budget)],
    ['Taxa de administração', formatPercent(w.feeRate)],
    ['Taxa total prevista', formatCurrency(w.feeTotal)],
    ['Recebimento da taxa', 'Mês seguinte ao avanço (competência M−1)'],
    ['Sistema construtivo', w.constructionSystem],
    ['Curva', `${w.curve.name} — V${w.curve.version}`],
    ['Data inicial', formatDate(w.startDate)],
    ['Duração', `${w.durationMonths} meses`],
    ['Data final (calculada)', formatDate(w.endDate)],
  ];
  return (
    <Card>
      <CardHeader
        title="Informações da obra"
        actions={
          can('EDITOR') && (
            <Button variant="secondary" onClick={() => navigate(`/obras/${w.id}/editar`)}>
              Editar
            </Button>
          )
        }
      />
      <dl className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{k}</dt>
            <dd className="tabular mt-0.5 font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
