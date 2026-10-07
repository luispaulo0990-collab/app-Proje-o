import { Decimal, PCT_SCALE, toFixedString, type InccPeriodicity } from '@unita/engine';
import type {
  FeeTermBody,
  FeeTermDto,
  FeeTermListResponse,
  FeeTermResponse,
} from '@unita/contracts';
import type { Db } from '../../database/client.js';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import {
  feeTermsRepository,
  type FeeTermWithAuthor,
} from '../../database/repositories/fee-terms.repository.js';
import { worksRepository, type WorkRow } from '../../database/repositories/works.repository.js';
import type { Actor, AppDeps } from '../../types.js';
import { toMonth } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import { regenerateKeepingManualCells } from '../projections/projections.service.js';
import { monthLabel, withAuthor } from './fee-inputs.shared.js';

const PERIODICITY_LABEL: Record<InccPeriodicity, string> = {
  MONTHLY: 'mensal',
  QUARTERLY: 'trimestral',
  FOUR_MONTHLY: 'quadrimestral',
  SEMIANNUAL: 'semestral',
  ANNUAL: 'anual',
};

/** "9% · INCC trimestral" — how a term appears in the history and in projection notes. */
export function describeFeeTerm(feeRate: string, periodicity: InccPeriodicity): string {
  const pct = new Decimal(feeRate).times(100).toFixed().replace('.', ',');
  return `${pct}% · INCC ${PERIODICITY_LABEL[periodicity]}`;
}

const toTermDto = (r: FeeTermWithAuthor): FeeTermDto => ({
  workId: r.workId,
  month: r.month,
  feeRate: r.feeRate,
  inccPeriodicity: r.inccPeriodicity,
  note: r.note,
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Fee conditions of a work over time ("vigências"): from a month on, the fee is received at a
 * new rate and/or the balance is corrected by the INCC with another periodicity. Every change is
 * audited and generates a new projection version (manual cells preserved); an engine rejection
 * rolls the change back (422).
 */
export function createFeeTermsService({ db }: AppDeps) {
  async function loadWork(tx: Db, workId: string): Promise<WorkRow> {
    const found = await worksRepository.findById(tx, workId);
    if (!found) throw notFound('Obra');
    return found.work;
  }

  return {
    async list(workId: string): Promise<FeeTermListResponse> {
      const work = await loadWork(db, workId);
      const rows = await feeTermsRepository.listByWork(db, workId);
      return {
        base: {
          feeRate: work.feeRate,
          inccPeriodicity: work.inccPeriodicity,
          inccBaseMonth: work.inccBaseMonth ?? toMonth(work.startDate),
        },
        items: rows.map(toTermDto),
      };
    },

    async set(
      workId: string,
      month: string,
      body: FeeTermBody,
      actor: Actor,
    ): Promise<FeeTermResponse> {
      const work = await loadWork(db, workId);
      const feeRate = toFixedString(new Decimal(body.feeRate), PCT_SCALE);
      const description = describeFeeTerm(feeRate, body.inccPeriodicity);
      return db.transaction(async (tx) => {
        const previous = await feeTermsRepository.find(tx, workId, month);
        const row = await feeTermsRepository.upsert(tx, {
          workId,
          month,
          feeRate,
          inccPeriodicity: body.inccPeriodicity,
          note: body.note ?? null,
          updatedById: actor.user?.id ?? null,
        });
        const { row: projection } = await regenerateKeepingManualCells(
          tx,
          work,
          actor,
          `Vigência ${monthLabel(month)}: ${description}`,
        );
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'FEE_TERM',
          entity: 'fee_term',
          workId,
          field: `Vigência da taxa ${monthLabel(month)}`,
          oldValue: previous ? describeFeeTerm(previous.feeRate, previous.inccPeriodicity) : null,
          newValue: description,
          origin: 'MANUAL',
          metadata: {
            version: projection.version,
            note: body.note ?? null,
            integration: actor.integration,
          },
        });
        return {
          term: toTermDto(withAuthor(row, actor)),
          projectionVersion: projection.version,
        };
      });
    },

    async remove(workId: string, month: string, actor: Actor): Promise<FeeTermResponse> {
      const work = await loadWork(db, workId);
      return db.transaction(async (tx) => {
        const removed = await feeTermsRepository.delete(tx, workId, month);
        if (!removed) throw notFound('Vigência da taxa');
        const { row: projection } = await regenerateKeepingManualCells(
          tx,
          work,
          actor,
          `Vigência ${monthLabel(month)} removida`,
        );
        await auditRepository.insert(tx, {
          userId: actor.user?.id ?? null,
          action: 'FEE_TERM_REMOVED',
          entity: 'fee_term',
          workId,
          field: `Vigência da taxa ${monthLabel(month)}`,
          oldValue: describeFeeTerm(removed.feeRate, removed.inccPeriodicity),
          newValue: null,
          origin: 'CURVE',
          metadata: { version: projection.version, integration: actor.integration },
        });
        return { term: null, projectionVersion: projection.version };
      });
    },
  };
}
