import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FeeIssuance } from '@unita/engine';
import type { Db } from '../client.js';
import { feeIssuances, users } from '../schema/index.js';

export type FeeIssuanceRow = typeof feeIssuances.$inferSelect;
export type FeeIssuanceWithAuthor = FeeIssuanceRow & { updatedBy: string | null };

export const toEngineIssuance = (r: FeeIssuanceRow): FeeIssuance => ({
  month: r.month,
  amount: r.amount,
});

const withAuthor = { r: feeIssuances, updatedBy: users.name };

export const feeIssuancesRepository = {
  async listByWork(db: Db, workId: string): Promise<FeeIssuanceWithAuthor[]> {
    const rows = await db
      .select(withAuthor)
      .from(feeIssuances)
      .leftJoin(users, eq(users.id, feeIssuances.updatedById))
      .where(eq(feeIssuances.workId, workId))
      .orderBy(asc(feeIssuances.month));
    return rows.map(({ r, updatedBy }) => ({ ...r, updatedBy }));
  },

  /** Issuances of one month for many works (Consolidado). */
  async listByWorksAtMonth(
    db: Db,
    workIds: readonly string[],
    month: string,
  ): Promise<Map<string, FeeIssuanceWithAuthor>> {
    const result = new Map<string, FeeIssuanceWithAuthor>();
    if (workIds.length === 0) return result;
    const rows = await db
      .select(withAuthor)
      .from(feeIssuances)
      .leftJoin(users, eq(users.id, feeIssuances.updatedById))
      .where(and(inArray(feeIssuances.workId, [...workIds]), eq(feeIssuances.month, month)));
    for (const { r, updatedBy } of rows) result.set(r.workId, { ...r, updatedBy });
    return result;
  },

  /** Ids of the works that have at least one issuance (they depend on the INCC). */
  async listWorkIds(db: Db): Promise<string[]> {
    const rows = await db.selectDistinct({ workId: feeIssuances.workId }).from(feeIssuances);
    return rows.map((r) => r.workId);
  },

  async find(db: Db, workId: string, month: string): Promise<FeeIssuanceRow | undefined> {
    const [row] = await db
      .select()
      .from(feeIssuances)
      .where(and(eq(feeIssuances.workId, workId), eq(feeIssuances.month, month)));
    return row;
  },

  async upsert(
    db: Db,
    data: {
      workId: string;
      month: string;
      amount: string;
      note: string | null;
      updatedById: string | null;
    },
  ): Promise<FeeIssuanceRow> {
    const [row] = await db
      .insert(feeIssuances)
      .values(data)
      .onConflictDoUpdate({
        target: [feeIssuances.workId, feeIssuances.month],
        set: {
          amount: data.amount,
          note: data.note,
          updatedById: data.updatedById,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('Falha ao gravar a taxa emitida');
    return row;
  },

  async delete(db: Db, workId: string, month: string): Promise<FeeIssuanceRow | undefined> {
    const [row] = await db
      .delete(feeIssuances)
      .where(and(eq(feeIssuances.workId, workId), eq(feeIssuances.month, month)))
      .returning();
    return row;
  },
};
