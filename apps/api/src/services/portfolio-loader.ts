import type { CurvePoint, EffectiveCurve } from '@unita/engine';
import type { Db } from '../database/client.js';
import {
  actualCurvesRepository,
  type ActualCurveWithPoints,
} from '../database/repositories/actual-curves.repository.js';
import {
  progressIndicatorsRepository,
  toProgressEntry,
} from '../database/repositories/consolidated-inputs.repository.js';
import { curvesRepository } from '../database/repositories/curves.repository.js';
import {
  projectionsRepository,
  type ProjectionRow,
  type ProjectionValueRow,
} from '../database/repositories/projections.repository.js';
import {
  worksRepository,
  type WorkWithRelations,
} from '../database/repositories/works.repository.js';
import {
  projectionNeedsRecalc,
  resolveWorkCurve,
} from '../modules/projections/projections.service.js';
import { currentMonth } from '../utils/dates.js';

export interface PortfolioEntry {
  work: WorkWithRelations;
  parametric: CurvePoint[];
  actual: ActualCurveWithPoints | null;
  /** Curve in force at the requested reference month. */
  effective: EffectiveCurve;
  projection: { row: ProjectionRow; values: ProjectionValueRow[] } | null;
  /** Current projection was generated with another curve than the one in force today. */
  needsRecalc: boolean;
}

/**
 * Loads every work of the portfolio with its curves and current projection using a fixed
 * number of queries (no N+1), then resolves the curve in force for each work.
 */
export async function loadPortfolio(
  db: Db,
  filter: { includeArchived?: boolean; q?: string },
  referenceMonth: string,
): Promise<PortfolioEntry[]> {
  const works = await worksRepository.listAll(db, filter);
  const ids = works.map((w) => w.work.id);
  const [parametricByVersion, actualByWork, projectionByWork, realizedByWork] = await Promise.all([
    curvesRepository.getPointsByVersions(
      db,
      works.map((w) => w.work.curveVersionId),
    ),
    actualCurvesRepository.findCurrentByWorks(db, ids),
    projectionsRepository.findCurrentByWorks(db, ids),
    progressIndicatorsRepository.listByWorks(db, ids),
  ]);
  const today = currentMonth();

  return Promise.all(
    works.map(async (w) => {
      const parametric = parametricByVersion.get(w.work.curveVersionId) ?? [];
      const actual = actualByWork.get(w.work.id) ?? null;
      const realized = (realizedByWork.get(w.work.id) ?? []).map(toProgressEntry);
      const preloaded = { parametric, actual, realized };
      const { effective } = await resolveWorkCurve(db, w.work, referenceMonth, preloaded);
      const inForce =
        referenceMonth === today
          ? effective
          : (await resolveWorkCurve(db, w.work, today, preloaded)).effective;
      const current = projectionByWork.get(w.work.id);
      return {
        work: w,
        parametric,
        actual,
        effective,
        projection: current ? { row: current.projection, values: current.values } : null,
        needsRecalc: current ? projectionNeedsRecalc(current.projection, inForce, actual) : false,
      };
    }),
  );
}
