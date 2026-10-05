import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/services/api/endpoints';

/** Login mode served by the API: local passwords or Supabase Auth (no sign-up screen). */
export function useAuthConfig() {
  return useQuery({ queryKey: ['auth', 'config'], queryFn: authApi.config, staleTime: Infinity });
}
