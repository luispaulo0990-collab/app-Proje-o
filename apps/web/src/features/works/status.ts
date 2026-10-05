import type { WorkStatus } from '@unita/contracts';
import type { Tone } from '@/components/ui';

export const WORK_STATUS: Record<WorkStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  NOT_STARTED: { label: 'Não iniciada', tone: 'primary' },
  ACTIVE: { label: 'Ativa', tone: 'success' },
  COMPLETED: { label: 'Concluída', tone: 'info' },
  ARCHIVED: { label: 'Arquivada', tone: 'warning' },
};
