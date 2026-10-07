import {
  Decimal,
  PCT_SCALE,
  canonicalEconomicEntry,
  isEconomicClosing,
  toFixedString,
  type EconomicEntry,
  type ProgressEntry,
} from '@unita/engine';
import type {
  EconomicIndicatorsBody,
  EconomicIndicatorsDto,
  ProgressIndicatorsBody,
  ProgressIndicatorsDto,
} from '@unita/contracts';
import type { Db } from '../../database/client.js';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import {
  economicIndicatorsRepository,
  progressIndicatorsRepository,
  type EconomicIndicatorRow,
  type ProgressIndicatorRow,
} from '../../database/repositories/consolidated-inputs.repository.js';
import { worksRepository, type WorkRow } from '../../database/repositories/works.repository.js';
import { createWorkCurvesService } from '../work-curves/work-curves.service.js';
import type { Actor, AppDeps } from '../../types.js';
import { notFound } from '../../utils/errors.js';

const fraction = (v: string | null | undefined) =>
  v === null || v === undefined ? null : toFixedString(new Decimal(v), PCT_SCALE);

function toIndicatorsDto(workId: string, rows: ProgressIndicatorRow[]): ProgressIndicatorsDto {
  const last = rows.reduce<ProgressIndicatorRow | null>(
    (acc, r) => (!acc || r.updatedAt > acc.updatedAt ? r : acc),
    null,
  );
  return {
    workId,
    source: last?.source ?? null,
    updatedAt: last?.updatedAt.toISOString() ?? null,
    months: rows.map((r) => ({
      month: r.month,
      realizedCumulative: r.realizedCumulative,
      clientReplannedCumulative: r.clientReplannedCumulative,
      targetCumulative: r.targetCumulative,
    })),
  };
}

/** Canonical entries (8 decimals, months without any value dropped). */
export function canonicalProgressEntries(
  months: ProgressIndicatorsBody['months'],
): ProgressEntry[] {
  return months
    .map((m) => ({
      month: m.month.length === 7 ? `${m.month}-01` : m.month,
      realizedCumulative: fraction(m.realizedCumulative),
      clientReplannedCumulative: fraction(m.clientReplannedCumulative),
      targetCumulative: fraction(m.targetCumulative),
    }))
    .filter(
      (m) =>
        m.realizedCumulative !== null ||
        m.clientReplannedCumulative !== null ||
        m.targetCumulative !== null,
    )
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Stores the progress indicators of a work (used by the API endpoint and the SharePoint sync). */
export async function saveProgressIndicators(
  tx: Db,
  workId: string,
  body: { source: string; externalRef?: string | null; entries: ProgressEntry[] },
  actor: Actor,
): Promise<void> {
  await progressIndicatorsRepository.replace(
    tx,
    workId,
    {
      source: body.source,
      externalRef: body.externalRef ?? null,
      receivedVia: actor.integration ? 'API_KEY' : 'USER',
      updatedById: actor.user?.id ?? null,
    },
    body.entries,
  );
  const last = body.entries.at(-1);
  await auditRepository.insert(tx, {
    userId: actor.user?.id ?? null,
    action: 'IMPORT_PROGRESS',
    entity: 'work_progress_indicators',
    entityId: null,
    workId,
    newValue: `${body.entries.length} meses${last ? ` · último ${last.month.slice(0, 7)}` : ''}`,
    origin: body.source,
    metadata: { integration: actor.integration, externalRef: body.externalRef ?? null },
  });
}

function toEconomicDto(workId: string, rows: EconomicIndicatorRow[]): EconomicIndicatorsDto {
  const last = rows.reduce<EconomicIndicatorRow | null>(
    (acc, r) => (!acc || r.updatedAt > acc.updatedAt ? r : acc),
    null,
  );
  return {
    workId,
    source: last?.source ?? null,
    updatedAt: last?.updatedAt.toISOString() ?? null,
    months: rows.map((r) => ({ month: r.month, iec: r.iec, projectedResult: r.projectedResult })),
  };
}

/** Canonical economic entries (IEC 6 decimals, R$ 2), months without any value dropped. */
export function canonicalEconomicEntries(
  months: readonly { month: string; iec?: string | null; projectedResult?: string | null }[],
): EconomicEntry[] {
  return months
    .map((m) =>
      canonicalEconomicEntry({
        month: m.month.length === 7 ? `${m.month}-01` : m.month,
        iec: m.iec ?? null,
        projectedResult: m.projectedResult ?? null,
      }),
    )
    .filter(isEconomicClosing)
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Stores the economic closings of a work (API endpoint and SharePoint sync). */
export async function saveEconomicIndicators(
  tx: Db,
  workId: string,
  body: { source: string; externalRef?: string | null; entries: EconomicEntry[] },
  actor: Actor,
): Promise<void> {
  await economicIndicatorsRepository.replace(
    tx,
    workId,
    {
      source: body.source,
      externalRef: body.externalRef ?? null,
      receivedVia: actor.integration ? 'API_KEY' : 'USER',
      updatedById: actor.user?.id ?? null,
    },
    body.entries,
  );
  const last = body.entries.at(-1);
  await auditRepository.insert(tx, {
    userId: actor.user?.id ?? null,
    action: 'IMPORT_ECONOMIC',
    entity: 'work_economic_indicators',
    entityId: null,
    workId,
    newValue:
      `${body.entries.length} meses` +
      (last ? ` · último ${last.month.slice(0, 7)} IEC ${last.iec ?? '—'}` : ''),
    origin: body.source,
    metadata: { integration: actor.integration, externalRef: body.externalRef ?? null },
  });
}

/** Planning-system progress indicators of the "Consolidado" (audited on every change). */
export function createConsolidatedInputsService(deps: AppDeps) {
  const { db } = deps;
  const workCurves = createWorkCurvesService(deps);
  async function loadWork(tx: Db, workId: string): Promise<WorkRow> {
    const found = await worksRepository.findById(tx, workId);
    if (!found) throw notFound('Obra');
    return found.work;
  }

  return {
    async getProgress(workId: string): Promise<ProgressIndicatorsDto> {
      await loadWork(db, workId);
      return toIndicatorsDto(workId, await progressIndicatorsRepository.listByWork(db, workId));
    },

    async putProgress(
      workId: string,
      body: ProgressIndicatorsBody,
      actor: Actor,
    ): Promise<ProgressIndicatorsDto> {
      const work = await loadWork(db, workId);
      const entries = canonicalProgressEntries(body.months);
      await db.transaction(async (tx) => {
        await saveProgressIndicators(tx, workId, { ...body, entries }, actor);
        // A new "Realizado Acumulado" moves the trend curve of a started work.
        await workCurves.refreshWork(tx, work, actor, 'Realizado acumulado atualizado');
      });
      return toIndicatorsDto(workId, await progressIndicatorsRepository.listByWork(db, workId));
    },

    async getEconomic(workId: string): Promise<EconomicIndicatorsDto> {
      await loadWork(db, workId);
      return toEconomicDto(workId, await economicIndicatorsRepository.listByWork(db, workId));
    },

    async putEconomic(
      workId: string,
      body: EconomicIndicatorsBody,
      actor: Actor,
    ): Promise<EconomicIndicatorsDto> {
      await loadWork(db, workId);
      const entries = canonicalEconomicEntries(body.months);
      await db.transaction((tx) => saveEconomicIndicators(tx, workId, { ...body, entries }, actor));
      return toEconomicDto(workId, await economicIndicatorsRepository.listByWork(db, workId));
    },
  };
}
