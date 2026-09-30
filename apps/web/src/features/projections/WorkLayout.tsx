import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { WorkDto } from '@unita/contracts';
import { Alert, Badge, Skeleton } from '@/components/ui';
import { useWork } from '@/features/works/hooks';
import { WORK_STATUS } from '@/features/works/status';
import { errorMessage } from '@/services/api/client';
import { cn } from '@/utils/cn';

const SECTIONS = [
  { to: '', label: 'Projeção', end: true },
  { to: 'informacoes', label: 'Informações da obra' },
  { to: 'curva', label: 'Curva' },
  { to: 'historico', label: 'Histórico' },
  { to: 'configuracoes', label: 'Configurações' },
];

export function useWorkContext(): WorkDto {
  return useOutletContext<WorkDto>();
}

/** Work shell with the sidebar required by spec §17. Collapses to tabs on small screens. */
export function WorkLayout() {
  const { id } = useParams();
  const work = useWork(id);

  if (work.isLoading) return <Skeleton className="h-[70vh]" />;
  if (work.isError || !work.data) return <Alert tone="error">{errorMessage(work.error)}</Alert>;
  const w = work.data;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-60 lg:shrink-0">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            {w.client.name}
          </p>
          <h1 className="text-xl font-semibold leading-tight">{w.name}</h1>
          <Badge tone={WORK_STATUS[w.status].tone} className="mt-2">
            {WORK_STATUS[w.status].label}
          </Badge>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Seções da obra">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.label}
              to={s.to}
              end={s.end}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-soft text-primary lg:border-l-2 lg:border-primary'
                    : 'text-ink-600 hover:bg-ink-100',
                )
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 flex-1">
        <Outlet context={w} />
      </section>
    </div>
  );
}
