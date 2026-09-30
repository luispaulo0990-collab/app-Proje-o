import { count, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { auditLogs, users } from '../schema/index.js';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  workId?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  origin?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const auditRepository = {
  async insert(db: Db, entries: AuditEntry | AuditEntry[]): Promise<void> {
    const list = Array.isArray(entries) ? entries : [entries];
    if (list.length === 0) return;
    await db.insert(auditLogs).values(list);
  },

  async listByWork(db: Db, workId: string, page: number, pageSize: number) {
    const where = eq(auditLogs.workId, workId);
    const [rows, [total]] = await Promise.all([
      db
        .select({ log: auditLogs, userName: users.name })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(auditLogs).where(where),
    ]);
    return { rows, total: total?.value ?? 0 };
  },
};
