import type { AporteCompany, AportesDto } from '@unita/contracts';
import { Decimal } from '@unita/engine';
import { cellText, normalizeHeader, parseFractionCell } from './sheet-values.js';
import { SheetLayoutError } from './fisico-geral.parser.js';

/** Sheet names in "BD´s_JOY_EVANS.xlsx". */
export const APORTES_SHEETS = {
  receipts: 'Recebidas',
  transfers: 'Transferências Bancarias',
} as const;

/** The SPE that receives the contributions. */
const SPE_COMPANY = '73';
/** Empresa_tb → paying company. Any other code is flagged on the screen. */
const COMPANIES: Record<string, AporteCompany> = { '10': 'JOY', '1': 'UNITA' };

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Excel serial date (or ISO / dd/mm/yyyy text) → `AAAA-MM-DD`; anything else → null. */
export function parseDateCell(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return new Date(EXCEL_EPOCH_UTC + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
  const text = cellText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (br) {
    const [, day = '', month = '', year = ''] = br;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  if (/^\d+(\.\d+)?$/.test(text)) return parseDateCell(Number(text));
  return null;
}

/** Integer-like cell as text ("73", 73, 73.0 → "73"). */
function codeText(value: unknown): string {
  const text = cellText(value);
  return /^\d+(\.0+)?$/.test(text) ? String(Number(text)) : text;
}

/** Header row → column index by name (case/accent/space-insensitive); throws on missing ones. */
function columnIndex<K extends string>(
  header: unknown[],
  columns: Record<K, string>,
  sheet: string,
): Record<K, number> {
  const names = header.map((h) => normalizeHeader(cellText(h)));
  const missing: string[] = [];
  const index = {} as Record<K, number>;
  for (const [key, name] of Object.entries(columns) as [K, string][]) {
    index[key] = names.indexOf(normalizeHeader(name));
    if (index[key] < 0) missing.push(name);
  }
  if (missing.length) throw new SheetLayoutError(missing.map((m) => `${sheet} › ${m}`));
  return index;
}

/**
 * Builds the "Aportes" screen from the raw `usedRange` values of both sheets.
 * - Transfers: Empresa_tb ≠ 73 and EmpresaCred_tb = 73 (Valor_tb on Data_tb).
 * - Investors: every row of "Recebidas" (Valor_Líquido on Data_Recebimento — the amount
 *   actually received in that installment; Valor_Bruto repeats the whole receipt).
 * Only rows dated up to `asOf` (inclusive) count.
 */
export function parseAportes(
  receiptRows: unknown[][],
  transferRows: unknown[][],
  asOf: string,
): Omit<AportesDto, 'readAt'> {
  const issues: AportesDto['issues'] = [];
  const sum = { JOY: new Decimal(0), UNITA: new Decimal(0), OTHER: new Decimal(0) };
  let investors = new Decimal(0);

  const t = columnIndex(
    transferRows[0] ?? [],
    {
      company: 'Empresa_tb',
      creditCompany: 'EmpresaCred_tb',
      document: 'NumDoc_tb',
      date: 'Data_tb',
      value: 'Valor_tb',
      note: 'Obs_tb',
    },
    APORTES_SHEETS.transfers,
  );
  const transfers: AportesDto['transfers'] = [];
  transferRows.slice(1).forEach((row, i) => {
    const companyCode = codeText(row[t.company]);
    if (codeText(row[t.creditCompany]) !== SPE_COMPANY || companyCode === SPE_COMPANY) return;
    if (companyCode === '') return; // blank line of the table
    const source = `${APORTES_SHEETS.transfers}, linha ${i + 2}`;
    const date = parseDateCell(row[t.date]);
    const value = parseFractionCell(row[t.value]);
    if (!date || value === null) {
      issues.push({ source, message: 'Data ou valor ilegível — transferência não somada.' });
      return;
    }
    if (date > asOf) return;
    const company = COMPANIES[companyCode] ?? 'OTHER';
    if (company === 'OTHER')
      issues.push({
        source,
        message: `Empresa_tb = ${companyCode} não é Joy+ (10) nem Unità (1).`,
      });
    sum[company] = sum[company].plus(value);
    transfers.push({
      date,
      document: cellText(row[t.document]),
      companyCode,
      company,
      value: new Decimal(value).toFixed(2),
      note: cellText(row[t.note]),
    });
  });

  const r = columnIndex(
    receiptRows[0] ?? [],
    {
      receipt: 'NúmeroReceb',
      installment: 'NumParc',
      payer: 'Contratante',
      description: 'Objeto',
      date: 'Data_Recebimento',
      value: 'Valor_Líquido',
    },
    APORTES_SHEETS.receipts,
  );
  const receipts: AportesDto['receipts'] = [];
  receiptRows.slice(1).forEach((row, i) => {
    if (row.every((c) => cellText(c) === '')) return;
    const date = parseDateCell(row[r.date]);
    const value = parseFractionCell(row[r.value]);
    if (!date || value === null) {
      issues.push({
        source: `${APORTES_SHEETS.receipts}, linha ${i + 2}`,
        message: 'Data ou valor ilegível — recebimento não somado.',
      });
      return;
    }
    if (date > asOf) return;
    investors = investors.plus(value);
    receipts.push({
      date,
      receipt: cellText(row[r.receipt]),
      installment: cellText(row[r.installment]),
      payer: cellText(row[r.payer]),
      description: cellText(row[r.description]),
      value: new Decimal(value).toFixed(2),
    });
  });

  const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);
  const joy = sum.JOY.plus(sum.UNITA).plus(sum.OTHER);
  return {
    asOf,
    totals: {
      joy: joy.toFixed(2),
      joyByCompany: {
        JOY: sum.JOY.toFixed(2),
        UNITA: sum.UNITA.toFixed(2),
        OTHER: sum.OTHER.toFixed(2),
      },
      investors: investors.toFixed(2),
      total: joy.plus(investors).toFixed(2),
    },
    transfers: transfers.sort(byDate),
    receipts: receipts.sort(byDate),
    issues,
  };
}
