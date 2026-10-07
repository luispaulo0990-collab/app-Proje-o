import {
  EngineValidationError,
  buildCurveSeries,
  buildPeriods,
  canonicalizeCurve,
  monthIndexIn,
  normalizeCurveWeights,
  parseIsoMonth,
  pointsFromMonths,
  type CurvePointInput,
  type ValidationIssue,
} from '@unita/engine';
import type {
  ActualCurveBody,
  ActualCurveDto,
  ActualCurveStateDto,
  ImportActualCurveResponse,
  SyncWorkCurvesResponse,
  WorkCurveItemDto,
  WorkCurvesQuery,
  WorkCurvesResponse,
} from '@unita/contracts';
import type { Db } from '../../database/client.js';
import {
  actualCurvesRepository,
  type ActualCurveRow,
  type ActualCurveWithPoints,
} from '../../database/repositories/actual-curves.repository.js';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import { projectionsRepository } from '../../database/repositories/projections.repository.js';
import { worksRepository, type WorkRow } from '../../database/repositories/works.repository.js';
import { loadPortfolio } from '../../services/portfolio-loader.js';
import type { Actor, AppDeps } from '../../types.js';
import { currentMonth, toMonth } from '../../utils/dates.js';
import { notFound } from '../../utils/errors.js';
import {
  projectionNeedsRecalc,
  regenerateOrFlagStale,
  resolveWorkCurve,
} from '../projections/projections.service.js';

type Outcome = ImportActualCurveResponse['projection']['outcome'];

const actorAudit = (actor: Actor) => ({
  userId: actor.user?.id ?? null,
  integration: actor.integration,
});

function toVersionDto(row: ActualCurveRow, createdBy: string | null) {
  return {
    id: row.id,
    workId: row.workId,
    version: row.version,
    startMonth: row.startMonth,
    periods: row.periods,
    source: row.source,
    externalRef: row.externalRef,
    note: row.note,
    receivedVia: row.receivedVia,
    createdBy: createdBy ?? (row.receivedVia === 'API_KEY' ? `Integração: ${row.source}` : null),
    createdAt: row.createdAt.toISOString(),
  };
}

function toCurveDto(row: ActualCurveWithPoints, createdBy: string | null): ActualCurveDto {
  const periods = buildPeriods(parseIsoMonth(row.startMonth), row.points.length);
  return {
    ...toVersionDto(row, createdBy),
    points: row.points.map((p, i) => ({
      period: p.period,
      month: periods[i]?.month ?? '',
      label: periods[i]?.label ?? '',
      monthlyPct: p.monthlyPct,
      cumulativePct: p.cumulativePct,
    })),
  };
}

/** Validates the payload with the engine rules and returns canonical points + start month. */
export function parseActualCurveBody(body: ActualCurveBody, work: Pick<WorkRow, 'startDate'>) {
  const issues: ValidationIssue[] = [];
  let startMonth = body.startMonth ?? toMonth(work.startDate);
  let points: CurvePointInput[];
  if (body.months) {
    const parsed = pointsFromMonths(body.months);
    issues.push(...parsed.issues);
    startMonth = parsed.startMonth;
    points = parsed.points;
  } else {
    const sorted = [...(body.points ?? [])].sort((a, b) => a.period - b.period);
    points = sorted;
  }
  if (issues.length > 0) throw new EngineValidationError(issues);
  const canonical = body.normalize
    ? normalizeCurveWeights(points.map((p) => p.monthlyPct))
    : canonicalizeCurve(points);
  return { startMonth, canonical };
}

