import { and, asc, eq } from 'drizzle-orm';
import type { FeeTerm } from '@unita/engine';
import type { Db } from '../client.js';
import { users, workFeeTerms } from '../schema/index.js';

export type FeeTermRow = typeof workFeeTerms.$inferSelect;
export type FeeTermWithAuthor = FeeTermRow & { updatedBy: string | null };

export const toEngineFeeTerm = (r: FeeTermRow): FeeTerm => ({
  month: r.month,
  feeRate: r.feeRate,
  inccPeriodicity: r.inccPeriodicity,
});

/** Fee conditions of a work over time ("vigências"), one row per work × month. */
export const feeTermsRepository = {
  async listByWork(db: Db, workId: string): Promise<FeeTermWithAuthor[]> {
    const rows = await db
      .select({ r: workFeeTerms, updatedBy: users.name })
      .from(workFeeTerms)
      .leftJoin(users, eq(users.id, workFeeTerms.updatedById))
      .where(eq(workFeeTerms.workId, workId))
      .orderBy(asc(workFeeTerms.month));
    return rows.map(({ r, updatedBy }) => ({ ...r, updatedBy }));
  },

  async find(db: Db, workId: string, month: string): Promise<FeeTermRow | undefined> {
    const [row] = await db
      .select()
      .from(workFeeTerms)
      .where(and(eq(workFeeTerms.workId, workId), eq(workFeeTerms.month, month)));
    return row;
  },

  async upsert(
    db: Db,
    data: Pick<FeeTermRow, 'workId' | 'month' | 'feeRate' | 'inccPeriodicity' | 'note'> & {
      updatedById: string | null;
    },
  ): Promise<FeeTermRow> {
    const [row] = await db
      .insert(workFeeTerms)
      .values(data)
      .onConflictDoUpdate({
        target: [workFeeTerms.workId, workFeeTerms.month],
        set: {
          feeRate: data.feeRate,
          inccPeriodicity: data.inccPeriodicity,
          note: data.note,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('Falha ao gravar a vigência da taxa');
    return row;
  },

  async delete(db: Db, workId: string, month: string): Promise<FeeTermRow | undefined> {
    const [row] = await db
      .delete(workFeeTerms)
      .where(and(eq(workFeeTerms.workId, workId), eq(workFeeTerms.month, month)))
      .returning();
    return row;
  },
};
