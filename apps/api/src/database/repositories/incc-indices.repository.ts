import { asc, eq, sql } from 'drizzle-orm';
import type { InccIndex } from '@unita/engine';
import type { Db } from '../client.js';
import { inccIndices, users } from '../schema/index.js';

export type InccIndexRow = typeof inccIndices.$inferSelect;
export type InccIndexWithAuthor = InccIndexRow & { updatedBy: string | null };

export const toEngineInccIndex = (r: InccIndexRow): InccIndex => ({
  month: r.month,
  index: r.indexValue,
});

export const inccIndicesRepository = {
  async list(db: Db): Promise<InccIndexWithAuthor[]> {
    const rows = await db
      .select({ r: inccIndices, updatedBy: users.name })
      .from(inccIndices)
      .leftJoin(users, eq(users.id, inccIndices.updatedById))
      .orderBy(asc(inccIndices.month));
    return rows.map(({ r, updatedBy }) => ({ ...r, updatedBy }));
  },

  async find(db: Db, month: string): Promise<InccIndexRow | undefined> {
    const [row] = await db.select().from(inccIndices).where(eq(inccIndices.month, month));
    return row;
  },

  /** Inserts or overwrites months (one statement for the whole batch). */
  async upsertMany(
    db: Db,
    items: readonly { month: string; indexValue: string }[],
    meta: { note: string | null; updatedById: string | null },
  ): Promise<InccIndexRow[]> {
    if (items.length === 0) return [];
    return db
      .insert(inccIndices)
      .values(items.map((i) => ({ ...i, ...meta })))
      .onConflictDoUpdate({
        target: inccIndices.month,
        set: {
          indexValue: sql`excluded.index_value`,
          note: sql`excluded.note`,
          updatedById: sql`excluded.updated_by_id`,
          updatedAt: new Date(),
        },
      })
      .returning();
  },

  /** Inserts only the months not registered yet (history load: never overwrites edits). */
  async insertMissing(
    db: Db,
    items: readonly { month: string; indexValue: string }[],
    note: string,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const rows = await db
      .insert(inccIndices)
      .values(items.map((i) => ({ ...i, note })))
      .onConflictDoNothing({ target: inccIndices.month })
      .returning({ month: inccIndices.month });
    return rows.length;
  },

  async delete(db: Db, month: string): Promise<InccIndexRow | undefined> {
    const [row] = await db.delete(inccIndices).where(eq(inccIndices.month, month)).returning();
    return row;
  },
};
