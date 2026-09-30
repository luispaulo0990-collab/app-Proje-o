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
let workId: string;

interface ConsolidatedWork {
  workId: string;
  units: number;
  startMonth: string;
  startSource: string;
  projectedEndMonth: string | null;
  monthsIncurred: number;
  curveMonths: number | null;
  feeMonthsAfterReference: number;
  feeAtReference: string;
  feeRealized: string;
  feeRemaining: string;
  progress: Record<string, string | null>;
  feeRecalibration: Record<string, string | boolean | null> | null;
}

async function consolidated(referenceDate: string) {
  const res = await ctx.app.inject({
    url: `/api/v1/portfolio/consolidated?referenceDate=${referenceDate}`,
    headers: auth(admin),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return {
    body,
    work: body.works.find((w: ConsolidatedWork) => w.workId === workId) as ConsolidatedWork,
  };
}

beforeAll(async () => {
  ctx = await createTestApp(
    { INTEGRATION_API_KEYS: 'planejamento:chave-de-integracao-com-32-caracteres' },
    {
      workCurveProvider: provider,
    },
  );
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
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/works',
    headers: auth(admin),
    payload: {
      name: 'Vila Matilde',
      clientName: 'REV3',
      units: 205,
      budget: '1000000.00',
      feeRate: '0.10',
      feeLagMonths: 0,
      constructionSystem: 'Alvenaria Estrutural',
      curveVersionId: curve.json().latestVersionId,
      startDate: '2027-01-01',
      durationMonths: 22,
    },
  });
  workId = res.json().id;
});

describe('Consolidado — registered fields and schedule', () => {
  it('brings UH, start, projected end (100% of the curve) and months incurred', async () => {
    const { work } = await consolidated('2027-06-01');
    expect(work).toMatchObject({
      units: 205,
      startMonth: '2027-01-01',
      startSource: 'PROJECTION',
      projectedEndMonth: '2028-10-01',
      monthsIncurred: 6,
      curveMonths: 22,
      feeMonthsAfterReference: 16,
    });
    expect(work.progress.clientStatus).toBe('SEM_DADOS');
    expect(work.feeRecalibration).toBeNull();
  });
});

