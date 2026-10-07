import type { CurveSource, WorkCurveStatus } from '@unita/contracts';
import type { Tone } from '@/components/ui';

export const CURVE_STATUS: Record<WorkCurveStatus, { label: string; hint: string; tone: Tone }> = {
  NOT_STARTED: {
    label: 'Não iniciada',
    hint: 'Usa a curva paramétrica até o mês de início.',
    tone: 'neutral',
  },
  STARTED_ACTUAL: {
    label: 'Curva própria',
    hint: 'Obra iniciada: realizado da API até o mês atual e tendência nos meses seguintes (sem realizado: replanejado da obra).',
    tone: 'success',
  },
  STARTED_AWAITING_ACTUAL: {
    label: 'Aguardando API',
    hint: 'Obra iniciada sem curva própria: usa a paramétrica provisoriamente.',
    tone: 'warning',
  },
};

export const CURVE_SOURCE: Record<CurveSource, { label: string; tone: Tone }> = {
  PARAMETRIC: { label: 'Paramétrica', tone: 'neutral' },
  WORK_ACTUAL: { label: 'Curva própria', tone: 'success' },
};
