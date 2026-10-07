import type { Db } from '../../database/client.js';
import { projectionsRepository } from '../../database/repositories/projections.repository.js';
import { worksRepository } from '../../database/repositories/works.repository.js';
import {
  regenerateKeepingManualCells,
  usesOutdatedFeeRules,
  type ProjectionParameters,
} from './projections.service.js';

const UPGRADE_NOTE = 'Atualização das regras de taxa: saldo a receber corrigido pelo INCC';

/**
 * One-off data upgrade (idempotent): current projections generated with previous fee rules
 * (configurable lag, "Ajuste projeção de taxa", INCC only after the first issuance) get a new
 * version under the current rules.
 * Manual cells are kept; each upgrade is recorded in the work's history. Returns how many
 * projections were upgraded.
 */
export async function upgradeProjectionsToCurrentFeeRules(db: Db): Promise<number> {
  const works = await worksRepository.listAll(db, { includeArchived: true });
  const current = await projectionsRepository.findCurrentByWorks(
    db,
    works.map((w) => w.work.id),
  );
  const outdated = works.filter((w) => {
    const projection = current.get(w.work.id)?.projection;
    return projection && usesOutdatedFeeRules(projection.parameters as ProjectionParameters);
  });
  let upgraded = 0;
  for (const w of outdated) {
    try {
      await db.transaction((tx) =>
        regenerateKeepingManualCells(tx, w.work, { user: null, integration: null }, UPGRADE_NOTE),
      );
      upgraded += 1;
    } catch (err) {
      // One inconsistent work must not prevent the application from starting; it keeps its
      // previous version and is retried on the next start.
      console.warn(`Projeção de "${w.work.name}" não atualizada:`, (err as Error).message);
    }
  }
  return upgraded;
}
