import {
  inccRatesFromIndices,
  FEE_COMPETENCE_LAG_MONTHS,
  calculateProjection,
  computeKpis,
  computeProgressIndicators,
  hydrateProjection,
  monthIndexIn,
  resolveEffectiveCurve,
  type EffectiveCurve,
  type FeeAdjustment,
  type ManualCell,
  type ProjectionResult,
  type RecalcMode,
  type Series,
} from '@unita/engine';
import type {
  AuditLogDto,
  CalculateBody,
  ProjectionDto,
  UpdateProjectionBody,
} from '@unita/contracts';
import type { Db } from '../../database/client.js';
import {
  actualCurvesRepository,
  type ActualCurveWithPoints,
} from '../../database/repositories/actual-curves.repository.js';
import { auditRepository, type AuditEntry } from '../../database/repositories/audit.repository.js';
import {
  progressIndicatorsRepository,
  toProgressEntry,
} from '../../database/repositories/consolidated-inputs.repository.js';
import { curvesRepository } from '../../database/repositories/curves.repository.js';
import {
  feeIssuancesRepository,
  toEngineIssuance,
} from '../../database/repositories/fee-issuances.repository.js';
import {
  inccIndicesRepository,
  toEngineInccIndex,
} from '../../database/repositories/incc-indices.repository.js';
import {
  projectionsRepository,
  type ProjectionRow,
  type ProjectionValueRow,
} from '../../database/repositories/projections.repository.js';
import { worksRepository, type WorkRow } from '../../database/repositories/works.repository.js';
import type { Actor, AppDeps, AuthUser } from '../../types.js';
import { currentMonth, toMonth } from '../../utils/dates.js';
import { badRequest, notFound } from '../../utils/errors.js';

export const ENGINE_VERSION = '0.3.0';

/** Snapshot persisted with every projection version (traceability — spec §39). */
export interface ProjectionParameters {
  /** Effective schedule (own curve start/length when curveSource = WORK_ACTUAL). */
  startDate: string;
  durationMonths: number;
  plannedStartDate?: string;
  contractDurationMonths?: number;
  curveSource?: 'PARAMETRIC' | 'WORK_ACTUAL';
  workActualCurveId?: string | null;
  workActualCurveVersion?: number | null;
  budget: string;
  feeRate: string;
  feeLagMonths: number;
  mode: RecalcMode;
  manualCount: number;
  curveVersionId: string;
  engineVersion: string;
  droppedManualCells?: number;
  /** Issuances/INCC in force when the version was generated (null = budget × rate). */
  feeAdjustment?: FeeAdjustment | null;
  /** Legacy (≤ 0.2.0): "Ajuste projeção de taxa", replaced by the fee issuances. */
  feeRecalibration?: unknown;
}

/**
 * Rebuilds a stored version through the engine — the single read path used by the
 * projection screen and the Consolidado.
 */
export function hydrateStoredProjection(
  row: Pick<ProjectionRow, 'parameters'>,
  values: readonly ProjectionValueRow[],
): ProjectionResult {
  const params = row.parameters as ProjectionParameters;
  const pick = (series: Series) =>
    values
      .filter((v) => v.series === series)
      .map((v) => ({
        periodIndex: v.periodIndex,
        original: v.originalValue,
        current: v.currentValue,
        origin: v.origin,
      }));
  return hydrateProjection({
    startDate: params.startDate,
    durationMonths: params.durationMonths,
    budget: params.budget,
    feeRate: params.feeRate,
    feeLagMonths: params.feeLagMonths,
    mode: params.mode,
    feeAdjustment: params.feeAdjustment ?? null,
    physical: pick('PHYSICAL'),
    fee: pick('FEE'),
  });
}

/** True when the version was generated before the current fee rules (M−1, issuances, INCC). */
export function usesOutdatedFeeRules(params: ProjectionParameters): boolean {
  return params.feeLagMonths !== FEE_COMPETENCE_LAG_MONTHS || params.feeRecalibration != null;
}

/** Manual cell anchored to its competence month, so it survives a change of start month. */
export type AnchoredManualCell = ManualCell & { month?: string };

