import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
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

/** In-memory provider standing in for the SharePoint sheet. */
class FakeProvider implements WorkCurveProvider {
  readonly source = 'BD_FISICO_GERAL';
  readonly description = 'teste';
  curves: ExternalWorkCurve[] = [];
  async fetchCurves() {
    return { curves: this.curves, issues: [] };
  }
}

const provider = new FakeProvider();
let ctx: TestContext;
let admin: string;
let curveVersionId: string;

const cumulative = (start: [number, number], values: string[]) =>
  values.map((v, i) => {
    const idx = start[0] * 12 + (start[1] - 1) + i;
    return {
      month: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`,
      cumulative: v,
    };
  });

async function createWork(name: string, startDate = '2025-01-01') {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/works',
    headers: auth(admin),
    payload: {
      name,
      clientName: 'REV3',
      units: 100,
      budget: '1000000.00',
      feeRate: '0.10',
      constructionSystem: 'Alvenaria Estrutural',
      curveVersionId,
      startDate,
      durationMonths: 22,
    },
  });
  return res.json().id as string;
}

const sync = (dryRun = false) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/integrations/work-curves/sync',
    headers: auth(admin),
    payload: { dryRun },
  });

beforeAll(async () => {
  ctx = await createTestApp({}, { workCurveProvider: provider });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.db);
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  const curve = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/curves',
    headers: auth(admin),
    payload: { name: 'Curva Padrão', points: UNITA_22 },
  });
  curveVersionId = curve.json().latestVersionId;
});

describe('POST /integrations/work-curves/sync', () => {
  it('matches by standard name, imports, skips unchanged and reports gaps', async () => {
    const belezas = await createWork('Vila das Belezas');
    await createWork('Mooca');
    provider.curves = [
      {
        workName: 'VILA  DAS BELEZAS ',
        externalRef: '58',
        clientName: 'REV3',
        entries: cumulative([2025, 1], ['0', '0.25', '0.5', '0.9995', '1', '1']),
      },
      { workName: 'Obra Desconhecida', externalRef: '99', clientName: null, entries: [] },
    ];

    const dry = (await sync(true)).json();
    expect(dry.totals).toMatchObject({ matched: 1, imported: 1, unmatched: 1 });
    expect(dry.items[0].outcome).toBe('WOULD_IMPORT');

    const first = (await sync()).json();
    expect(first.items[0]).toMatchObject({
      workId: belezas,
      outcome: 'IMPORTED',
      startMonth: '2025-02-01',
      periods: 4,
      version: 1,
      projection: 'RECALCULATED',
    });
    expect(first.unmatched).toEqual([{ sheetName: 'Obra Desconhecida', externalRef: '99' }]);
    expect(first.missingInSheet.map((w: { workName: string }) => w.workName)).toEqual(['Mooca']);

    const again = (await sync()).json();
    expect(again.items[0]).toMatchObject({ outcome: 'UNCHANGED', version: 1 });

    const proj = (
      await ctx.app.inject({ url: `/api/v1/projections/${belezas}`, headers: auth(admin) })
    ).json();
    expect(proj.curveSource).toBe('WORK_ACTUAL');
    expect(proj.physical.map((c: { current: string }) => c.current)).toEqual([
      '0.25000000',
      '0.25000000',
      '0.49950000',
      '0.00050000',
    ]);
  });

  it('rejects inconsistent series without blocking the other works', async () => {
    await createWork('Mooca');
    await createWork('Tucuruvi');
    provider.curves = [
      {
        workName: 'Mooca',
        externalRef: null,
        clientName: null,
        entries: cumulative([2025, 1], ['0.5', '0.4', '1']),
      },
      {
        workName: 'Tucuruvi',
        externalRef: null,
        clientName: null,
        entries: cumulative([2025, 1], ['0.5', '1']),
      },
    ];
    const report = (await sync()).json();
    const byName = Object.fromEntries(
      report.items.map((i: { workName: string; outcome: string }) => [i.workName, i]),
    );
    expect(byName.Mooca.outcome).toBe('REJECTED');
    expect(byName.Mooca.issues[0].code).toBe('CUMULATIVE_DECREASING');
    expect(byName.Tucuruvi.outcome).toBe('IMPORTED');
  });

  it('exposes the status and requires EDITOR', async () => {
    const status = (
      await ctx.app.inject({ url: '/api/v1/integrations/status', headers: auth(admin) })
    ).json();
    expect(status.microsoftGraph).toEqual({ configured: true, description: 'teste' });
    const viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/work-curves/sync',
      headers: auth(viewer),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('integration not configured', () => {
  it('answers 422 INTEGRATION_NOT_CONFIGURED', async () => {
    const other = await createTestApp({}, { workCurveProvider: null });
    await resetDatabase(other.db);
    const token = (await registerUser(other.app, 'x@unita.com.br')).token;
    const res = await other.app.inject({
      method: 'POST',
      url: '/api/v1/integrations/work-curves/sync',
      headers: auth(token),
      payload: {},
    });
    expect(res.json().error.code).toBe('INTEGRATION_NOT_CONFIGURED');
    await closeTestApp(other);
  });
});
