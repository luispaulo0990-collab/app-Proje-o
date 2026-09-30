import {
  Decimal,
  MONEY_SCALE,
  toFixedString,
  buildConsolidatedPanel,
  computeProgressIndicators,
  firstProgressMonth,
  hydrateProjection,
  monthsBetween,
  monthsIncurred,
  projectedEndMonth,
  type ProjectionCell,
  type Series,
} from '@unita/engine';
import type { ConsolidatedDto, ConsolidatedQuery, ConsolidatedWorkDto } from '@unita/contracts';
import {
  feeRecalibrationsRepository,
  progressIndicatorsRepository,
  toProgressEntry,
} from '../../database/repositories/consolidated-inputs.repository.js';
import { loadPortfolio } from '../../services/portfolio-loader.js';
import type { AppDeps } from '../../types.js';
import { currentMonth, toMonth } from '../../utils/dates.js';
import {
  storedFeeRecalibration,
  type ProjectionParameters,
} from '../projections/projections.service.js';

const toCells = (cells: readonly ProjectionCell[]) =>
  cells.map((c) => ({ month: c.month, value: c.current, origin: c.origin }));

export function createPortfolioService({ db }: AppDeps) {
  return {
    /**
     * "Consolidado" (equivalent to the Painel (2) sheet): every work's current projection on a
     * common month axis, with fee totals per month / year and received × receivable split.
     */
    async consolidated(query: ConsolidatedQuery): Promise<ConsolidatedDto> {
      const referenceMonth = query.referenceDate ? toMonth(query.referenceDate) : currentMonth();
      const entries = (await loadPortfolio(db, query, referenceMonth)).filter((e) => e.projection);
      const ids = entries.map((e) => e.work.work.id);
      const [indicatorsByWork, recalByWork] = await Promise.all([
        progressIndicatorsRepository.listByWorks(db, ids),
        feeRecalibrationsRepository.findCurrentByWorks(db, ids),
      ]);

      const hydrated = entries.map((e) => {
        const { row, values } = e.projection as NonNullable<typeof e.projection>;
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
        const result = hydrateProjection({
          startDate: params.startDate,
          durationMonths: params.durationMonths,
          budget: params.budget,
          feeRate: params.feeRate,
          feeLagMonths: params.feeLagMonths,
          mode: params.mode,
          feeRecalibration: storedFeeRecalibration(params),
          physical: pick('PHYSICAL'),
          fee: pick('FEE'),
        });
        return { entry: e, result };
      });

      const panel = buildConsolidatedPanel(
        hydrated.map(({ entry, result }) => ({
          workId: entry.work.work.id,
          physical: result.physical,
          fee: result.fee,
        })),
        referenceMonth,
      );
      const summaries = new Map(panel.works.map((w) => [w.workId, w]));

      const works: ConsolidatedWorkDto[] = hydrated.map(({ entry, result }) => {
        const w = entry.work.work;
        const s = summaries.get(w.id);
        const row = entry.projection?.row;
        const params = row?.parameters as ProjectionParameters | undefined;
        const firstMonth = firstProgressMonth(result.physical) ?? result.schedule.startDate;
        const endMonth = projectedEndMonth(result.physical);
        const curveMonths = endMonth ? monthsBetween(firstMonth, endMonth) : null;
        const incurred = monthsIncurred(firstMonth, referenceMonth);
        const indicatorRows = indicatorsByWork.get(w.id) ?? [];
        const lastIndicator = indicatorRows.reduce<(typeof indicatorRows)[number] | null>(
          (acc, r) => (!acc || r.updatedAt > acc.updatedAt ? r : acc),
          null,
        );
        const recal = recalByWork.get(w.id);
        return {
          workId: w.id,
          name: w.name,
          clientName: entry.work.clientName,
          status: w.status,
          budget: w.budget,
          units: w.units,
          feeRate: w.feeRate,
          startDate: result.schedule.startDate,
          endDate: result.schedule.endDate,
          startMonth: firstMonth,
          startSource:
            row?.curveSource === 'WORK_ACTUAL' ? ('API' as const) : ('PROJECTION' as const),
          projectedEndMonth: endMonth,
          monthsIncurred: curveMonths === null ? incurred : Math.min(incurred, curveMonths),
          curveMonths,
          progress: {
            ...computeProgressIndicators(
              indicatorRows.map(toProgressEntry),
              referenceMonth,
              firstMonth,
            ),
            source: lastIndicator?.source ?? null,
            updatedAt: lastIndicator?.updatedAt.toISOString() ?? null,
          },
          feeMonthsAfterReference: result.fee.filter((c) => c.month > referenceMonth).length,
          feeRecalibration: recal
            ? {
                id: recal.id,
                referenceMonth: recal.referenceMonth,
                fromMonth: recal.fromMonth,
                remainingTotal: recal.remainingTotal,
                previousRemaining: recal.previousRemaining,
                note: recal.note,
                createdBy: recal.createdBy,
                createdAt: recal.createdAt.toISOString(),
                applied: params?.feeRecalibration?.id === recal.id,
              }
            : null,
          curveSource: row?.curveSource ?? 'PARAMETRIC',
          projectionVersion: row?.version ?? 0,
          isStale: row?.isStale ?? false,
          needsRecalc: entry.needsRecalc,
          feeProjected: s?.feeProjected ?? '0.00',
          feeRealized: s?.feeRealized ?? '0.00',
          feeRemaining: s?.feeRemaining ?? '0.00',
          feeAtReference: s?.feeAtReference ?? '0.00',
          physicalAccumulated: s?.physicalAccumulated ?? '0.00000000',
          physical: toCells(result.physical),
          fee: toCells(result.fee),
        };
      });

      return {
        referenceMonth,
        months: panel.months.map((m) => ({
          month: m.month,
          label: m.label,
          feeTotal: m.feeTotal,
          feeYearToDate: m.feeYearToDate,
          activeWorks: m.activeWorks,
          isReference: m.isReference,
        })),
        years: panel.years,
        totals: {
          ...panel.totals,
          delayedWorks: works.filter((w) => w.progress.clientStatus === 'ATRASADA').length,
          budgetTotal: toFixedString(
            works.reduce((acc, w) => acc.plus(w.budget), new Decimal(0)),
            MONEY_SCALE,
          ),
          unitsTotal: works.reduce((acc, w) => acc + w.units, 0),
          recalibratedWorks: works.filter((w) => w.feeRecalibration).length,
        },
        works,
      };
    },
  };
}
