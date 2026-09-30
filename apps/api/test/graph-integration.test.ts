import { describe, expect, it } from 'vitest';
import { parseFisicoGeral } from '../src/integrations/microsoft-graph/fisico-geral.parser.js';
import { GraphClient, GraphError } from '../src/integrations/microsoft-graph/graph-client.js';
import {
  parseFractionCell,
  parseMonthCell,
} from '../src/integrations/microsoft-graph/sheet-values.js';

/** Header as it appears in the workbook (note the double spaces in "Replanejado Atual"). */
export const HEADER = [
  'Column4',
  'Nome da Obra',
  'Cliente',
  'Nº Obra UAU',
  'Mês do Fechamento',
  'Previsto Acumulado Cliente',
  'Previsto Acumulado Obra ',
  'Replanejado Atual  Acumulado - Cliente',
  'Replanejado Atual  Acumulado - Obra',
  'Realizado Acumulado',
  'Meta Acumulada - Atual',
];

/** Excel serial of the first day of a month. */
export const serial = (y: number, m: number) =>
  (Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86_400_000;

export function row(name: string, y: number, m: number, replanned: number | string) {
  return ['', name, 'REV3', '58', serial(y, m), 0.1, 0.1, 0.2, replanned, 0.05, 0.25];
}

describe('sheet values', () => {
  it('parses Excel serial dates and text dates (BR/US, day 1)', () => {
    expect(parseMonthCell(serial(2026, 1))).toBe('2026-01-01');
    expect(parseMonthCell(46023)).toBe('2026-01-01');
    expect(parseMonthCell('3/1/2026')).toBe('2026-03-01');
    expect(parseMonthCell('01/03/2026')).toBe('2026-03-01');
    expect(parseMonthCell('2026-11-01T00:00:00')).toBe('2026-11-01');
    expect(parseMonthCell('')).toBeNull();
    expect(parseMonthCell('abc')).toBeNull();
  });

  it('parses fractions from numbers and pt-BR strings without float noise', () => {
    expect(parseFractionCell(0.290771973)).toBe('0.290771973');
    expect(parseFractionCell('29,07%')).toBe('0.2907');
    expect(parseFractionCell('0,5')).toBe('0.5');
    expect(parseFractionCell('')).toBeNull();
    expect(parseFractionCell(null)).toBeNull();
  });
});

describe('parseFisicoGeral', () => {
  it('groups rows by work using the "Replanejado Atual Acumulado - Obra" column', () => {
    const { curves, issues } = parseFisicoGeral([
      HEADER,
      row('Vila das Belezas', 2026, 1, 0.3),
      row('Vila das Belezas', 2026, 2, 1),
      row('Mooca', 2026, 1, 1),
      ['', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(issues).toEqual([]);
    expect(curves).toEqual([
      {
        workName: 'Vila das Belezas',
        externalRef: '58',
        clientName: 'REV3',
        entries: [
          { month: '2026-01-01', cumulative: '0.3' },
          { month: '2026-02-01', cumulative: '1' },
        ],
        indicators: [
          {
            month: '2026-01-01',
            realizedCumulative: '0.05',
            clientReplannedCumulative: '0.2',
            targetCumulative: '0.25',
          },
          {
            month: '2026-02-01',
            realizedCumulative: '0.05',
            clientReplannedCumulative: '0.2',
            targetCumulative: '0.25',
          },
        ],
      },
      expect.objectContaining({ workName: 'Mooca' }),
    ]);
  });

  it('reads the Consolidado columns even on months without cumulative and flags bad values', () => {
    const result = parseFisicoGeral([
      HEADER,
      row('Mooca', 2026, 1, 0.5),
      ['', 'Mooca', 'REV3', '58', serial(2026, 2), '', '', '0,6', '', '7%', 'abc'],
    ]);
    expect(result.missingOptionalColumns).toEqual([]);
    expect(result.curves[0]?.indicators?.[1]).toEqual({
      month: '2026-02-01',
      realizedCumulative: '0.07',
      clientReplannedCumulative: '0.6',
    });
    expect(result.issues.map((i) => i.message)).toEqual([
      'Mooca: "Meta Acumulada - Atual" inválido ("abc").',
    ]);
    const legacy = parseFisicoGeral([HEADER.slice(0, 10), row('Mooca', 2026, 1, 1).slice(0, 10)]);
    expect(legacy.missingOptionalColumns).toEqual(['Meta Acumulada - Atual']);
  });

  it('reports rows with invalid values and missing columns', () => {
    const { issues } = parseFisicoGeral([HEADER, row('Mooca', 2026, 1, 'x')]);
    expect(issues[0]).toMatchObject({ row: 2 });
    expect(() => parseFisicoGeral([['Nome da Obra', 'Mês do Fechamento']])).toThrow(
      /Replanejado Atual Acumulado - Obra/,
    );
  });
});

describe('GraphClient', () => {
  const creds = { tenantId: 't', clientId: 'c', clientSecret: 's' };

  it('authenticates once and reads the used range of a sheet', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes('login.microsoftonline.com'))
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      return new Response(JSON.stringify({ values: [['a']] }));
    }) as typeof fetch;
    const client = new GraphClient(creds, fake);
    expect(await client.worksheetValues('d!1', 'item', 'BD_Infos Gerais')).toEqual([['a']]);
    await client.worksheetValues('d!1', 'item', 'BD_Infos Gerais');
    expect(calls.filter((c) => c.includes('login')).length).toBe(1);
    expect(calls[1]).toContain(
      "/drives/d!1/items/item/workbook/worksheets('BD_Infos%20Gerais')/usedRange(valuesOnly=true)",
    );
  });

  it('surfaces authentication and Graph errors without leaking the secret', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error_description: 'AADSTS7000215: Invalid client secret' }), {
        status: 401,
      })) as unknown as typeof fetch;
    const err = await new GraphClient(creds, fake)
      .worksheetValues('d', 'i', 'x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(String((err as Error).message)).toContain('AADSTS7000215');
    expect(String((err as Error).message)).not.toContain(creds.clientSecret + '"');
  });
});
