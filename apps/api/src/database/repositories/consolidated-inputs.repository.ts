import { asc, eq, inArray } from 'drizzle-orm';
import type { EconomicEntry, ProgressEntry } from '@unita/engine';
import type { Db } from '../client.js';
import { workEconomicIndicators, workProgressIndicators } from '../schema/index.js';

export type ProgressIndicatorRow = typeof workProgressIndicators.$inferSelect;

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

export type EconomicIndicatorRow = typeof workEconomicIndicators.$inferSelect;

export const toEconomicEntry = (r: EconomicIndicatorRow): EconomicEntry => ({
  month: r.month,
  iec: r.iec,
  projectedResult: r.projectedResult,
});

export const economicIndicatorsRepository = {
  async listByWork(db: Db, workId: string): Promise<EconomicIndicatorRow[]> {
    return db
      .select()
      .from(workEconomicIndicators)
      .where(eq(workEconomicIndicators.workId, workId))
      .orderBy(asc(workEconomicIndicators.month));
  },

  /** Economic closings of many works in one query (Consolidado). */
  async listByWorks(
    db: Db,
    workIds: readonly string[],
  ): Promise<Map<string, EconomicIndicatorRow[]>> {
    const result = new Map<string, EconomicIndicatorRow[]>();
    if (workIds.length === 0) return result;
    const rows = await db
      .select()
      .from(workEconomicIndicators)
      .where(inArray(workEconomicIndicators.workId, [...workIds]))
      .orderBy(asc(workEconomicIndicators.workId), asc(workEconomicIndicators.month));
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
    entries: readonly EconomicEntry[],
  ): Promise<void> {
    await db.delete(workEconomicIndicators).where(eq(workEconomicIndicators.workId, workId));
    if (entries.length === 0) return;
    await db.insert(workEconomicIndicators).values(
      entries.map((e) => ({
        workId,
        month: e.month,
        iec: e.iec ?? null,
        projectedResult: e.projectedResult ?? null,
        ...meta,
      })),
    );
  },
};
