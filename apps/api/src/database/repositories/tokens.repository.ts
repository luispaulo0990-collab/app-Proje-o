import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { passwordResetTokens, refreshTokens } from '../schema/index.js';

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export const tokensRepository = {
  async createRefresh(
    db: Db,
    data: { userId: string; tokenHash: string; expiresAt: Date; userAgent?: string | null },
  ) {
    const [row] = await db
      .insert(refreshTokens)
      .values({ ...data, userAgent: data.userAgent?.slice(0, 255) ?? null })
      .returning();
    if (!row) throw new Error('Falha ao criar refresh token');
    return row;
  },

  async findRefreshByHash(db: Db, tokenHash: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row;
  },

  async revokeRefresh(db: Db, id: string, replacedById?: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: replacedById ?? null })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
  },

  async revokeAllForUser(db: Db, userId: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  },

  async createPasswordReset(db: Db, data: { userId: string; tokenHash: string; expiresAt: Date }) {
    await db.insert(passwordResetTokens).values(data);
  },

  async findPasswordReset(db: Db, tokenHash: string) {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));
    return row;
  },

  async markPasswordResetUsed(db: Db, id: string) {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  },
};
