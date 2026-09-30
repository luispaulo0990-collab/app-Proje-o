import { NavLink, Outlet } from 'react-router-dom';
import logoWhite from '@/assets/brand/logo-unita-white.png';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { cn } from '@/utils/cn';

const ROLE_LABEL = { ADMIN: 'Administrador', EDITOR: 'Editor', VIEWER: 'Visualizador' } as const;

export function AppShell() {
  const { user, logout } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-control px-3 py-1.5 text-sm font-medium transition-colors',
      isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:text-white',
    );

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b-2 border-primary bg-secondary">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
          <NavLink to="/obras" aria-label="Início">
            <img src={logoWhite} alt="Unità Engenharia" className="h-7" />
          </NavLink>
          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Principal">
            <NavLink to="/obras" className={link}>
              Obras
            </NavLink>
            <NavLink to="/curvas" className={link}>
              Curvas
            </NavLink>
            <NavLink to="/consolidado" className={link}>
              Consolidado
            </NavLink>
            <NavLink to="/curvas-obras" className={link}>
              Curvas das obras
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-white">{user.name}</p>
                <p className="text-xs text-ink-400">{ROLE_LABEL[user.role]}</p>
              </div>
            )}
            <Button variant="inverse" size="sm" onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
