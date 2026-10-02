import { z } from 'zod';
import { uuid, validationIssue } from './common.js';

export const integrationStatusDto = z.object({
  microsoftGraph: z.object({
    configured: z.boolean(),
    /** e.g. `SharePoint · aba "BD_Infos Gerais" · coluna "Replanejado Atual Acumulado - Obra"`. */
    description: z.string().nullable(),
  }),
});
export type IntegrationStatusDto = z.infer<typeof integrationStatusDto>;

export const curveSyncBody = z.object({
  /** Simulates: reads and matches everything, saves nothing. */
  dryRun: z.boolean().default(false),
});

export const curveSyncOutcome = z.enum(['IMPORTED', 'UNCHANGED', 'WOULD_IMPORT', 'REJECTED']);

export const curveSyncReportDto = z.object({
  dryRun: z.boolean(),
  source: z.string(),
  description: z.string(),
  readAt: z.string(),
  totals: z.object({
    sheetWorks: z.number().int(),
    matched: z.number().int(),
    imported: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
    unmatched: z.number().int(),
    /** Works whose progress indicators (Consolidado) were read / saved. */
    withIndicators: z.number().int(),
  }),
  items: z.array(
    z.object({
      workId: uuid,
      workName: z.string(),
      sheetName: z.string(),
      externalRef: z.string().nullable(),
      /** EXACT = same name; APPROXIMATE = registered name inside the sheet name (e.g. with brand). */
      match: z.enum(['EXACT', 'APPROXIMATE']),
      outcome: curveSyncOutcome,
      startMonth: z.string().nullable(),
      periods: z.number().int().nullable(),
      version: z.number().int().nullable(),
      /** What happened to the projection (only when imported). */
      projection: z.enum(['RECALCULATED', 'MARKED_STALE', 'NOT_IN_FORCE']).nullable(),
      issues: z.array(validationIssue),
      /** Months with realized / client replanning / target read for the Consolidado. */
      indicatorMonths: z.number().int(),
      /** SAVED, UNCHANGED, or null (nothing read / simulation). */
      indicators: z.enum(['SAVED', 'UNCHANGED']).nullable(),
    }),
  ),
  /** Works in the sheet whose name does not match any registered work. */
  unmatched: z.array(z.object({ sheetName: z.string(), externalRef: z.string().nullable() })),
  /** Registered works that are absent from the sheet. */
  missingInSheet: z.array(z.object({ workId: uuid, workName: z.string() })),
  readIssues: z.array(z.object({ row: z.number().int(), message: z.string() })),
  /** "IEC Obra" read from "BD_Econômico" (null = sheet not configured for this provider). */
  economic: z
    .object({
      description: z.string(),
      sheetWorks: z.number().int(),
      /** Works whose closings were saved (or would be, in a simulation). */
      saved: z.number().int(),
      unchanged: z.number().int(),
      items: z.array(
        z.object({
          workId: uuid,
          workName: z.string(),
          sheetName: z.string(),
          match: z.enum(['EXACT', 'APPROXIMATE']),
          months: z.number().int(),
          /** Latest closing read (month / IEC / result), as in the sheet. */
          lastMonth: z.string().nullable(),
          lastIec: z.string().nullable(),
          lastProjectedResult: z.string().nullable(),
          outcome: z.enum(['SAVED', 'WOULD_SAVE', 'UNCHANGED']),
        }),
      ),
      unmatched: z.array(z.string()),
      readIssues: z.array(z.object({ row: z.number().int(), message: z.string() })),
    })
    .nullable(),
});
export type CurveSyncReportDto = z.infer<typeof curveSyncReportDto>;
