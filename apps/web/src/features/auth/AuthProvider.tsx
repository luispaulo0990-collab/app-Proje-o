import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginBody, RegisterBody, Role, UserDto } from '@unita/contracts';
import { refreshSession, session } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';

type Status = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: Status;
  user: UserDto | null;
  login: (body: LoginBody) => Promise<void>;
  register: (body: RegisterBody) => Promise<void>;
  logout: () => Promise<void>;
  can: (minimum: Role) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<UserDto | null>(null);

  const apply = useCallback((data: AuthResponse | null) => {
    session.set(data?.accessToken ?? null);
    setUser(data?.user ?? null);
    setStatus(data ? 'authenticated' : 'anonymous');
  }, []);

  // Persistent session: the HttpOnly refresh cookie restores the user on reload.
  useEffect(() => {
    let active = true;
    refreshSession().then((data) => active && apply(data));
    session.onExpired(() => {
      apply(null);
      queryClient.clear();
    });
    return () => {
      active = false;
    };
  }, [apply, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (body) => apply(await authApi.login(body)),
      register: async (body) => apply(await authApi.register(body)),
      logout: async () => {
        await authApi.logout().catch(() => undefined);
        apply(null);
        queryClient.clear();
      },
      can: (minimum) => (user ? RANK[user.role] >= RANK[minimum] : false),
    }),
    [status, user, apply, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
