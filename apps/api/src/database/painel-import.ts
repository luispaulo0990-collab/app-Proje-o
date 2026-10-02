import { and, eq, isNull } from 'drizzle-orm';
import { buildSchedule, normalizeCurveWeights } from '@unita/engine';
import painel from './data/painel-obras.json' with { type: 'json' };
import { normalizeWorkName } from '../integrations/work-curve-provider.js';
import { generateProjection } from '../modules/projections/projections.service.js';
import { currentMonth } from '../utils/dates.js';
import type { Db } from './client.js';
import { actualCurvesRepository } from './repositories/actual-curves.repository.js';
import { auditRepository } from './repositories/audit.repository.js';
import { clientsRepository, worksRepository } from './repositories/works.repository.js';
import { projections, works } from './schema/index.js';

/**
 * Works of the "Painel (2)" sheet of "Painel de obras.xlsx", extracted to
 * `data/painel-obras.json` (one entry per work: client, name, UH, orçamento raso, % taxa,
 * mês de início e o avanço físico mensal da própria planilha).
 */
interface PainelWork {
  client: string;
  name: string;
  units: number;
  budget: string;
  feeRate: string;
  startMonth: string;
  monthly: string[];
}

export const PAINEL_SOURCE = 'PLANILHA PAINEL (2)';
const IMPORT_NOTE = 'Importada da planilha Painel de Obras';
/** Note written on V1 of the fictitious sample works of earlier demo versions. */
const LEGACY_SAMPLE_NOTE = 'Carga de exemplo';

const key = (client: string, name: string) =>
  `${normalizeWorkName(client)}|${normalizeWorkName(name)}`;

/**
 * Soft-deletes the fictitious sample works created by earlier versions of the demo (identified
 * by the V1 note "Carga de exemplo" and no author). Works created by users are never touched.
 */
async function removeLegacySamples(db: Db, log: (m: string) => void): Promise<void> {
  const rows = await db
    .selectDistinct({ id: works.id, name: works.name })
    .from(works)
    .innerJoin(projections, eq(projections.workId, works.id))
    .where(
      and(
        isNull(works.deletedAt),
        isNull(works.createdById),
        eq(projections.note, LEGACY_SAMPLE_NOTE),
      ),
    );
  for (const w of rows) {
    await db.transaction(async (tx) => {
      await worksRepository.softDelete(tx, w.id);
      await auditRepository.insert(tx, {
        userId: null,
        action: 'DELETE',
        entity: 'work',
        entityId: w.id,
        workId: w.id,
        oldValue: w.name,
        metadata: { reason: 'Obra fictícia da demonstração substituída pela planilha' },
      });
    });
  }
  if (rows.length > 0) log(`${rows.length} obra(s) fictícia(s) da demonstração removida(s).`);
}

function lastMonth(startMonth: string, months: number): string {
  return buildSchedule(startMonth, months).periods.at(-1)?.month ?? startMonth;
}

/**
 * Imports every work of the spreadsheet (idempotent by client + name). Each work gets the
 * standard parametric curve as its model and the sheet's own physical progress as its own
 * curve (source "PLANILHA PAINEL (2)") — the same mechanism the SharePoint integration will
 * use, so the curve is replaced automatically once the API is authorized.
 */
export async function importPainelWorks(
  db: Db,
  parametricCurveVersionId: string,
  log: (m: string) => void,
): Promise<{ created: number; skipped: number }> {
  await removeLegacySamples(db, log);
  const existing = await worksRepository.listAll(db, { includeArchived: true });
  const known = new Set(existing.map((w) => key(w.clientName, w.work.name)));
  const today = currentMonth();
  let created = 0;

  for (const p of (painel as { works: PainelWork[] }).works) {
    if (known.has(key(p.client, p.name))) continue;
    await db.transaction(async (tx) => {
      const client = await clientsRepository.upsertByName(tx, p.client);
      const ended = lastMonth(p.startMonth, p.monthly.length) < today;
      const work = await worksRepository.create(tx, {
        name: p.name,
        clientId: client.id,
        units: Math.max(1, p.units),
        budget: p.budget,
        feeRate: p.feeRate,
        constructionSystem: 'Não informado',
        curveVersionId: parametricCurveVersionId,
        startDate: p.startMonth,
        durationMonths: p.monthly.length,
        status: ended ? 'COMPLETED' : 'ACTIVE',
        createdById: null,
      });
      await actualCurvesRepository.createVersion(
        tx,
        {
          workId: work.id,
          startMonth: p.startMonth,
          source: PAINEL_SOURCE,
          externalRef: null,
          note: 'Avanço físico da aba Painel (2) de "Painel de obras.xlsx"',
          receivedVia: 'USER',
          createdById: null,
        },
        normalizeCurveWeights(p.monthly),
      );
      const { row } = await generateProjection(tx, work, null, {
        mode: 'REPLACE_MANUAL',
        manualCells: [],
        note: IMPORT_NOTE,
      });
      await auditRepository.insert(tx, {
        userId: null,
        action: 'CREATE',
        entity: 'work',
        entityId: work.id,
        workId: work.id,
        newValue: work.name,
        origin: PAINEL_SOURCE,
        metadata: { projectionVersion: row.version, curveSource: row.curveSource },
      });
    });
    created += 1;
  }
  const skipped = (painel as { skipped: unknown[] }).skipped.length;
  if (created > 0) log(`${created} obra(s) importada(s) da planilha Painel de Obras.`);
  return { created, skipped };
}

/** Works of the sheet that could not be imported (no progress, budget or fee rate). */
export const painelSkipped = (
  painel as { skipped: { client: string; name: string; reason: string }[] }
).skipped;
