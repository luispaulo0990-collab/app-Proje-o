import {
  Decimal,
  INCC_INDEX_SCALE,
  MONEY_SCALE,
  addMonthsIso,
  inccRatesFromIndices,
  toFixedString,
} from '@unita/engine';
import type {
  FeeIssuanceBody,
  FeeIssuanceDto,
  FeeIssuanceListResponse,
  FeeIssuanceResponse,
  InccIndexBatchBody,
  InccIndexBatchResponse,
  InccIndexBody,
  InccIndexDto,
  InccIndexListResponse,
  InccIndexResponse,
} from '@unita/contracts';
import type { Db } from '../../database/client.js';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import {
  feeIssuancesRepository,
  type FeeIssuanceRow,
  type FeeIssuanceWithAuthor,
} from '../../database/repositories/fee-issuances.repository.js';
import {
  inccIndicesRepository,
  toEngineInccIndex,
  type InccIndexRow,
  type InccIndexWithAuthor,
} from '../../database/repositories/incc-indices.repository.js';
import { worksRepository, type WorkRow } from '../../database/repositories/works.repository.js';
import type { Actor, AppDeps } from '../../types.js';
import { AppError, notFound } from '../../utils/errors.js';
import { regenerateKeepingManualCells } from '../projections/projections.service.js';

const label = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

export const toIssuanceDto = (r: FeeIssuanceWithAuthor): FeeIssuanceDto => ({
  workId: r.workId,
  month: r.month,
  amount: r.amount,
  note: r.note,
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString(),
});

