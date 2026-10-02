import type { ProjectionCellDto } from '@unita/contracts';

/** Highlight of grid cells that did not come from the curve (single source for every grid). */
export const CELL_ORIGIN: Partial<
  Record<ProjectionCellDto['origin'], { title: string; className: string }>
> = {
  MANUAL: { title: 'Ajuste manual', className: 'bg-cell-manual' },
  ISSUED: { title: 'Taxa emitida no mês', className: 'bg-cell-issued' },
};
