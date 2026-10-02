import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEconomico } from '../src/integrations/microsoft-graph/economico.parser.js';
import { SheetLayoutError } from '../src/integrations/microsoft-graph/fisico-geral.parser.js';
import type {
  EconomicIndicatorProvider,
  ExternalEconomicSeries,
  ExternalWorkCurve,
  WorkCurveProvider,
} from '../src/integrations/work-curve-provider.js';
import {
  UNITA_22,
  auth,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

/** Excel serial of the first day of a month. */
const serial = (y: number, m: number) =>
  (Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86_400_000;

/** First columns of "BD_Econômico" as they appear in the workbook (trimmed to what matters). */
const HEADER = [
  'Nome da Obra',
  'Item',
  'Descrição',
  'Mês do Fechamento',
  'Avanço',
  'Resultado Projetado Obra',
  'IEC Obra',
  'Resultado Sem Correção',
  'IEC Sem correção',
  'Nome Cliente + Obra',
];
const line = (
  work: string,
  item: string,
  month: number | string,
  result: number | string,
  iec: number | string,
  client = 'Benx/Hines',
) => [
  work,
  item,
  item === 'Geral' ? 0 : 'SERVIÇOS',
  month,
  0,
  result,
  iec,
  0,
  0,
  `${client} ${work}`,
];

describe('BD_Econômico parser', () => {
  it('reads only the "Geral" row of each work and month', () => {
    const { series, issues } = parseEconomico([
      HEADER,
      line('Viva Benx Klabin', 'Geral', serial(2026, 5), 0, 0),
      line('Viva Benx Klabin', '01', serial(2026, 5), 21527.4787, 0),
      line('Viva Benx Klabin', 'Geral', serial(2026, 6), -2345642.4, 1.02),
      line('Vila Matilde', 'Geral', '01/06/2026', '150.000,55', '0,98', 'REV3'),
    ]);
    expect(issues).toEqual([]);
    expect(series).toEqual([
      {
        workName: 'Viva Benx Klabin',
        clientName: 'Benx/Hines',
        entries: [
          { month: '2026-05-01', iec: '0', projectedResult: '0' },
          { month: '2026-06-01', iec: '1.02', projectedResult: '-2345642.4' },
        ],
      },
      {
        workName: 'Vila Matilde',
        clientName: 'REV3',
        entries: [{ month: '2026-06-01', iec: '0.98', projectedResult: '150000.55' }],
      },
    ]);
  });

  it('reports invalid cells and missing columns', () => {
    const { issues } = parseEconomico([HEADER, line('Klabin', 'Geral', 'x', 1, 1)]);
    expect(issues[0]?.message).toContain('mês inválido');
    expect(() => parseEconomico([['Nome da Obra', 'Mês do Fechamento', 'Item']])).toThrow(
      SheetLayoutError,
    );
  });
});

class FakeCurves implements WorkCurveProvider {
  readonly source = 'BD_FISICO_GERAL';
  readonly description = 'teste';
  curves: ExternalWorkCurve[] = [];
  async fetchCurves() {
    return { curves: this.curves, issues: [] };
  }
}

class FakeEconomic implements EconomicIndicatorProvider {
  readonly source = 'BD_ECONOMICO';
  readonly description = 'teste econômico';
  series: ExternalEconomicSeries[] = [];
  fail: Error | null = null;
  async fetchEconomic() {
    if (this.fail) throw this.fail;
    return { series: this.series, issues: [] };
  }
}

const curves = new FakeCurves();
const economic = new FakeEconomic();
let ctx: TestContext;
let admin: string;
let workId: string;

interface Economic {
  month: string | null;
  iec: string | null;
  projectedResult: string | null;
  source: string | null;
}

async function economicAt(referenceDate: string): Promise<Economic> {
  const res = await ctx.app.inject({
    url: `/api/v1/portfolio/consolidated?referenceDate=${referenceDate}`,
    headers: auth(admin),
  });
  expect(res.statusCode).toBe(200);
  return res.json().works.find((w: { workId: string }) => w.workId === workId).economic;
}

const sync = (dryRun = false) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/integrations/work-curves/sync',
    headers: auth(admin),
    payload: { dryRun },
  });