describe('PUT /works/:id/progress-indicators', () => {
  const payload = {
    source: 'PLANEJAMENTO',
    months: [
      {
        month: '2027-05',
        realizedCumulative: '0.141',
        clientReplannedCumulative: '0.15',
        targetCumulative: '0.25',
      },
      { month: '2027-06', realizedCumulative: '0.169' },
    ],
  };

  it('feeds Avanço acumulado and Status cliente (ATRASADA when replanned < target)', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/progress-indicators`,
      headers: { 'x-api-key': 'chave-de-integracao-com-32-caracteres' },
      payload,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().months).toHaveLength(2);

    const { work, body } = await consolidated('2027-06-01');
    expect(work.progress).toMatchObject({
      realizedMonth: '2027-06-01',
      realizedCumulative: '0.16900000',
      realizedMonthly: '0.02800000',
      statusMonth: '2027-05-01',
      clientStatus: 'ATRASADA',
      deviation: '-0.10000000',
      source: 'PLANEJAMENTO',
    });
    expect(body.totals.delayedWorks).toBe(1);

    const history = (
      await ctx.app.inject({ url: `/api/v1/works/${workId}/audit`, headers: auth(admin) })
    ).json();
    expect(JSON.stringify(history)).toContain('IMPORT_PROGRESS');
  });

  it('validates the payload and requires EDITOR', async () => {
    const bad = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/progress-indicators`,
      headers: auth(admin),
      payload: { source: 'X1', months: [{ month: '2027-05', realizedCumulative: '-0.1' }] },
    });
    expect(bad.statusCode).toBe(400);
    const viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
    const denied = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/progress-indicators`,
      headers: auth(viewer),
      payload,
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('PUT/DELETE /works/:id/fee-recalibration (Ajuste projeção de taxa)', () => {
  const recalibrate = (remainingTotal: string, token = admin) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/fee-recalibration`,
      headers: auth(token),
      payload: { referenceMonth: '2027-06', remainingTotal, note: 'Aditivo de prazo' },
    });

  it('spreads the new remaining after the reference month and survives recalculation', async () => {
    const before = (await consolidated('2027-06-01')).work;
    const res = await recalibrate('50000.00');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      projectionVersion: 2,
      recalibration: {
        fromMonth: '2027-07-01',
        remainingTotal: '50000.00',
        previousRemaining: before.feeRemaining,
        applied: true,
      },
    });

    const after = (await consolidated('2027-06-01')).work;
    expect(after.feeRealized).toBe(before.feeRealized);
    expect(after.feeAtReference).toBe(before.feeAtReference);
    expect(after.feeRemaining).toBe('50000.00');
    expect(after.feeRecalibration).toMatchObject({ applied: true, note: 'Aditivo de prazo' });

    // A later recalculation (e.g. new curve) keeps the recalibration.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/projections/${workId}/calculate`,
      headers: auth(admin),
      payload: { mode: 'REPLACE_MANUAL' },
    });
    expect((await consolidated('2027-06-01')).work.feeRemaining).toBe('50000.00');

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/works/${workId}/fee-recalibration`,
      headers: auth(admin),
    });
    expect(removed.json()).toMatchObject({ recalibration: null, projectionVersion: 4 });
    const restored = (await consolidated('2027-06-01')).work;
    expect(restored.feeRemaining).toBe(before.feeRemaining);
    expect(restored.feeRecalibration).toBeNull();

    const history = JSON.stringify(
      (await ctx.app.inject({ url: `/api/v1/works/${workId}/audit`, headers: auth(admin) })).json(),
    );
    expect(history).toContain('FEE_RECALIBRATION');
    expect(history).toContain('FEE_RECALIBRATION_CLEARED');
  });

  it('rejects invalid values, months without fee and viewers', async () => {
    expect((await recalibrate('-1')).statusCode).toBe(400);
    expect((await recalibrate('10.001')).statusCode).toBe(400);
    const late = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/fee-recalibration`,
      headers: auth(admin),
      payload: { referenceMonth: '2030-01', remainingTotal: '10.00' },
    });
    expect(late.statusCode).toBe(422);
    // Rejected recalibration leaves nothing behind.
    expect((await consolidated('2027-06-01')).work.feeRecalibration).toBeNull();
    const viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
    expect((await recalibrate('10.00', viewer)).statusCode).toBe(403);
    const nothing = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/works/${workId}/fee-recalibration`,
      headers: auth(admin),
    });
    expect(nothing.statusCode).toBe(404);
  });
});

describe('SharePoint sync → Consolidado indicators', () => {
  it('stores realized / client replanning / target and skips unchanged data', async () => {
    const months = ['2027-01-01', '2027-02-01', '2027-03-01'];
    provider.curves = [
      {
        workName: 'Vila Matilde',
        externalRef: '58',
        clientName: 'REV3',
        entries: months.map((month, i) => ({ month, cumulative: ['0.3', '0.7', '1'][i] ?? '1' })),
        indicators: [
          {
            month: '2027-01-01',
            realizedCumulative: '0.2',
            clientReplannedCumulative: '0.3',
            targetCumulative: '0.3',
          },
        ],
      },
    ];
    const sync = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/integrations/work-curves/sync',
        headers: auth(admin),
        payload: {},
      });
    const first = (await sync()).json();
    expect(first.items[0]).toMatchObject({ indicators: 'SAVED', indicatorMonths: 1 });
    expect(first.totals.withIndicators).toBe(1);
    expect((await sync()).json().items[0].indicators).toBe('UNCHANGED');

    const { work } = await consolidated('2027-01-01');
    expect(work.progress).toMatchObject({
      realizedCumulative: '0.20000000',
      clientStatus: 'OK',
      source: 'BD_FISICO_GERAL',
    });
  });
});
