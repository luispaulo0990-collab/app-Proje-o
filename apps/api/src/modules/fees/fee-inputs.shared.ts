import type { Actor } from '../../types.js';

/** `AAAA-MM-01` → `MM/AAAA`, as shown in audit entries and projection notes. */
export const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** Name shown as author of a fee input saved by a user or by an integration (X-Api-Key). */
export const actorName = (actor: Actor): string | null =>
  actor.user?.name ?? (actor.integration ? `Integração: ${actor.integration}` : null);

/** A freshly written row with its author, before it is read back with the join. */
export const withAuthor = <T extends object>(row: T, actor: Actor) => ({
  ...row,
  updatedBy: actorName(actor),
});
