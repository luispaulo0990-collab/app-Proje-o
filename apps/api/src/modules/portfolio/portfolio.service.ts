import {
  Decimal,
  MONEY_SCALE,
  toFixedString,
  buildConsolidatedPanel,
  computeEconomicIndicators,
  computeProgressIndicators,
  firstProgressMonth,
  monthsBetween,
  monthsIncurred,
  projectedEndMonth,
  type ProjectionCell,
} from '@unita/engine';
import type { ConsolidatedDto, ConsolidatedQuery, ConsolidatedWorkDto } from '@unita/contracts';
import {
  economicIndicatorsRepository,
  progressIndicatorsRepository,
  toEconomicEntry,
  toProgressEntry,
} from '../../database/repositories/consolidated-inputs.repository.js';
import { feeIssuancesRepository } from '../../database/repositories/fee-issuances.repository.js';
import { loadPortfolio } from '../../services/portfolio-loader.js';
import type { AppDeps } from '../../types.js';
import { currentMonth, toMonth } from '../../utils/dates.js';
import { toIssuanceDto } from '../fees/fees.service.js';
import {
  hydrateStoredProjection,
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
      const [indicatorsByWork, economicByWork, issuanceByWork] = await Promise.all([
        progressIndicatorsRepository.listByWorks(db, ids),
        economicIndicatorsRepository.listByWorks(db, ids),
        feeIssuancesRepository.listByWorksAtMonth(db, ids, referenceMonth),
      ]);

      const hydrated = entries.map((e) => {
        const { row, values } = e.projection as NonNullable<typeof e.projection>;
        return { entry: e, result: hydrateStoredProjection(row, values) };
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
        const economicRows = economicByWork.get(w.id) ?? [];
        const lastEconomic = economicRows.reduce<(typeof economicRows)[number] | null>(
          (acc, r) => (!acc || r.updatedAt > acc.updatedAt ? r : acc),
          null,
        );
        const issuance = issuanceByWork.get(w.id);
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
          economic: {
            ...computeEconomicIndicators(economicRows.map(toEconomicEntry), referenceMonth),
            source: lastEconomic?.source ?? null,
            updatedAt: lastEconomic?.updatedAt.toISOString() ?? null,
          },
          feeIssuance: issuance ? toIssuanceDto(issuance) : null,
          acceptsIssuance: result.fee.some((c) => c.month === referenceMonth),
          feeAdjustment: params?.feeAdjustment ?? null,
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
          issuedWorksAtReference: works.filter((w) => w.feeIssuance).length,
        },
        works,
      };
    },
  };
}
