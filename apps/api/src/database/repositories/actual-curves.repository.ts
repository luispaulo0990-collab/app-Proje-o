import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import type { CurvePoint } from '@unita/engine';
import type { Db } from '../client.js';
import { users, workActualCurvePoints, workActualCurves } from '../schema/index.js';

export type ActualCurveRow = typeof workActualCurves.$inferSelect;
export type ActualCurveWithPoints = ActualCurveRow & { points: CurvePoint[] };

function toPoint(p: typeof workActualCurvePoints.$inferSelect): CurvePoint {
  return { period: p.period, monthlyPct: p.monthlyPct, cumulativePct: p.cumulativePct };
}

export const actualCurvesRepository = {
  async findCurrent(db: Db, workId: string): Promise<ActualCurveWithPoints | undefined> {
    const [row] = await db
      .select()
      .from(workActualCurves)
      .where(and(eq(workActualCurves.workId, workId), eq(workActualCurves.isCurrent, true)));
    if (!row) return undefined;
    const points = await db
      .select()
      .from(workActualCurvePoints)
      .where(eq(workActualCurvePoints.actualCurveId, row.id))
      .orderBy(asc(workActualCurvePoints.period));
    return { ...row, points: points.map(toPoint) };
  },

  /** Current own curves of many works in two queries (grid / consolidated views). */
  async findCurrentByWorks(
    db: Db,
    workIds: readonly string[],
  ): Promise<Map<string, ActualCurveWithPoints>> {
    const result = new Map<string, ActualCurveWithPoints>();
    if (workIds.length === 0) return result;
    const rows = await db
      .select()
      .from(workActualCurves)
      .where(
        and(inArray(workActualCurves.workId, [...workIds]), eq(workActualCurves.isCurrent, true)),
      );
    if (rows.length === 0) return result;
    const points = await db
      .select()
      .from(workActualCurvePoints)
      .where(
        inArray(
          workActualCurvePoints.actualCurveId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(workActualCurvePoints.actualCurveId), asc(workActualCurvePoints.period));
    const byCurve = new Map<string, CurvePoint[]>();
    for (const p of points) {
      const list = byCurve.get(p.actualCurveId) ?? [];
      list.push(toPoint(p));
      byCurve.set(p.actualCurveId, list);
    }
    for (const r of rows) result.set(r.workId, { ...r, points: byCurve.get(r.id) ?? [] });
    return result;
  },

  async listVersions(db: Db, workId: string) {
    return db
      .select({ curve: workActualCurves, createdBy: users.name })
      .from(workActualCurves)
      .leftJoin(users, eq(users.id, workActualCurves.createdById))
      .where(eq(workActualCurves.workId, workId))
      .orderBy(desc(workActualCurves.version));
  },

  /** Creates an immutable new version and makes it current. */
  async createVersion(
    db: Db,
    data: {
      workId: string;
      startMonth: string;
      source: string;
      externalRef: string | null;
      note: string | null;
      receivedVia: 'USER' | 'API_KEY';
      createdById: string | null;
    },
    points: readonly CurvePoint[],
  ): Promise<ActualCurveRow> {
    const [last] = await db
      .select({ value: max(workActualCurves.version) })
      .from(workActualCurves)
      .where(eq(workActualCurves.workId, data.workId));
    const version = (last?.value ?? 0) + 1;
    await db
      .update(workActualCurves)
      .set({ isCurrent: false })
      .where(and(eq(workActualCurves.workId, data.workId), eq(workActualCurves.isCurrent, true)));
    const [row] = await db
      .insert(workActualCurves)
      .values({ ...data, version, periods: points.length, isCurrent: true })
      .returning();
    if (!row) throw new Error('Falha ao gravar curva própria');
    await db.insert(workActualCurvePoints).values(
      points.map((p) => ({
        actualCurveId: row.id,
        period: p.period,
        monthlyPct: p.monthlyPct,
        cumulativePct: p.cumulativePct,
      })),
    );
    return row;
  },
};