/** Index rows with the variation the engine derives from them (same rule as the fee). */
function toInccDtos(rows: readonly InccIndexWithAuthor[]): InccIndexDto[] {
  const rates = new Map(
    inccRatesFromIndices(rows.map(toEngineInccIndex)).map((r) => [r.month, r.rate]),
  );
  return rows.map((r) => ({
    month: r.month,
    index: r.indexValue,
    rate: rates.get(r.month) ?? null,
    note: r.note,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

const canonicalIndex = (v: string) => toFixedString(new Decimal(v), INCC_INDEX_SCALE);

/**
 * INCC of a month is used from the next month on: every work with issuances may change.
 * Exported for the INCC history load (seed).
 */
export async function regenerateWorksWithIssuances(tx: Db, actor: Actor, note: string) {
  const ids = await feeIssuancesRepository.listWorkIds(tx);
  for (const id of ids) {
    const found = await worksRepository.findById(tx, id);
    if (found) await regenerateKeepingManualCells(tx, found.work, actor, note);
  }
  return ids.length;
}

const withAuthor = <T extends FeeIssuanceRow | InccIndexRow>(row: T, actor: Actor) => ({
  ...row,
  updatedBy: actor.user?.name ?? (actor.integration ? `Integração: ${actor.integration}` : null),
});

/**
 * Fee inputs of the Consolidado: "taxa emitida" per work/month and the monthly INCC.
 * Every change is audited and produces new projection versions through the engine — an engine
 * rejection (e.g. issuance outside the fee horizon) rolls the whole change back (422).
 */
export function createFeesService({ db }: AppDeps) {
  async function loadWork(tx: Db, workId: string): Promise<WorkRow> {
    const found = await worksRepository.findById(tx, workId);
    if (!found) throw notFound('Obra');
    return found.work;
  }

  return {
    async listIssuances(workId: string): Promise<FeeIssuanceListResponse> {
      await loadWork(db, workId);
      const rows = await feeIssuancesRepository.listByWork(db, workId);
      return { items: rows.map(toIssuanceDto) };
    },

    async setIssuance(
      workId: string,
      month: string,
      body: FeeIssuanceBody,
      actor: Actor,
    ): Promise<FeeIssuanceResponse> {
      const work = await loadWork(db, workId);
      const amount = toFixedString(new Decimal(body.amount), MONEY_SCALE);
      return db.transaction(async (tx) => {
        const previous = await feeIssuancesRepository.find(tx, workId, month);
        const row = await feeIssuancesRepository.upsert(tx, {
          workId,
          month,
          amount,
          note: body.note ?? null,
          updatedById: actor.user?.id ?? null,
        });
        const { row: projection, result } = await regenerateKeepingManualCells(
          tx,
          work,
          actor,
          `Taxa emitida ${label(month)}`,
        );
        if (!result.fee.some((c) => c.month === month)) {
          throw new AppError(
            422,
            'FEE_ISSUANCE_OUT_OF_RANGE',
            `${label(month)} está fora do período de recebimento da obra.`,
          );
        }
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'FEE_ISSUANCE',
          entity: 'fee_issuance',
          workId,
          field: `Taxa emitida ${label(month)}`,
          oldValue: previous?.amount ?? null,
          newValue: amount,
          origin: 'MANUAL',
          metadata: {
            version: projection.version,
            note: body.note ?? null,
            integration: actor.integration,
          },
        });
        return {
          issuance: toIssuanceDto(withAuthor(row, actor)),
          projectionVersion: projection.version,
        };
      });
    },

    async deleteIssuance(
      workId: string,
      month: string,
      actor: Actor,
    ): Promise<FeeIssuanceResponse> {
      const work = await loadWork(db, workId);
      return db.transaction(async (tx) => {
        const removed = await feeIssuancesRepository.delete(tx, workId, month);
        if (!removed) throw notFound('Taxa emitida');
        const { row: projection } = await regenerateKeepingManualCells(
          tx,
          work,
          actor,
          `Taxa emitida ${label(month)} removida`,
        );
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'FEE_ISSUANCE_REMOVED',
          entity: 'fee_issuance',
          workId,
          field: `Taxa emitida ${label(month)}`,
          oldValue: removed.amount,
          newValue: null,
          origin: 'CURVE',
          metadata: { version: projection.version, integration: actor.integration },
        });
        return { issuance: null, projectionVersion: projection.version };
      });
    },

    async listIncc(): Promise<InccIndexListResponse> {
      return { items: toInccDtos(await inccIndicesRepository.list(db)) };
    },

    /** The DTO of one month needs the previous index to show its variation. */
    async setIncc(month: string, body: InccIndexBody, actor: Actor): Promise<InccIndexResponse> {
      const indexValue = canonicalIndex(body.index);
      return db.transaction(async (tx) => {
        const previous = await inccIndicesRepository.find(tx, month);
        await inccIndicesRepository.upsertMany(tx, [{ month, indexValue }], {
          note: body.note ?? null,
          updatedById: actor.user?.id ?? null,
        });
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'INCC_SET',
          entity: 'incc_index',
          field: `INCC ${label(month)}`,
          oldValue: previous?.indexValue ?? null,
          newValue: indexValue,
          origin: 'MANUAL',
          metadata: { note: body.note ?? null, integration: actor.integration },
        });
        const recalculatedWorks = await regenerateWorksWithIssuances(
          tx,
          actor,
          `INCC ${label(month)} (corrige ${label(addMonthsIso(month, 1))})`,
        );
        const dto = toInccDtos(
          (await inccIndicesRepository.list(tx)).map((r) =>
            r.month === month ? withAuthor(r, actor) : r,
          ),
        ).find((r) => r.month === month);
        return { index: dto ?? null, recalculatedWorks };
      });
    },

    async setInccBatch(body: InccIndexBatchBody, actor: Actor): Promise<InccIndexBatchResponse> {
      const items = body.items
        .map((i) => ({
          month: i.month.length === 7 ? `${i.month}-01` : i.month,
          indexValue: canonicalIndex(i.index),
        }))
        .sort((a, b) => (a.month < b.month ? -1 : 1));
      return db.transaction(async (tx) => {
        const saved = await inccIndicesRepository.upsertMany(tx, items, {
          note: body.note ?? null,
          updatedById: actor.user?.id ?? null,
        });
        const first = items[0]?.month ?? '';
        const last = items.at(-1)?.month ?? '';
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'INCC_IMPORT',
          entity: 'incc_index',
          field: `INCC ${label(first)} a ${label(last)}`,
          oldValue: null,
          newValue: `${saved.length} mês(es)`,
          origin: 'MANUAL',
          metadata: { note: body.note ?? null, integration: actor.integration },
        });
        const recalculatedWorks = await regenerateWorksWithIssuances(
          tx,
          actor,
          `INCC ${label(first)} a ${label(last)} importado`,
        );
        return { saved: saved.length, recalculatedWorks };
      });
    },

    async deleteIncc(month: string, actor: Actor): Promise<InccIndexResponse> {
      return db.transaction(async (tx) => {
        const removed = await inccIndicesRepository.delete(tx, month);
        if (!removed) throw notFound('INCC do mês');
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'INCC_REMOVED',
          entity: 'incc_index',
          field: `INCC ${label(month)}`,
          oldValue: removed.indexValue,
          newValue: null,
          origin: 'MANUAL',
          metadata: { integration: actor.integration },
        });
        const recalculatedWorks = await regenerateWorksWithIssuances(
          tx,
          actor,
          `INCC ${label(month)} removido`,
        );
        return { index: null, recalculatedWorks };
      });
    },
  };
}