export function createWorkCurvesService({ db }: AppDeps) {
  async function loadWork(tx: Db, workId: string): Promise<WorkRow> {
    const found = await worksRepository.findById(tx, workId);
    if (!found) throw notFound('Obra');
    return found.work;
  }

  /**
   * Brings the projection in line with the curve in force, preserving manual cells (see
   * regenerateOrFlagStale): only a manual cell that no longer fits flags the projection stale.
   */
  async function applyCurveInForce(
    tx: Db,
    work: WorkRow,
    actor: Actor,
    reason: string,
  ): Promise<{ outcome: Outcome; version: number | null }> {
    const { outcome, row } = await regenerateOrFlagStale(tx, work, actor, reason);
    const current = row ?? (await projectionsRepository.findCurrent(tx, work.id))?.projection;
    return { outcome, version: current?.version ?? null };
  }

  return {
    /**
     * Applies the curve in force when the work's projection became outdated (e.g. a new
     * "Realizado Acumulado" moved the trend). Returns null when nothing had to change.
     */
    async refreshWork(tx: Db, work: WorkRow, actor: Actor, reason: string) {
      const current = await projectionsRepository.findCurrent(tx, work.id);
      if (!current || current.projection.isStale) return null;
      const { effective, actual } = await resolveWorkCurve(tx, work);
      if (!projectionNeedsRecalc(current.projection, effective, actual)) return null;
      return applyCurveInForce(tx, work, actor, reason);
    },

    async getActualCurve(workId: string): Promise<ActualCurveStateDto> {
      const work = await loadWork(db, workId);
      const [current, versions] = await Promise.all([
        actualCurvesRepository.findCurrent(db, workId),
        actualCurvesRepository.listVersions(db, workId),
      ]);
      const referenceMonth = currentMonth();
      const { effective } = await resolveWorkCurve(db, work, referenceMonth, {
        actual: current ?? null,
      });
      const createdBy = (id: string) => versions.find((v) => v.curve.id === id)?.createdBy ?? null;
      return {
        current: current ? toCurveDto(current, createdBy(current.id)) : null,
        versions: versions.map((v) => toVersionDto(v.curve, v.createdBy)),
        effective: { source: effective.source, status: effective.status, referenceMonth },
      };
    },

    /** Stores a new version of the work's own curve and applies it when it is in force. */
    async importActualCurve(
      workId: string,
      body: ActualCurveBody,
      actor: Actor,
    ): Promise<ImportActualCurveResponse> {
      const work = await loadWork(db, workId);
      const { startMonth, canonical } = parseActualCurveBody(body, work);
      return db.transaction(async (tx) => {
        const row = await actualCurvesRepository.createVersion(
          tx,
          {
            workId,
            startMonth,
            source: body.source,
            externalRef: body.externalRef ?? null,
            note: body.note ?? null,
            receivedVia: actor.integration ? 'API_KEY' : 'USER',
            createdById: actor.user?.id ?? null,
          },
          canonical,
        );
        const audit = actorAudit(actor);
        await auditRepository.insert(tx, {
          userId: audit.userId,
          action: 'IMPORT_ACTUAL_CURVE',
          entity: 'work_actual_curve',
          entityId: row.id,
          workId,
          newValue: `V${row.version} · ${row.periods} meses`,
          origin: body.source,
          metadata: {
            startMonth,
            externalRef: body.externalRef ?? null,
            normalized: body.normalize ?? false,
            integration: audit.integration,
          },
        });
        const saved: ActualCurveWithPoints = { ...row, points: canonical };
        const { effective } = await resolveWorkCurve(tx, work, currentMonth(), { actual: saved });
        const projection =
          effective.source === 'WORK_ACTUAL'
            ? await applyCurveInForce(
                tx,
                work,
                actor,
                `Curva própria V${row.version} (${body.source})`,
              )
            : { outcome: 'NOT_IN_FORCE' as const, version: null };
        return {
          actualCurve: toCurveDto(saved, actor.user?.name ?? null),
          projection,
          issues: effective.issues,
        };
      });
    },

    /** "Curvas das obras": the physical curve in force for each work on a common month axis. */
    async list(query: WorkCurvesQuery): Promise<WorkCurvesResponse> {
      const referenceMonth = query.referenceDate ? toMonth(query.referenceDate) : currentMonth();
      const entries = await loadPortfolio(db, query, referenceMonth);
      const counts = {
        NOT_STARTED: 0,
        STARTED_ACTUAL: 0,
        STARTED_AWAITING_ACTUAL: 0,
        needsRecalc: 0,
      };

      const items: WorkCurveItemDto[] = entries.map((e) => {
        const { effective, work } = e;
        const cells = buildCurveSeries(
          effective.startDate,
          effective.durationMonths,
          effective.curve,
        );
        const upTo = cells.filter((c) => monthIndexIn(c.month, referenceMonth) >= 1).at(-1);
        counts[effective.status] += 1;
        if (e.needsRecalc) counts.needsRecalc += 1;
        const last = cells.at(-1);
        return {
          workId: work.work.id,
          name: work.work.name,
          clientName: work.clientName,
          status: work.work.status,
          plannedStartDate: work.work.startDate,
          contractDurationMonths: work.work.durationMonths,
          curveStatus: effective.status,
          source: effective.source,
          startDate: effective.startDate,
          durationMonths: effective.durationMonths,
          endDate: last ? endOfMonth(last.month) : effective.startDate,
          parametric: {
            curveId: work.curveId,
            name: work.curveName,
            version: work.curveVersion,
          },
          actual: e.actual ? toVersionDto(e.actual, null) : null,
          trend: effective.trend,
          physicalAccumulated: upTo?.cumulative ?? '0.00000000',
          cells: cells.map((c) => ({
            month: c.month,
            label: c.label,
            monthly: c.monthly,
            cumulative: c.cumulative,
          })),
          needsRecalc: e.needsRecalc,
          issues: effective.issues,
        };
      });

      return { referenceMonth, months: monthAxis(items.flatMap((i) => i.cells)), items, counts };
    },

    /** Recalculates (or flags) every projection generated with a curve no longer in force. */
    async sync(actor: Actor): Promise<SyncWorkCurvesResponse> {
      const entries = await loadPortfolio(db, {}, currentMonth());
      const result = { recalculated: 0, markedStale: 0, unchanged: 0 };
      for (const e of entries) {
        if (!e.needsRecalc || e.projection?.row.isStale) {
          result.unchanged += 1;
          continue;
        }
        const { outcome } = await db.transaction((tx) =>
          applyCurveInForce(tx, e.work.work, actor, 'Sincronização de curvas das obras'),
        );
        if (outcome === 'RECALCULATED') result.recalculated += 1;
        else result.markedStale += 1;
      }
      return result;
    },
  };
}

function endOfMonth(month: string): string {
  const { year, month: m } = parseIsoMonth(month);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/** Continuous month axis covering every cell. */
function monthAxis(cells: readonly { month: string }[]) {
  if (cells.length === 0) return [];
  const sorted = [...new Set(cells.map((c) => c.month))].sort();
  const first = sorted[0] as string;
  const last = sorted[sorted.length - 1] as string;
  return buildPeriods(parseIsoMonth(first), monthIndexIn(first, last)).map((p) => ({
    month: p.month,
    label: p.label,
  }));
}
