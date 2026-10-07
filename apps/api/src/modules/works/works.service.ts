import { Decimal, buildSchedule, computeFeeTotal } from '@unita/engine';
import type { WorkBody, WorkDto, WorkListQuery } from '@unita/contracts';
import type { Db } from '../../database/client.js';
import { auditRepository, type AuditEntry } from '../../database/repositories/audit.repository.js';
import { curvesRepository } from '../../database/repositories/curves.repository.js';
import { workHasManualHistory } from '../../database/repositories/projections.repository.js';
import {
  clientsRepository,
  worksRepository,
  type WorkRow,
  type WorkWithRelations,
} from '../../database/repositories/works.repository.js';
import type { AppDeps, AuthUser } from '../../types.js';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { generateProjection, regenerateOrFlagStale } from '../projections/projections.service.js';

/** Fields that feed the ProjectionEngine — changing any of them affects the projection. */
const CALC_FIELDS = [
  'budget',
  'feeRate',
  'inccPeriodicity',
  'inccBaseMonth',
  'curveVersionId',
  'startDate',
  'durationMonths',
] as const;
const DECIMAL_FIELDS = new Set(['budget', 'feeRate']);
const TRACKED_FIELDS = ['name', 'units', 'constructionSystem', 'status', ...CALC_FIELDS] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

export function toWorkDto(r: WorkWithRelations): WorkDto {
  const schedule = buildSchedule(r.work.startDate, r.work.durationMonths);
  return {
    id: r.work.id,
    name: r.work.name,
    client: { id: r.work.clientId, name: r.clientName },
    units: r.work.units,
    budget: r.work.budget,
    feeRate: r.work.feeRate,
    feeTotal: computeFeeTotal(r.work.budget, r.work.feeRate),
    inccPeriodicity: r.work.inccPeriodicity,
    inccBaseMonth: r.work.inccBaseMonth,
    constructionSystem: r.work.constructionSystem,
    curve: {
      id: r.curveId,
      name: r.curveName,
      versionId: r.work.curveVersionId,
      version: r.curveVersion,
    },
    startDate: r.work.startDate,
    durationMonths: r.work.durationMonths,
    endDate: schedule.endDate,
    periods: schedule.periods.length,
    status: r.work.status,
    createdAt: r.work.createdAt.toISOString(),
    updatedAt: r.work.updatedAt.toISOString(),
  };
}

function sameValue(field: TrackedField, a: unknown, b: unknown): boolean {
  if (DECIMAL_FIELDS.has(field)) return new Decimal(String(a)).equals(String(b));
  return a === b;
}

async function assertUsableCurveVersion(db: Db, versionId: string): Promise<void> {
  const found = await curvesRepository.findVersionById(db, versionId);
  if (!found) throw new AppError(422, 'CURVE_NOT_FOUND', 'A versão de curva informada não existe.');
  if (found.curve.status !== 'ACTIVE')
    throw new AppError(422, 'CURVE_ARCHIVED', 'A curva selecionada está arquivada.');
}