export function manualFromValues(values: ProjectionValueRow[]): AnchoredManualCell[] {
  return values
    .filter((v) => v.origin === 'MANUAL')
    .map((v) => ({
      series: v.series,
      periodIndex: v.periodIndex,
      value: v.currentValue,
      month: v.periodMonth,
    }));
}

/** Re-indexes manual cells on the effective schedule and drops those outside it. */
function placeManualCells(
  cells: readonly AnchoredManualCell[],
  effective: EffectiveCurve,
): ManualCell[] {
  return cells.flatMap((c) => {
    const periodIndex = c.month ? monthIndexIn(effective.startDate, c.month) : c.periodIndex;
    const limit =
      c.series === 'PHYSICAL'
        ? effective.durationMonths
        : effective.durationMonths + FEE_COMPETENCE_LAG_MONTHS;
    return periodIndex >= 1 && periodIndex <= limit
      ? [{ series: c.series, periodIndex, value: c.value }]
      : [];
  });
}

const cellKey = (series: Series, periodIndex: number) => `${series}:${periodIndex}`;

/** Curve in force for a work today (or at `referenceMonth`) — see resolveEffectiveCurve. */
export async function resolveWorkCurve(
  tx: Db,
  work: WorkRow,
  referenceMonth: string = currentMonth(),
  preloaded?: {
    parametric?: Awaited<ReturnType<typeof curvesRepository.getPoints>>;
    actual?: ActualCurveWithPoints | null;
  },
): Promise<{ effective: EffectiveCurve; actual: ActualCurveWithPoints | null }> {
  const parametric =
    preloaded?.parametric ?? (await curvesRepository.getPoints(tx, work.curveVersionId));
  const actual =
    preloaded?.actual !== undefined
      ? preloaded.actual
      : ((await actualCurvesRepository.findCurrent(tx, work.id)) ?? null);
  const effective = resolveEffectiveCurve({
    startDate: work.startDate,
    durationMonths: work.durationMonths,
    referenceMonth,
    parametric,
    actual: actual ? { startMonth: actual.startMonth, points: actual.points } : null,
  });
  return { effective, actual };
}

/** True when the stored projection was generated from another curve than the one in force. */
export function projectionNeedsRecalc(
  projection: Pick<ProjectionRow, 'curveSource' | 'workActualCurveId'>,
  effective: EffectiveCurve,
  actual: ActualCurveWithPoints | null,
): boolean {
  if (projection.curveSource !== effective.source) return true;
  return effective.source === 'WORK_ACTUAL' && projection.workActualCurveId !== actual?.id;
}

/**
 * Runs the engine for a work and stores the result as a new current version.
 * The curve is the one in force today: own curve for started works that have one, otherwise
 * the parametric curve. Exported so other services can generate inside their transaction.
 */
export async function generateProjection(
  tx: Db,
  work: WorkRow,
  user: AuthUser | null,
  options: { mode: RecalcMode; manualCells: AnchoredManualCell[]; note: string | null },
): Promise<{ row: ProjectionRow; result: ProjectionResult; dropped: number }> {
  const { effective, actual } = await resolveWorkCurve(tx, work);
  const kept = placeManualCells(options.manualCells, effective);
  const [issuances, inccIndices] = await Promise.all([
    feeIssuancesRepository.listByWork(tx, work.id),
    inccIndicesRepository.list(tx),
  ]);
  const result = calculateProjection({
    startDate: effective.startDate,
    durationMonths: effective.durationMonths,
    curve: effective.curve,
    budget: work.budget,
    feeRate: work.feeRate,
    manualCells: kept,
    mode: options.mode,
    feeIssuances: issuances.map(toEngineIssuance),
    // The engine derives the monthly variation from the number-index (single rule).
    inccRates: inccRatesFromIndices(inccIndices.map(toEngineInccIndex)),
  });
  const dropped = options.mode === 'PRESERVE_MANUAL' ? options.manualCells.length - kept.length : 0;
  const workActualCurveId = effective.source === 'WORK_ACTUAL' ? (actual?.id ?? null) : null;
  const parameters: ProjectionParameters = {
    startDate: effective.startDate,
    durationMonths: effective.durationMonths,
    plannedStartDate: work.startDate,
    contractDurationMonths: work.durationMonths,
    curveSource: effective.source,
    workActualCurveId,
    workActualCurveVersion: workActualCurveId ? (actual?.version ?? null) : null,
    budget: result.parameters.budget,
    feeRate: result.parameters.feeRate,
    feeLagMonths: result.parameters.feeLagMonths,
    mode: options.mode,
    manualCount: result.parameters.manualCount,
    curveVersionId: work.curveVersionId,
    engineVersion: ENGINE_VERSION,
    ...(dropped > 0 ? { droppedManualCells: dropped } : {}),
    feeAdjustment: result.parameters.feeAdjustment,
  };
  const row = await projectionsRepository.createVersion(
    tx,
    {
      workId: work.id,
      curveVersionId: work.curveVersionId,
      curveSource: effective.source,
      workActualCurveId,
      parameters: { ...parameters },
      note: options.note,
      createdById: user?.id ?? null,
    },
    [
      { series: 'PHYSICAL', cells: result.physical },
      { series: 'FEE', cells: result.fee },
    ],
  );
  return { row, result, dropped };
}

