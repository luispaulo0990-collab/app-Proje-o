import type { CumulativeEntry, EconomicEntry, ProgressEntry } from '@unita/engine';

/** One work's cumulative physical curve as reported by an external system. */
export interface ExternalWorkCurve {
  /** Work name exactly as written in the source (matched against the company standard names). */
  workName: string;
  /** Identifier in the source system (e.g. "Nº Obra UAU"). */
  externalRef: string | null;
  clientName: string | null;
  entries: CumulativeEntry[];
  /** Realized / client replanning / target per month (optional columns of the source). */
  indicators?: ProgressEntry[];
}

export interface ProviderReadIssue {
  row: number;
  message: string;
}

/**
 * Port for systems that supply the own curve of started works (Integration Layer).
 * Adapters live under `src/integrations/<system>/`; the domain never imports them.
 */
export interface WorkCurveProvider {
  /** Label saved as `source` on every imported curve version. */
  readonly source: string;
  /** Human-readable origin (sheet / endpoint) shown in reports. */
  readonly description: string;
  fetchCurves(): Promise<{ curves: ExternalWorkCurve[]; issues: ProviderReadIssue[] }>;
}

/** One work's monthly economic closings ("IEC Obra") as reported by an external system. */
export interface ExternalEconomicSeries {
  workName: string;
  clientName: string | null;
  entries: EconomicEntry[];
}

/** Port for systems that supply the economic closing of the works (Integration Layer). */
export interface EconomicIndicatorProvider {
  readonly source: string;
  readonly description: string;
  fetchEconomic(): Promise<{ series: ExternalEconomicSeries[]; issues: ProviderReadIssue[] }>;
}

/**
 * Company-standard work names are compared ignoring case, accents, repeated spaces and
 * surrounding punctuation — "Vila  das Belezas " matches "VILA DAS BELEZAS".
 */
export function normalizeWorkName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