beforeAll(async () => {
  ctx = await createTestApp(
    { INTEGRATION_API_KEYS: 'custos:chave-de-integracao-com-32-caracteres' },
    { workCurveProvider: curves, economicProvider: economic },
  );
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.db);
  economic.fail = null;
  economic.series = [];
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  const curve = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/curves',
    headers: auth(admin),
    payload: { name: 'Curva Padrão', points: UNITA_22 },
  });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/works',
    headers: auth(admin),
    payload: {
      name: 'Klabin',
      clientName: 'Benx/Hines',
      units: 120,
      budget: '1000000.00',
      feeRate: '0.10',
      constructionSystem: 'Alvenaria Estrutural',
      curveVersionId: curve.json().latestVersionId,
      startDate: '2026-01-01',
      durationMonths: 22,
    },
  });
  workId = res.json().id;
});

describe('PUT /works/:id/economic-indicators', () => {
  it('feeds the IEC Obra column with the latest closing ≤ reference', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/economic-indicators`,
      headers: { 'x-api-key': 'chave-de-integracao-com-32-caracteres' },
      payload: {
        source: 'CUSTOS',
        months: [
          { month: '2026-05', iec: '1.02', projectedResult: '-2345642.40' },
          { month: '2026-06', iec: '0', projectedResult: '0' },
          { month: '2026-08', iec: '0.95', projectedResult: '50000' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    // IEC 0 and result 0 are dropped (no closing).
    expect(put.json().months).toHaveLength(2);

    expect(await economicAt('2026-07-01')).toMatchObject({
      month: '2026-05-01',
      iec: '1.020000',
      projectedResult: '-2345642.40',
      source: 'CUSTOS',
    });
    expect((await economicAt('2026-08-01')).iec).toBe('0.950000');
    expect((await economicAt('2026-04-01')).iec).toBeNull();

    const history = (
      await ctx.app.inject({ url: `/api/v1/works/${workId}/audit`, headers: auth(admin) })
    ).json();
    expect(JSON.stringify(history)).toContain('IMPORT_ECONOMIC');
  });

  it('validates the payload and requires EDITOR', async () => {
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/economic-indicators`,
      headers: auth(admin),
      payload: { source: 'X1', months: [{ month: '2026-05', iec: '-1' }] },
    });
    expect(bad.statusCode).toBe(400);
    const viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
    const denied = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/economic-indicators`,
      headers: auth(viewer),
      payload: { source: 'CUSTOS', months: [] },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('SharePoint sync → IEC Obra', () => {
  beforeEach(() => {
    economic.series = [
      {
        workName: 'Viva Benx Klabin',
        clientName: 'Benx/Hines',
        entries: [
          { month: '2026-05-01', iec: '0', projectedResult: '0' },
          { month: '2026-06-01', iec: '1.02', projectedResult: '-2345642.4' },
        ],
      },
      { workName: 'Obra Sem Cadastro', clientName: null, entries: [] },
    ];
  });

  it('simulates, imports and skips unchanged closings', async () => {
    const dry = (await sync(true)).json().economic;
    expect(dry).toMatchObject({ sheetWorks: 2, saved: 1, unchanged: 0 });
    expect(dry.unmatched).toEqual(['Obra Sem Cadastro']);
    expect(dry.items[0]).toMatchObject({
      workName: 'Klabin',
      match: 'APPROXIMATE',
      outcome: 'WOULD_SAVE',
      months: 1,
      lastMonth: '2026-06-01',
      lastIec: '1.020000',
    });
    expect((await economicAt('2026-06-01')).iec).toBeNull();

    expect((await sync()).json().economic.items[0].outcome).toBe('SAVED');
    expect(await economicAt('2026-06-01')).toMatchObject({
      iec: '1.020000',
      projectedResult: '-2345642.40',
      source: 'BD_ECONOMICO',
    });
    expect((await sync()).json().economic).toMatchObject({ saved: 0, unchanged: 1 });
  });

  it('does not block the curve sync when the sheet cannot be read', async () => {
    economic.fail = new SheetLayoutError(['IEC Obra']);
    const res = await sync(true);
    expect(res.statusCode).toBe(200);
    expect(res.json().economic.readIssues[0].message).toContain('IEC Obra');
  });
});