/**
 * New version after a change of the fee inputs (issuances, INCC): same curve and parameters,
 * manual cells preserved, audited on the work's history. A pending "preserve or replace"
 * decision (isStale) stays pending on the new version.
 */
export async function regenerateKeepingManualCells(
  tx: Db,
  work: WorkRow,
  actor: Actor,
  note: string,
): Promise<{ row: ProjectionRow; result: ProjectionResult }> {
  const current = await projectionsRepository.findCurrent(tx, work.id);
  const values = current ? await projectionsRepository.getValues(tx, current.projection.id) : [];
  const { row, result } = await generateProjection(tx, work, actor.user, {
    mode: 'PRESERVE_MANUAL',
    manualCells: manualFromValues(values),
    note,
  });
  if (current?.projection.isStale) await projectionsRepository.markStale(tx, work.id);
  await auditRepository.insert(tx, {
    userId: actor.user?.id ?? null,
    action: 'RECALCULATE',
    entity: 'projection',
    entityId: row.id,
    workId: work.id,
    field: note.slice(0, 80),
    newValue: `V${row.version}`,
    origin: 'CURVE',
    metadata: { integration: actor.integration },
  });
  return { row, result };
}

function integrationLabel(metadata: unknown): string | null {
  const name = (metadata as { integration?: unknown } | null)?.integration;
  return typeof name === 'string' ? `Integração: ${name}` : null;
}

