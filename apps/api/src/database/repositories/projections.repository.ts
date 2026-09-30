import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import type { ProjectionCell, Series } from '@unita/engine';
import type { Db } from '../client.js';
import { projectionValues, projections, users } from '../schema/index.js';

export type ProjectionRow = typeof projections.$inferSelect;
export type ProjectionValueRow = typeof projectionValues.$inferSelect;

export const projectionsRepository = {
  async findCurrent(db: Db, workId: string) {
    const [row] = await db
      .select({ projection: projections, createdBy: users.name })
      .from(projections)
      .leftJoin(users, eq(users.id, projections.createdById))
      .where(and(eq(projections.workId, workId), eq(projections.isCurrent, true)));
    return row;
  },

  async getValues(db: Db, projectionId: string): Promise<ProjectionValueRow[]> {
    return db
      .select()
      .from(projectionValues)
      .where(eq(projectionValues.projectionId, projectionId))
      .orderBy(asc(projectionValues.series), asc(projectionValues.periodIndex));
  },

  /** Current projections and their values for many works (consolidated / grid views). */
  async findCurrentByWorks(db: Db, workIds: readonly string[]) {
    const result = new Map<string, { projection: ProjectionRow; values: ProjectionValueRow[] }>();
    if (workIds.length === 0) return result;
    const rows = await db
      .select()
      .from(projections)
      .where(and(inArray(projections.workId, [...workIds]), eq(projections.isCurrent, true)));
    if (rows.length === 0) return result;
    const values = await db
      .select()
      .from(projectionValues)
      .where(
        inArray(
          projectionValues.projectionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(projectionValues.series), asc(projectionValues.periodIndex));
    const byProjection = new Map<string, ProjectionValueRow[]>();
    for (const v of values) {
      const list = byProjection.get(v.projectionId) ?? [];
      list.push(v);
      byProjection.set(v.projectionId, list);
    }
    for (const r of rows)
      result.set(r.workId, { projection: r, values: byProjection.get(r.id) ?? [] });
    return result;
  },

  async listVersions(db: Db, workId: string) {
    return db
      .select({ projection: projections, createdBy: users.name })
      .from(projections)
      .leftJoin(users, eq(users.id, projections.createdById))
      .where(eq(projections.workId, workId))
      .orderBy(desc(projections.version));
  },

  async nextVersion(db: Db, workId: string): Promise<number> {
    const [row] = await db
      .select({ value: max(projections.version) })
      .from(projections)
      .where(eq(projections.workId, workId));
    return (row?.value ?? 0) + 1;
  },

  async markStale(db: Db, workId: string) {
    await db
      .update(projections)
      .set({ isStale: true })
      .where(and(eq(projections.workId, workId), eq(projections.isCurrent, true)));
  },

  /** Creates a new immutable version and makes it the current one. */
  async createVersion(
    db: Db,
    data: {
      workId: string;
      curveVersionId: string;
      curveSource: 'PARAMETRIC' | 'WORK_ACTUAL';
      workActualCurveId: string | null;
      parameters: Record<string, unknown>;
      note: string | null;
      createdById: string | null;
    },
    cells: { series: Series; cells: ProjectionCell[] }[],
  ): Promise<ProjectionRow> {
    const version = await this.nextVersion(db, data.workId);
    await db
      .update(projections)
      .set({ isCurrent: false })
      .where(and(eq(projections.workId, data.workId), eq(projections.isCurrent, true)));
    const [row] = await db
      .insert(projections)
      .values({ ...data, version, isCurrent: true, isStale: false })
      .returning();
    if (!row) throw new Error('Falha ao criar versão da projeção');

    const values = cells.flatMap(({ series, cells: list }) =>
      list.map((c) => ({
        projectionId: row.id,
        series,
        periodIndex: c.periodIndex,
        periodMonth: c.month,
        originalValue: c.original,
        currentValue: c.current,
        origin: c.origin,
      })),
    );
    // Chunked insert keeps statements below the Postgres parameter limit on long schedules.
    for (let i = 0; i < values.length; i += 1000) {
      await db.insert(projectionValues).values(values.slice(i, i + 1000));
    }
    return row;
  },
};

export async function workHasManualHistory(db: Db, workId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projections.id })
    .from(projectionValues)
    .innerJoin(projections, eq(projections.id, projectionValues.projectionId))
    .where(and(eq(projections.workId, workId), eq(projectionValues.origin, 'MANUAL')))
    .limit(1);
  return Boolean(row);
}