export function createWorksService({ db }: AppDeps) {
  async function get(id: string): Promise<WorkDto> {
    const found = await worksRepository.findById(db, id);
    if (!found) throw notFound('Obra');
    return toWorkDto(found);
  }

  async function insertWithProjection(
    tx: Db,
    input: WorkBody,
    user: AuthUser,
    note: string,
  ): Promise<WorkRow> {
    buildSchedule(input.startDate, input.durationMonths); // domain validation → 422
    await assertUsableCurveVersion(tx, input.curveVersionId);
    const client = await clientsRepository.upsertByName(tx, input.clientName);
    const { clientName: _clientName, ...fields } = input;
    const work = await worksRepository.create(tx, {
      ...fields,
      clientId: client.id,
      createdById: user.id,
    });
    const { row } = await generateProjection(tx, work, user, {
      mode: 'REPLACE_MANUAL',
      manualCells: [],
      note,
    });
    await auditRepository.insert(tx, {
      userId: user.id,
      action: 'CREATE',
      entity: 'work',
      entityId: work.id,
      workId: work.id,
      newValue: work.name,
      metadata: { projectionVersion: row.version },
    });
    return work;
  }

  return {
    get,

    async list(query: WorkListQuery) {
      const { rows, total } = await worksRepository.list(db, query);
      return { items: rows.map(toWorkDto), page: query.page, pageSize: query.pageSize, total };
    },

    async create(input: WorkBody, user: AuthUser): Promise<WorkDto> {
      const work = await db.transaction((tx) =>
        insertWithProjection(tx, input, user, 'Projeção inicial gerada pela curva'),
      );
      return get(work.id);
    },

    /**
     * Updates the work. If a calculation input changed the projection is regenerated keeping the
     * manual cells; only when one of them no longer fits is it flagged stale for the user to
     * choose (preserve or replace) — manual values are never lost silently (spec §15).
     */
    async update(id: string, input: WorkBody, user: AuthUser): Promise<WorkDto> {
      await db.transaction(async (tx) => {
        const found = await worksRepository.findById(tx, id);
        if (!found) throw notFound('Obra');
        const before = found.work;
        buildSchedule(input.startDate, input.durationMonths);
        if (input.curveVersionId !== before.curveVersionId)
          await assertUsableCurveVersion(tx, input.curveVersionId);

        const client = await clientsRepository.upsertByName(tx, input.clientName);
        const { clientName: _clientName, ...fields } = input;
        const after = await worksRepository.update(tx, id, { ...fields, clientId: client.id });
        if (!after) throw notFound('Obra');

        const changed = TRACKED_FIELDS.filter((f) => !sameValue(f, before[f], after[f]));
        const entries: AuditEntry[] = changed.map((field) => ({
          userId: user.id,
          action: 'UPDATE',
          entity: 'work',
          entityId: id,
          workId: id,
          field,
          oldValue: String(before[field]),
          newValue: String(after[field]),
        }));
        if (before.clientId !== after.clientId) {
          entries.push({
            userId: user.id,
            action: 'UPDATE',
            entity: 'work',
            entityId: id,
            workId: id,
            field: 'client',
            oldValue: found.clientName,
            newValue: client.name,
          });
        }

        await auditRepository.insert(tx, entries);
        if (changed.some((f) => (CALC_FIELDS as readonly string[]).includes(f))) {
          await regenerateOrFlagStale(
            tx,
            after,
            { user, integration: null },
            'Recalculada após alteração da obra',
          );
        }
      });
      return get(id);
    },

    async duplicate(id: string, user: AuthUser): Promise<WorkDto> {
      const source = await get(id);
      const copy = await db.transaction((tx) =>
        insertWithProjection(
          tx,
          {
            name: `${source.name} (cópia)`.slice(0, 160),
            clientName: source.client.name,
            units: source.units,
            budget: source.budget,
            feeRate: source.feeRate,
            inccPeriodicity: source.inccPeriodicity,
            inccBaseMonth: source.inccBaseMonth,
            constructionSystem: source.constructionSystem,
            curveVersionId: source.curve.versionId,
            startDate: source.startDate,
            durationMonths: source.durationMonths,
            status: 'DRAFT',
          },
          user,
          `Duplicada de "${source.name}"`,
        ),
      );
      return get(copy.id);
    },

    async archive(id: string, user: AuthUser): Promise<WorkDto> {
      const source = await get(id);
      await db.transaction(async (tx) => {
        await worksRepository.update(tx, id, { status: 'ARCHIVED' });
        await auditRepository.insert(tx, {
          userId: user.id,
          action: 'ARCHIVE',
          entity: 'work',
          entityId: id,
          workId: id,
          field: 'status',
          oldValue: source.status,
          newValue: 'ARCHIVED',
        });
      });
      return get(id);
    },

    /** Soft delete, only when the work never had manual adjustments; otherwise archive it. */
    async remove(id: string, user: AuthUser): Promise<void> {
      const source = await get(id);
      if (await workHasManualHistory(db, id)) {
        throw conflict(
          'Esta obra possui ajustes manuais no histórico. Arquive-a em vez de excluir.',
        );
      }
      await db.transaction(async (tx) => {
        await worksRepository.softDelete(tx, id);
        await auditRepository.insert(tx, {
          userId: user.id,
          action: 'DELETE',
          entity: 'work',
          entityId: id,
          workId: id,
          oldValue: source.name,
        });
      });
    },

    listClients: () => clientsRepository.list(db),
  };
}
