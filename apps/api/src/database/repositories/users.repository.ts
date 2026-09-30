import { asc, count, eq, sql } from 'drizzle-orm';
import type { Role } from '@unita/contracts';
import type { Db } from '../client.js';
import { users } from '../schema/index.js';

export type UserRow = typeof users.$inferSelect;

export const usersRepository = {
  async findByEmail(db: Db, email: string): Promise<UserRow | undefined> {
    const [row] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    return row;
  },

  async findById(db: Db, id: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
  },

  async count(db: Db): Promise<number> {
    const [row] = await db.select({ value: count() }).from(users);
    return row?.value ?? 0;
  },

  async create(
    db: Db,
    data: { name: string; email: string; passwordHash: string; role: Role },
  ): Promise<UserRow> {
    const [row] = await db.insert(users).values(data).returning();
    if (!row) throw new Error('Falha ao criar usuário');
    return row;
  },

  async update(
    db: Db,
    id: string,
    data: Partial<Pick<UserRow, 'role' | 'isActive' | 'passwordHash' | 'lastLoginAt'>>,
  ) {
    const [row] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return row;
  },

  list(db: Db): Promise<UserRow[]> {
    return db.select().from(users).orderBy(asc(users.name));
  },
};
