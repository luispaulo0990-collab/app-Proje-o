import { describe, expect, it } from 'vitest';
import { parseAportes, parseDateCell } from '../src/integrations/microsoft-graph/aportes.parser.js';
import { SheetLayoutError } from '../src/integrations/microsoft-graph/fisico-geral.parser.js';

/** Excel serial of a day. */
const serial = (y: number, m: number, d: number) =>
  (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;

const TRANSFER_HEADER = [
  'Empresa_tb',
  'NumDoc_tb',
  'Data_tb',
  'Valor_tb',
  'Obs_tb',
  'EmpresaCred_tb',
];
const transfer = (company: number, credit: number, day: number, value: number) => [
  company,
  'D1',
  serial(2026, 10, day),
  value,
  'obs',
  credit,
];

const RECEIPT_HEADER = [
  'NúmeroReceb',
  'NumParc',
  'Contratante',
  'Objeto',
  'Data_Recebimento',
  'Valor_Bruto',
  'Valor_Líquido',
];
const receipt = (day: number, gross: number, net: number) => [
  2,
  1,
  'SPE',
  'APORTE MENSAL',
  serial(2026, 10, day),
  gross,
  net,
];

describe('parseAportes', () => {
  it('sums transfers into 73 by company and investor receipts up to the cut-off', () => {
    const result = parseAportes(
      [RECEIPT_HEADER, receipt(1, 110500, 100000), receipt(2, 110500, 10500), receipt(30, 1, 1)],
      [
        TRANSFER_HEADER,
        transfer(10, 73, 1, 1000.1),
        transfer(1, 73, 2, 500),
        transfer(5, 73, 3, 20),
        transfer(73, 73, 3, 999), // internal to the SPE: ignored
        transfer(10, 1, 3, 999), // credited to another company: ignored
        transfer(10, 73, 30, 999), // after the cut-off: ignored
      ],
      '2026-10-15',
    );
    expect(result.totals).toEqual({
      joy: '1520.10',
      joyByCompany: { JOY: '1000.10', UNITA: '500.00', OTHER: '20.00' },
      investors: '110500.00',
      total: '112020.10',
    });
    expect(result.transfers.map((t) => t.company)).toEqual(['JOY', 'UNITA', 'OTHER']);
    expect(result.receipts).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('Empresa_tb = 5');
  });

  it('rejects a sheet without the expected columns', () => {
    expect(() => parseAportes([RECEIPT_HEADER], [['Empresa_tb']], '2026-10-15')).toThrow(
      SheetLayoutError,
    );
  });

  it('reads Excel serials and text dates', () => {
    expect(parseDateCell(serial(2026, 9, 30))).toBe('2026-09-30');
    expect(parseDateCell('5/1/2026')).toBe('2026-01-05');
    expect(parseDateCell('')).toBeNull();
  });
});
