import { Decimal, MONEY_SCALE, toFixedString } from './decimal.js';
import type { DecimalString, IsoMonth } from './types.js';

/** IEC is an index (1.02 = 102%): kept with 6 decimals. */
export const IEC_SCALE = 6;

/**
 * Monthly economic closing of a work as reported by the cost-control system
 * (SharePoint "BD_Econômico", row "Geral", or the generic API).
 */
export interface EconomicEntry {
  month: IsoMonth;
  /** "IEC Obra". */
  iec?: DecimalString | null;
  /** "Resultado Projetado Obra" (R$; negative = loss). */
  projectedResult?: DecimalString | null;
}

export interface EconomicIndicators {
  /** Closing month shown (latest ≤ reference with any value). */
  month: IsoMonth | null;
  iec: DecimalString | null;
  projectedResult: DecimalString | null;
}

const present = (v: DecimalString | null | undefined): v is DecimalString =>
  v !== null && v !== undefined && v !== '';

/** Canonical form: IEC with 6 decimals, result with 2; an IEC of exactly 0 means "not closed". */
export function canonicalEconomicEntry(entry: EconomicEntry): EconomicEntry {
  const iec = present(entry.iec) ? new Decimal(entry.iec) : null;
  return {
    month: entry.month,
    iec: iec && !iec.isZero() ? toFixedString(iec, IEC_SCALE) : null,
    projectedResult: present(entry.projectedResult)
      ? toFixedString(new Decimal(entry.projectedResult), MONEY_SCALE)
      : null,
  };
}

/** Whether a canonical entry is an actual closing (an IEC, or a non-zero result). */
export function isEconomicClosing(entry: EconomicEntry): boolean {
  return (
    present(entry.iec) ||
    (present(entry.projectedResult) && !new Decimal(entry.projectedResult).isZero())
  );
}

/**
 * "IEC Obra" column of the Consolidado (rule defined 02/10/2026): the latest economic closing
 * at or before the reference month. A month published with neither value (IEC 0 and result 0,
 * as the sheet does before the closing) does not count as a closing.
 */
export function computeEconomicIndicators(
  entries: readonly EconomicEntry[],
  referenceMonth: IsoMonth,
): EconomicIndicators {
  const latest = entries
    .map(canonicalEconomicEntry)
    .filter((e) => e.month <= referenceMonth)
    .filter(isEconomicClosing)
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))[0];
  return {
    month: latest?.month ?? null,
    iec: latest?.iec ?? null,
    projectedResult: latest?.projectedResult ?? null,
  };
}
