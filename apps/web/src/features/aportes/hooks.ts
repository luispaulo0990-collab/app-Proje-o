import { useQuery } from '@tanstack/react-query';
import { aportesApi } from '@/services/api/endpoints';

/** Read live from the workbook on every visit; "Atualizar" refetches. */
export const useAportes = () =>
  useQuery({ queryKey: ['aportes'], queryFn: aportesApi.get, staleTime: 60_000 });
