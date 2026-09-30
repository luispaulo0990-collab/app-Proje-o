import { and, asc, count, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { WorkListQuery } from '@unita/contracts';
import type { Db } from '../client.js';
import { clients, curveVersions, curves, works } from '../schema/index.js';

export type WorkRow = typeof works.$inferSelect;
export type WorkInsert = typeof works.$inferInsert;

const selection = {
  work: works,
  clientName: clients.name,
  curveId: curves.id,
  curveName: curves.name,
  curveVersion: curveVersions.version,
};

export type WorkWithRelations = {
  work: WorkRow;
  clientName: string;
  curveId: string;
  curveName: string;
  curveVersion: number;
};

function baseQuery(db: Db) {
  return db
    .select(selection)
    .from(works)
    .innerJoin(clients, eq(clients.id, works.clientId))
    .innerJoin(curveVersions, eq(curveVersions.id, works.curveVersionId))
    .innerJoin(curves, eq(curves.id, curveVersions.curveId));
}

type WorkFilter = Pick<WorkListQuery, 'status' | 'clientId' | 'q' | 'includeArchived'>;

function filterConditions(q: Partial<WorkFilter>): SQL | undefined {
  const conditions: SQL[] = [isNull(works.deletedAt)];
  if (q.status) conditions.push(eq(works.status, q.status));
  else if (!q.includeArchived) conditions.push(ne(works.status, 'ARCHIVED'));
  if (q.clientId) conditions.push(eq(works.clientId, q.clientId));
  if (q.q) {
    const term = `%${q.q}%`;
    const match = or(ilike(works.name, term), ilike(clients.name, term));
    if (match) conditions.push(match);
  }
  return and(...conditions);
}

export const worksRepository = {
  /** Every work matching the filter, unpaginated (portfolio-wide views). */
  async listAll(db: Db, q: Partial<WorkFilter>): Promise<WorkWithRelations[]> {
    return baseQuery(db).where(filterConditions(q)).orderBy(asc(clients.name), asc(works.name));
  },

  async list(db: Db, q: WorkListQuery): Promise<{ rows: WorkWithRelations[]; total: number }> {
    const where = filterConditions(q);
    const [rows, [total]] = await Promise.all([
      baseQuery(db)
        .where(where)
        .orderBy(asc(clients.name), asc(works.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db
        .select({ value: count() })
        .from(works)
        .innerJoin(clients, eq(clients.id, works.clientId))
        .where(where),
    ]);
    return { rows, total: total?.value ?? 0 };
  },

  async findById(db: Db, id: string): Promise<WorkWithRelations | undefined> {
    const [row] = await baseQuery(db).where(and(eq(works.id, id), isNull(works.deletedAt)));
    return row;
  },

  async create(db: Db, data: WorkInsert): Promise<WorkRow> {
    const [row] = await db.insert(works).values(data).returning();
    if (!row) throw new Error('Falha ao criar obra');
    return row;
  },

  async update(db: Db, id: string, data: Partial<WorkInsert>): Promise<WorkRow | undefined> {
    const [row] = await db.update(works).set(data).where(eq(works.id, id)).returning();
    return row;
  },

  async softDelete(db: Db, id: string): Promise<void> {
    await db
      .update(works)
      .set({ deletedAt: sql`now()` })
      .where(eq(works.id, id));
  },
};

export const clientsRepository = {
  /** Finds a client by case-insensitive name or creates it (the form uses free text + autocomplete). */
  async upsertByName(db: Db, name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    const [existing] = await db
      .select()
      .from(clients)
      .where(sql`lower(${clients.name}) = ${trimmed.toLowerCase()}`);
    if (existing) return existing;
    const [created] = await db.insert(clients).values({ name: trimmed }).returning();
    if (!created) throw new Error('Falha ao criar cliente');
    return created;
  },

  list(db: Db) {
    return db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .orderBy(asc(clients.name));
  },
};
