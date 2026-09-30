import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@unita/contracts';
import { Spinner } from '@/components/ui';
import { useAuth } from './useAuth';

export function ProtectedRoute({ minimum = 'VIEWER' }: { minimum?: Role }) {
  const { status, can } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-primary">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (status === 'anonymous')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!can(minimum)) return <Navigate to="/obras" replace />;
  return <Outlet />;
}

/** Keeps authenticated users away from login/register pages. */
export function GuestRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/obras" replace />;
  return <Outlet />;
}
