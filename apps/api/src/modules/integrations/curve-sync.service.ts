import { EngineValidationError, curveFromCumulativeSeries } from '@unita/engine';
import type { CurveSyncReportDto } from '@unita/contracts';
import { actualCurvesRepository } from '../../database/repositories/actual-curves.repository.js';
import { progressIndicatorsRepository } from '../../database/repositories/consolidated-inputs.repository.js';
import { worksRepository } from '../../database/repositories/works.repository.js';
import type { WorkCurveProvider } from '../../integrations/work-curve-provider.js';
import { matchWorkNames } from '../../integrations/work-name-matcher.js';
import type { Actor, AppDeps } from '../../types.js';
import type { ProgressEntry } from '@unita/engine';
import {
  canonicalProgressEntries,
  saveProgressIndicators,
} from '../portfolio/consolidated-inputs.service.js';
import {
  createWorkCurvesService,
  parseActualCurveBody,
} from '../work-curves/work-curves.service.js';

type Item = CurveSyncReportDto['items'][number];

/**
 * Application service that pulls own curves from a provider and imports them work by work.
 *
 * - Matching uses the company-standard work names registered in the system (normalized);
 *   sheet names prefixed with client/brand are matched as APPROXIMATE (review in the simulation).
 * - A curve identical to the current version is skipped (no version spam on every sync).
 * - Each work is imported in its own transaction: one bad row never blocks the others.
 */
export function createCurveSyncService(deps: AppDeps) {
  const { db } = deps;
  const workCurves = createWorkCurvesService(deps);

  /**
   * Stores the Consolidado indicators of a matched work (realized, client replanning, target).
   * Independent of the curve outcome: a rejected curve does not block the indicators.
   */
  async function syncIndicators(
    workId: string,
    ext: { indicators?: ProgressEntry[]; externalRef: string | null },
    context: { dryRun: boolean; source: string; actor: Actor },
  ): Promise<Pick<Item, 'indicatorMonths' | 'indicators'>> {
    const entries = canonicalProgressEntries(ext.indicators ?? []);
    if (entries.length === 0 || context.dryRun)
      return { indicatorMonths: entries.length, indicators: null };
    const existing = await progressIndicatorsRepository.listByWork(db, workId);
    const same =
      existing.length === entries.length &&
      existing.every((r, i) => {
        const e = entries[i];
        return (
          e !== undefined &&
          r.month === e.month &&
          r.realizedCumulative === e.realizedCumulative &&
          r.clientReplannedCumulative === e.clientReplannedCumulative &&
          r.targetCumulative === e.targetCumulative
        );
      });
    if (same) return { indicatorMonths: entries.length, indicators: 'UNCHANGED' };
    await db.transaction((tx) =>
      saveProgressIndicators(
        tx,
        workId,
        { source: context.source, externalRef: ext.externalRef, entries },
        context.actor,
      ),
    );
    return { indicatorMonths: entries.length, indicators: 'SAVED' };
  }

  return {
    async sync(
      provider: WorkCurveProvider,
      actor: Actor,
      options: { dryRun: boolean },
    ): Promise<CurveSyncReportDto> {
      const { curves, issues: readIssues } = await provider.fetchCurves();

      const works = await worksRepository.listAll(db, { includeArchived: false });
      // Sheet names often carry the client/brand ("Viva Benx Klabin" → "Klabin"); see matcher.
      const matches = matchWorkNames(
        curves.map((c, i) => ({ key: String(i), name: c.workName, client: c.clientName })),
        works.map((w) => ({ id: w.work.id, name: w.work.name, clientName: w.clientName })),
      );
      const workById = new Map(works.map((w) => [w.work.id, w.work]));
      const seen = new Set<string>();
      const items: Item[] = [];
      const unmatched: CurveSyncReportDto['unmatched'] = [];

      for (const [i, ext] of curves.entries()) {
        const match = matches.get(String(i));
        const work = match ? workById.get(match.workId) : undefined;
        if (!match || !work) {
          unmatched.push({ sheetName: ext.workName, externalRef: ext.externalRef });
          continue;
        }
        seen.add(work.id);
        const indicators = await syncIndicators(work.id, ext, {
          dryRun: options.dryRun,
          source: provider.source,
          actor,
        });
        const base = {
          workId: work.id,
          workName: work.name,
          sheetName: ext.workName,
          externalRef: ext.externalRef,
          match: match.kind,
          ...indicators,
        };
        const series = curveFromCumulativeSeries(ext.entries);
        const reject = (issues: Item['issues']): Item => ({
          ...base,
          outcome: 'REJECTED',
          startMonth: null,
          periods: null,
          version: null,
          projection: null,
          issues,
        });
        if (series.issues.length > 0) {
          items.push(reject(series.issues));
          continue;
        }
        const body = {
          source: provider.source,
          externalRef: ext.externalRef ?? undefined,
          months: series.months,
          normalize: series.needsNormalization,
          note: `Sincronizado de ${provider.description}`,
        };
        let parsed: ReturnType<typeof parseActualCurveBody>;
        try {
          parsed = parseActualCurveBody(body, work);
        } catch (err) {
          if (err instanceof EngineValidationError) {
            items.push(reject(err.issues));
            continue;
          }
          throw err;
        }

        const current = await actualCurvesRepository.findCurrent(db, work.id);
        const unchanged =
          current?.source === provider.source &&
          current.startMonth === parsed.startMonth &&
          current.points.length === parsed.canonical.length &&
          current.points.every((p, i) => p.monthlyPct === parsed.canonical[i]?.monthlyPct);
        const summary = { startMonth: parsed.startMonth, periods: parsed.canonical.length };

        if (unchanged) {
          items.push({
            ...base,
            ...summary,
            outcome: 'UNCHANGED',
            version: current.version,
            projection: null,
            issues: [],
          });
        } else if (options.dryRun) {
          items.push({
            ...base,
            ...summary,
            outcome: 'WOULD_IMPORT',
            version: (current?.version ?? 0) + 1,
            projection: null,
            issues: [],
          });
        } else {
          const result = await workCurves.importActualCurve(work.id, body, actor);
          items.push({
            ...base,
            ...summary,
            outcome: 'IMPORTED',
            version: result.actualCurve.version,
            projection: result.projection.outcome,
            issues: result.issues,
          });
        }
      }

      const count = (o: Item['outcome']) => items.filter((i) => i.outcome === o).length;
      return {
        dryRun: options.dryRun,
        source: provider.source,
        description: provider.description,
        readAt: new Date().toISOString(),
        totals: {
          sheetWorks: curves.length,
          matched: items.length,
          imported: count('IMPORTED') + count('WOULD_IMPORT'),
          unchanged: count('UNCHANGED'),
          rejected: count('REJECTED'),
          unmatched: unmatched.length,
          withIndicators: items.filter((i) => i.indicatorMonths > 0).length,
        },
        items,
        unmatched,
        missingInSheet: works
          .filter((w) => !seen.has(w.work.id))
          .map((w) => ({ workId: w.work.id, workName: w.work.name })),
        readIssues,
      };
    },
  };
}