export function createProjectionsService({ db }: AppDeps) {
  async function loadWork(tx: Db, workId: string): Promise<WorkRow> {
    const found = await worksRepository.findById(tx, workId);
    if (!found) throw notFound('Obra');
    return found.work;
  }

  async function loadCurrent(tx: Db, workId: string) {
    const current = await projectionsRepository.findCurrent(tx, workId);
    if (!current) throw notFound('Projeção');
    const values = await projectionsRepository.getValues(tx, current.projection.id);
    return { ...current, values };
  }

  /** Measured progress ("Realizado Acumulado") of the latest closing ≤ reference month. */
  async function realizedProgress(workId: string, referenceMonth: string) {
    const rows = await progressIndicatorsRepository.listByWork(db, workId);
    const { realizedCumulative, realizedMonth } = computeProgressIndicators(
      rows.map(toProgressEntry),
      referenceMonth,
    );
    return { physicalRealized: realizedCumulative, physicalRealizedMonth: realizedMonth };
  }

  async function toDto(workId: string, referenceDate?: string): Promise<ProjectionDto> {
    await loadWork(db, workId);
    const { projection, createdBy, values } = await loadCurrent(db, workId);
    const result = hydrateStoredProjection(projection, values);
    const referenceMonth = referenceDate ? toMonth(referenceDate) : currentMonth();
    return {
      id: projection.id,
      workId,
      version: projection.version,
      curveVersionId: projection.curveVersionId,
      curveSource: projection.curveSource,
      workActualCurveId: projection.workActualCurveId,
      isStale: projection.isStale,
      createdAt: projection.createdAt.toISOString(),
      createdBy,
      note: projection.note,
      physical: result.physical,
      fee: result.fee,
      totals: result.totals,
      manualCount: result.parameters.manualCount,
      kpis: {
        ...computeKpis(result, referenceMonth),
        ...(await realizedProgress(workId, referenceMonth)),
      },
      validations: result.validations,
    };
  }

  return {
    getCurrent: toDto,

    /** dryRun → impact report (manual cells that would be affected); otherwise a new version. */
    async calculate(workId: string, body: CalculateBody, user: AuthUser) {
      const work = await loadWork(db, workId);
      const { values } = await loadCurrent(db, workId);
      const manualCells = manualFromValues(values);
      if (body.dryRun) {
        return { dryRun: true as const, manualCount: manualCells.length, manualCells };
      }
      await db.transaction(async (tx) => {
        const { row, dropped } = await generateProjection(tx, work, user, {
          mode: body.mode,
          manualCells,
          note: body.note ?? null,
        });
        await auditRepository.insert(tx, {
          userId: user.id,
          action: 'RECALCULATE',
          entity: 'projection',
          entityId: row.id,
          workId,
          newValue: `V${row.version}`,
          origin: 'CURVE',
          metadata: {
            mode: body.mode,
            manualCells: manualCells.length,
            droppedManualCells: dropped,
          },
        });
      });
      return toDto(workId);
    },

    /** Applies manual edits (value=null resets to curve) and saves them as a new version. */
    async update(workId: string, body: UpdateProjectionBody, user: AuthUser) {
      const work = await loadWork(db, workId);
      await db.transaction(async (tx) => {
        const { values } = await loadCurrent(tx, workId);
        const manual = new Map(
          manualFromValues(values).map((c) => [cellKey(c.series, c.periodIndex), c]),
        );
        const previous = new Map(values.map((v) => [cellKey(v.series, v.periodIndex), v]));
        for (const change of body.changes) {
          const key = cellKey(change.series, change.periodIndex);
          if (previous.get(key)?.origin === 'ISSUED') {
            throw badRequest(
              'Este mês já tem taxa emitida. Altere o valor emitido na aba Consolidado.',
            );
          }
          if (change.value === null) manual.delete(key);
          else
            manual.set(key, {
              series: change.series,
              periodIndex: change.periodIndex,
              value: change.value,
              month: previous.get(key)?.periodMonth,
            });
        }
        const { row, result } = await generateProjection(tx, work, user, {
          mode: 'PRESERVE_MANUAL',
          manualCells: [...manual.values()],
          note: body.note ?? null,
        });
        const cells = new Map(
          [
            ...result.physical.map((c) => ['PHYSICAL', c] as const),
            ...result.fee.map((c) => ['FEE', c] as const),
          ].map(([s, c]) => [cellKey(s, c.periodIndex), c]),
        );
        const entries: AuditEntry[] = body.changes.map((change) => {
          const key = cellKey(change.series, change.periodIndex);
          const next = cells.get(key);
          return {
            userId: user.id,
            action: change.value === null ? 'RESET_CELL' : 'EDIT_CELL',
            entity: 'projection',
            entityId: row.id,
            workId,
            field: `${change.series} ${next?.label ?? `#${change.periodIndex}`}`,
            oldValue: previous.get(key)?.currentValue ?? null,
            newValue: next?.current ?? change.value,
            origin: next?.origin ?? 'MANUAL',
            metadata: { version: row.version, periodIndex: change.periodIndex, month: next?.month },
          };
        });
        await auditRepository.insert(tx, entries);
      });
      return toDto(workId);
    },

    async versions(workId: string) {
      await loadWork(db, workId);
      const rows = await projectionsRepository.listVersions(db, workId);
      return rows.map(({ projection: p, createdBy }) => ({
        id: p.id,
        version: p.version,
        isCurrent: p.isCurrent,
        curveVersionId: p.curveVersionId,
        curveSource: p.curveSource,
        createdAt: p.createdAt.toISOString(),
        createdBy,
        note: p.note,
      }));
    },

    async audit(workId: string, page: number, pageSize: number) {
      await loadWork(db, workId);
      const { rows, total } = await auditRepository.listByWork(db, workId, page, pageSize);
      const items: AuditLogDto[] = rows.map(({ log, userName }) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        user: userName ?? integrationLabel(log.metadata),
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        field: log.field,
        oldValue: log.oldValue,
        newValue: log.newValue,
        origin: log.origin,
      }));
      return { items, page, pageSize, total };
    },
  };
}
