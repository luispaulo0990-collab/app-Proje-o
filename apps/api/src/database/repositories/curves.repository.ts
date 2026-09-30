import { and, asc, count, desc, eq, ilike, inArray, isNull, max, type SQL } from 'drizzle-orm';
import type { CurvePoint } from '@unita/engine';
import type { Db } from '../client.js';
import { curvePoints, curveVersions, curves, users, works } from '../schema/index.js';

export type CurveRow = typeof curves.$inferSelect;
export type CurveVersionRow = typeof curveVersions.$inferSelect;

export const curvesRepository = {
  async list(db: Db, filter: { status?: CurveRow['status']; q?: string }) {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(curves.status, filter.status));
    if (filter.q) conditions.push(ilike(curves.name, `%${filter.q}%`));

    const latest = db
      .select({
        curveId: curveVersions.curveId,
        version: max(curveVersions.version).as('latest_version'),
      })
      .from(curveVersions)
      .groupBy(curveVersions.curveId)
      .as('latest');

    return db
      .select({ curve: curves, version: curveVersions })
      .from(curves)
      .innerJoin(latest, eq(latest.curveId, curves.id))
      .innerJoin(
        curveVersions,
        and(eq(curveVersions.curveId, curves.id), eq(curveVersions.version, latest.version)),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(curves.name));
  },

  async findById(db: Db, id: string): Promise<CurveRow | undefined> {
    const [row] = await db.select().from(curves).where(eq(curves.id, id));
    return row;
  },

  async listVersions(db: Db, curveId: string): Promise<CurveVersionRow[]> {
    return db
      .select()
      .from(curveVersions)
      .where(eq(curveVersions.curveId, curveId))
      .orderBy(desc(curveVersions.version));
  },

  async findVersion(db: Db, curveId: string, version: number) {
    const [row] = await db
      .select({ version: curveVersions, createdBy: users.name })
      .from(curveVersions)
      .leftJoin(users, eq(users.id, curveVersions.createdById))
      .where(and(eq(curveVersions.curveId, curveId), eq(curveVersions.version, version)));
    return row;
  },

  async findVersionById(db: Db, versionId: string) {
    const [row] = await db
      .select({ version: curveVersions, curve: curves })
      .from(curveVersions)
      .innerJoin(curves, eq(curves.id, curveVersions.curveId))
      .where(eq(curveVersions.id, versionId));
    return row;
  },

  /** Points of many curve versions in one query, keyed by version id. */
  async getPointsByVersions(
    db: Db,
    versionIds: readonly string[],
  ): Promise<Map<string, CurvePoint[]>> {
    const result = new Map<string, CurvePoint[]>();
    if (versionIds.length === 0) return result;
    const rows = await db
      .select()
      .from(curvePoints)
      .where(inArray(curvePoints.curveVersionId, [...new Set(versionIds)]))
      .orderBy(asc(curvePoints.curveVersionId), asc(curvePoints.period));
    for (const r of rows) {
      const list = result.get(r.curveVersionId) ?? [];
      list.push({ period: r.period, monthlyPct: r.monthlyPct, cumulativePct: r.cumulativePct });
      result.set(r.curveVersionId, list);
    }
    return result;
  },

  async getPoints(db: Db, versionId: string): Promise<CurvePoint[]> {
    const rows = await db
      .select()
      .from(curvePoints)
      .where(eq(curvePoints.curveVersionId, versionId))
      .orderBy(asc(curvePoints.period));
    return rows.map((r) => ({
      period: r.period,
      monthlyPct: r.monthlyPct,
      cumulativePct: r.cumulativePct,
    }));
  },

  async countWorksUsingVersion(db: Db, versionId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(works)
      .where(and(eq(works.curveVersionId, versionId), isNull(works.deletedAt)));
    return row?.value ?? 0;
  },

  async countWorksUsingVersions(db: Db, versionIds: string[]): Promise<number> {
    if (versionIds.length === 0) return 0;
    const [row] = await db
      .select({ value: count() })
      .from(works)
      .where(and(inArray(works.curveVersionId, versionIds), isNull(works.deletedAt)));
    return row?.value ?? 0;
  },

  async create(db: Db, data: Pick<CurveRow, 'name' | 'description' | 'type'>): Promise<CurveRow> {
    const [row] = await db.insert(curves).values(data).returning();
    if (!row) throw new Error('Falha ao criar curva');
    return row;
  },

  async update(
    db: Db,
    id: string,
    data: Partial<Pick<CurveRow, 'name' | 'description' | 'status'>>,
  ) {
    const [row] = await db.update(curves).set(data).where(eq(curves.id, id)).returning();
    return row;
  },

  async touch(db: Db, id: string) {
    await db.update(curves).set({ updatedAt: new Date() }).where(eq(curves.id, id));
  },

  /** Versions are append-only: this is the only write path for points. */
  async createVersion(
    db: Db,
    data: { curveId: string; version: number; notes: string | null; createdById: string | null },
    points: CurvePoint[],
  ): Promise<CurveVersionRow> {
    const [row] = await db
      .insert(curveVersions)
      .values({ ...data, periods: points.length })
      .returning();
    if (!row) throw new Error('Falha ao criar versão da curva');
    await db.insert(curvePoints).values(
      points.map((p) => ({
        curveVersionId: row.id,
        period: p.period,
        monthlyPct: p.monthlyPct,
        cumulativePct: p.cumulativePct,
      })),
    );
    return row;
  },
};
