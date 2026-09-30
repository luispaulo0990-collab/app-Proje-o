import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { ProgressEntry } from '@unita/engine';
import type { Db } from '../client.js';
import { feeRecalibrations, users, workProgressIndicators } from '../schema/index.js';

export type ProgressIndicatorRow = typeof workProgressIndicators.$inferSelect;
export type FeeRecalibrationRow = typeof feeRecalibrations.$inferSelect;

export const toProgressEntry = (r: ProgressIndicatorRow): ProgressEntry => ({
  month: r.month,
  realizedCumulative: r.realizedCumulative,
  clientReplannedCumulative: r.clientReplannedCumulative,
  targetCumulative: r.targetCumulative,
});

export const progressIndicatorsRepository = {
  async listByWork(db: Db, workId: string): Promise<ProgressIndicatorRow[]> {
    return db
      .select()
      .from(workProgressIndicators)
      .where(eq(workProgressIndicators.workId, workId))
      .orderBy(asc(workProgressIndicators.month));
  },

  /** Indicators of many works in one query (Consolidado). */
  async listByWorks(
    db: Db,
    workIds: readonly string[],
  ): Promise<Map<string, ProgressIndicatorRow[]>> {
    const result = new Map<string, ProgressIndicatorRow[]>();
    if (workIds.length === 0) return result;
    const rows = await db
      .select()
      .from(workProgressIndicators)
      .where(inArray(workProgressIndicators.workId, [...workIds]))
      .orderBy(asc(workProgressIndicators.workId), asc(workProgressIndicators.month));
    for (const r of rows) {
      const list = result.get(r.workId) ?? [];
      list.push(r);
      result.set(r.workId, list);
    }
    return result;
  },

  /** Replaces every row of the work (a sync always carries the full history). */
  async replace(
    db: Db,
    workId: string,
    meta: {
      source: string;
      externalRef: string | null;
      receivedVia: 'USER' | 'API_KEY';
      updatedById: string | null;
    },
    entries: readonly ProgressEntry[],
  ): Promise<void> {
    await db.delete(workProgressIndicators).where(eq(workProgressIndicators.workId, workId));
    if (entries.length === 0) return;
    await db.insert(workProgressIndicators).values(
      entries.map((e) => ({
        workId,
        month: e.month,
        realizedCumulative: e.realizedCumulative ?? null,
        clientReplannedCumulative: e.clientReplannedCumulative ?? null,
        targetCumulative: e.targetCumulative ?? null,
        ...meta,
      })),
    );
  },
};

export const feeRecalibrationsRepository = {
  async findCurrent(db: Db, workId: string): Promise<FeeRecalibrationRow | undefined> {
    const [row] = await db
      .select()
      .from(feeRecalibrations)
      .where(and(eq(feeRecalibrations.workId, workId), eq(feeRecalibrations.isCurrent, true)));
    return row;
  },

  async findCurrentByWorks(
    db: Db,
    workIds: readonly string[],
  ): Promise<Map<string, FeeRecalibrationRow & { createdBy: string | null }>> {
    const result = new Map<string, FeeRecalibrationRow & { createdBy: string | null }>();
    if (workIds.length === 0) return result;
    const rows = await db
      .select({ r: feeRecalibrations, createdBy: users.name })
      .from(feeRecalibrations)
      .leftJoin(users, eq(users.id, feeRecalibrations.createdById))
      .where(
        and(inArray(feeRecalibrations.workId, [...workIds]), eq(feeRecalibrations.isCurrent, true)),
      );
    for (const { r, createdBy } of rows) result.set(r.workId, { ...r, createdBy });
    return result;
  },

  async listByWork(db: Db, workId: string) {
    return db
      .select({ r: feeRecalibrations, createdBy: users.name })
      .from(feeRecalibrations)
      .leftJoin(users, eq(users.id, feeRecalibrations.createdById))
      .where(eq(feeRecalibrations.workId, workId))
      .orderBy(desc(feeRecalibrations.createdAt));
  },

  /** Clears the current recalibration (keeps it as history). */
  async clearCurrent(db: Db, workId: string): Promise<FeeRecalibrationRow | undefined> {
    const [row] = await db
      .update(feeRecalibrations)
      .set({ isCurrent: false, clearedAt: new Date() })
      .where(and(eq(feeRecalibrations.workId, workId), eq(feeRecalibrations.isCurrent, true)))
      .returning();
    return row;
  },

  async create(
    db: Db,
    data: {
      workId: string;
      referenceMonth: string;
      fromMonth: string;
      remainingTotal: string;
      previousRemaining: string;
      note: string | null;
      createdById: string | null;
    },
  ): Promise<FeeRecalibrationRow> {
    await db
      .update(feeRecalibrations)
      .set({ isCurrent: false })
      .where(and(eq(feeRecalibrations.workId, data.workId), eq(feeRecalibrations.isCurrent, true)));
    const [row] = await db
      .insert(feeRecalibrations)
      .values({ ...data, isCurrent: true })
      .returning();
    if (!row) throw new Error('Falha ao gravar ajuste de taxa');
    return row;
  },
};
