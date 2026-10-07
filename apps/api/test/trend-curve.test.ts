import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PASSWORD,
  UNITA_22,
  auth,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

/*
 * "Hoje" = OUT/26. Work started JUL/26. Replanned ("Replanejado Atual Acumulado - Obra"):
 * 3% · 3% · 3% (JUL..SET), then 15% a month and 16% at the end. Realized: 3% a month.
 */
const REPLANNED = ['0.03', '0.03', '0.03', '0.15', '0.15', '0.15', '0.15', '0.15', '0.16'];
let ctx: TestContext;
let admin: string;
let workId: string;

const inject = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(admin), payload });
const physicalAt = async (month: string) => {
  const projection = (await inject('GET', `/projections/${workId}`)).json();
  return {
    value: projection.physical.find((c: { month: string }) => c.month === month)?.current,
    months: projection.physical.length,
  };
};

/** New access token for the same admin (tokens last 15 minutes). */
async function signInAgain() {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'admin@unita.com.br', password: PASSWORD },
  });
  admin = res.json().accessToken;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T12:00:00-03:00'));
  ctx = await createTestApp();
});
afterAll(async () => {
  await closeTestApp(ctx);
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  const curve = await inject('POST', '/curves', { name: 'Curva Padrão', points: UNITA_22 });
  const work = await inject('POST', '/works', {
    name: 'Klabin',
    clientName: 'Benx',
    units: 300,
    budget: '1000000.00',
    feeRate: '0.10',
    constructionSystem: 'Concreto Armado',
    curveVersionId: curve.json().latestVersionId,
    startDate: '2026-07-01',
    durationMonths: 22,
  });
  workId = work.json().id;
  await inject('PUT', `/works/${workId}/actual-curve`, {
    source: 'BD_FISICO_GERAL',
    startMonth: '2026-07',
    points: REPLANNED.map((monthlyPct, i) => ({ period: i + 1, monthlyPct })),
  });
});

describe('curve of a started work = realized + trend', () => {
  it('recalculates the projection with the trend when the realized progress arrives', async () => {
    expect(await physicalAt('2026-10-01')).toEqual({ value: '0.15000000', months: 9 });

    const put = await inject('PUT', `/works/${workId}/progress-indicators`, {
      source: 'BD_FISICO_GERAL',
      months: [
        { month: '2026-07', realizedCumulative: '0.03' },
        { month: '2026-08', realizedCumulative: '0.06' },
        { month: '2026-09', realizedCumulative: '0.09' },
      ],
    });
    expect(put.statusCode).toBe(200);

    // OUT/26 has no realized yet → trend: 0,6 × 15% + 0,4 × 3% = 10,2%; end moves out.
    expect(await physicalAt('2026-10-01')).toEqual({ value: '0.10200000', months: 19 });
    expect(await physicalAt('2026-09-01')).toMatchObject({ value: '0.03000000' });

    const curves = (await inject('GET', '/work-curves')).json();
    const item = curves.items.find((i: { workId: string }) => i.workId === workId);
    expect(item).toMatchObject({
      curveStatus: 'STARTED_ACTUAL',
      needsRecalc: false,
      trend: { lastRealizedMonth: '2026-09-01', averagePace: '0.03000000', planWeight: '0.60' },
    });
  });

  it('flags the projection when the month turns and the trend moves', async () => {
    await inject('PUT', `/works/${workId}/progress-indicators`, {
      source: 'BD_FISICO_GERAL',
      months: [
        { month: '2026-07', realizedCumulative: '0.03' },
        { month: '2026-08', realizedCumulative: '0.06' },
        { month: '2026-09', realizedCumulative: '0.09' },
      ],
    });
    vi.setSystemTime(new Date('2026-11-15T12:00:00-03:00'));
    await signInAgain(); // the access token expired with the clock jump
    const item = (await inject('GET', '/work-curves'))
      .json()
      .items.find((i: { workId: string }) => i.workId === workId);
    // OUT/26 closed without realized: still the same trend (nothing moved).
    expect(item.needsRecalc).toBe(false);

    await inject('PUT', `/works/${workId}/progress-indicators`, {
      source: 'BD_FISICO_GERAL',
      months: [
        { month: '2026-07', realizedCumulative: '0.03' },
        { month: '2026-08', realizedCumulative: '0.06' },
        { month: '2026-09', realizedCumulative: '0.09' },
        { month: '2026-10', realizedCumulative: '0.14' },
      ],
    });
    // New realized month → projection regenerated: OUT/26 = 5% realized.
    expect(await physicalAt('2026-10-01')).toMatchObject({ value: '0.05000000' });
    vi.setSystemTime(new Date('2026-10-15T12:00:00-03:00'));
  });
});
