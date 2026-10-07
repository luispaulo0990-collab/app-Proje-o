import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  UNITA_22,
  auth,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const API_KEY = 'k'.repeat(40);
let ctx: TestContext;
let admin: string;
let viewer: string;
let curveVersionId: string;

/** Own curve: 10 months, 10% each. */
const OWN_10 = Array.from({ length: 10 }, (_, i) => ({ period: i + 1, monthlyPct: '0.1' }));

async function createWork(patch: Record<string, unknown>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/works',
    headers: auth(admin),
    payload: {
      name: 'Obra',
      clientName: 'REV3',
      units: 100,
      budget: '1000000.00',
      feeRate: '0.10',
      constructionSystem: 'Alvenaria Estrutural',
      curveVersionId,
      startDate: '2025-01-01',
      durationMonths: 22,
      ...patch,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

function putActual(
  workId: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = auth(admin),
) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/api/v1/works/${workId}/actual-curve`,
    headers,
    payload,
  });
}

beforeAll(async () => {
  ctx = await createTestApp({ INTEGRATION_API_KEYS: `planejamento:${API_KEY}` });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.db);
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
  const curve = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/curves',
    headers: auth(admin),
    payload: { name: 'Curva Padrão', points: UNITA_22 },
  });
  curveVersionId = curve.json().latestVersionId;
});

describe('actual curve of a started work', () => {
  it('stores V1, recalculates the projection with the own curve and keeps history', async () => {
    const workId = await createWork({ name: 'Iniciada' });
    const res = await putActual(workId, {
      source: 'PLANEJAMENTO',
      startMonth: '2025-02',
      points: OWN_10,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.actualCurve).toMatchObject({ version: 1, periods: 10, startMonth: '2025-02-01' });
    expect(body.actualCurve.points[0]).toMatchObject({ label: 'FEV/25', monthlyPct: '0.10000000' });
    expect(body.projection).toEqual({ outcome: 'RECALCULATED', version: 2 });

    const proj = (
      await ctx.app.inject({ url: `/api/v1/projections/${workId}`, headers: auth(viewer) })
    ).json();
    expect(proj.curveSource).toBe('WORK_ACTUAL');
    expect(proj.physical).toHaveLength(10);
    expect(proj.physical[0]).toMatchObject({ month: '2025-02-01', current: '0.10000000' });
    expect(proj.totals.fee).toBe('100000.00');

    const second = await putActual(workId, {
      source: 'PLANEJAMENTO',
      points: OWN_10.slice(0, 5).map((p) => ({ ...p, monthlyPct: '0.2' })),
    });
    expect(second.json().actualCurve.version).toBe(2);
    const state = (
      await ctx.app.inject({ url: `/api/v1/works/${workId}/actual-curve`, headers: auth(viewer) })
    ).json();
    expect(state.current.version).toBe(2);
    expect(state.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(state.effective).toMatchObject({ source: 'WORK_ACTUAL', status: 'STARTED_ACTUAL' });
  });

  it('accepts month-keyed values and normalizes rounding noise when asked', async () => {
    const workId = await createWork({});
    const months = ['2025-01', '2025-02', '2025-03'].map((month) => ({
      month,
      monthlyPct: '0.333',
    }));
    const strict = await putActual(workId, { source: 'ERP', months });
    expect(strict.statusCode).toBe(422);
    const ok = await putActual(workId, { source: 'ERP', months, normalize: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().actualCurve.points.at(-1).cumulativePct).toBe('1.00000000');
  });

  it('rejects gaps and requires exactly one of points/months', async () => {
    const workId = await createWork({});
    const gap = await putActual(workId, {
      source: 'ERP',
      months: [
        { month: '2025-01', monthlyPct: '0.5' },
        { month: '2025-03', monthlyPct: '0.5' },
      ],
    });
    expect(gap.statusCode).toBe(422);
    expect(gap.json().error.details[0].code).toBe('CURVE_MONTH_GAP');
    expect((await putActual(workId, { source: 'ERP' })).statusCode).toBe(400);
  });

  it('applies the own curve around the manual adjustments, anchored to their month', async () => {
    const workId = await createWork({});
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/projections/${workId}`,
      headers: auth(admin),
      payload: { changes: [{ series: 'PHYSICAL', periodIndex: 2, value: '0.05' }] },
    });
    const res = await putActual(workId, { source: 'ERP', points: OWN_10 });
    expect(res.json().projection.outcome).toBe('RECALCULATED');
    const proj = (
      await ctx.app.inject({ url: `/api/v1/projections/${workId}`, headers: auth(admin) })
    ).json();
    expect(proj).toMatchObject({ isStale: false, curveSource: 'WORK_ACTUAL', manualCount: 1 });
    expect(proj.physical[1]).toMatchObject({ origin: 'MANUAL', current: '0.05000000' });
  });
});

describe('actual curve of a work not started', () => {
  it('stores the curve but keeps the parametric projection', async () => {
    const workId = await createWork({ startDate: '2031-01-01' });
    const res = await putActual(workId, { source: 'ERP', points: OWN_10 });
    expect(res.json().projection).toEqual({ outcome: 'NOT_IN_FORCE', version: null });
    expect(res.json().issues[0].code).toBe('ACTUAL_CURVE_NOT_IN_FORCE');
  });
});

describe('integration key', () => {
  it('accepts X-Api-Key for pushing curves and audits the integration', async () => {
    const workId = await createWork({});
    const res = await putActual(
      workId,
      { source: 'PLANEJAMENTO', externalRef: 'OBRA-77', points: OWN_10 },
      { 'x-api-key': API_KEY },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().actualCurve).toMatchObject({
      receivedVia: 'API_KEY',
      externalRef: 'OBRA-77',
    });
    const audit = (
      await ctx.app.inject({ url: `/api/v1/works/${workId}/audit`, headers: auth(admin) })
    ).json();
    const imported = audit.items.find(
      (a: { action: string }) => a.action === 'IMPORT_ACTUAL_CURVE',
    );
    expect(imported.user).toBe('Integração: planejamento');
  });

  it('rejects an invalid key and VIEWER users', async () => {
    const workId = await createWork({});
    const bad = await putActual(workId, { source: 'XX', points: OWN_10 }, { 'x-api-key': 'nope' });
    expect(bad.statusCode).toBe(401);
    const asViewer = await putActual(workId, { source: 'XX', points: OWN_10 }, auth(viewer));
    expect(asViewer.statusCode).toBe(403);
  });
});

describe('GET /work-curves', () => {
  it('classifies works and returns the curve in force on a common axis', async () => {
    const future = await createWork({ name: 'Futura', startDate: '2031-01-01' });
    const awaiting = await createWork({ name: 'Sem curva própria' });
    const own = await createWork({ name: 'Com curva própria' });
    await putActual(own, { source: 'ERP', points: OWN_10 });

    // Fixed reference: the figures below must not depend on the current month.
    const res = await ctx.app.inject({
      url: '/api/v1/work-curves?referenceDate=2026-09-15',
      headers: auth(viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byId = new Map(body.items.map((i: { workId: string }) => [i.workId, i]));
    expect(byId.get(future)).toMatchObject({ curveStatus: 'NOT_STARTED', source: 'PARAMETRIC' });
    expect(byId.get(awaiting)).toMatchObject({
      curveStatus: 'STARTED_AWAITING_ACTUAL',
      source: 'PARAMETRIC',
      // 22 months from JAN/25: 21 months elapsed at SET/26 → Σ curve except the last 0,4%.
      physicalAccumulated: '0.99600000',
    });
    expect(byId.get(own)).toMatchObject({
      curveStatus: 'STARTED_ACTUAL',
      source: 'WORK_ACTUAL',
      durationMonths: 10,
      endDate: '2025-10-31',
      needsRecalc: false,
    });
    expect(body.counts).toEqual({
      NOT_STARTED: 1,
      STARTED_ACTUAL: 1,
      STARTED_AWAITING_ACTUAL: 1,
      needsRecalc: 0,
    });
    expect(body.months[0]).toEqual({ month: '2025-01-01', label: 'JAN/25' });
  });

  it('"what if" reference month does not change the in-force flag', async () => {
    await createWork({ name: 'Futura', startDate: '2031-01-01' });
    const res = await ctx.app.inject({
      url: '/api/v1/work-curves?referenceDate=2031-06-01',
      headers: auth(viewer),
    });
    expect(res.json().items[0]).toMatchObject({
      curveStatus: 'STARTED_AWAITING_ACTUAL',
      needsRecalc: false,
    });
  });
});

describe('GET /portfolio/consolidated', () => {
  it('sums every projection per month and splits received × receivable', async () => {
    await createWork({ name: 'Obra A', startDate: '2026-01-01', durationMonths: 22 });
    await createWork({
      name: 'Obra B',
      budget: '500000.00',
      startDate: '2026-06-01',
      durationMonths: 22,
    });
    const res = await ctx.app.inject({
      url: '/api/v1/portfolio/consolidated?referenceDate=2026-09-01',
      headers: auth(viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.referenceMonth).toBe('2026-09-01');
    expect(body.totals.worksCount).toBe(2);
    expect(body.totals.feeProjected).toBe('150000.00');
    const cents = (v: string) => Math.round(Number(v) * 100);
    expect(cents(body.totals.feeRealized) + cents(body.totals.feeRemaining)).toBe(15000000);
    const monthSum = body.months.reduce(
      (acc: number, m: { feeTotal: string }) => acc + cents(m.feeTotal),
      0,
    );
    expect(monthSum).toBe(15000000);
    expect(
      body.years.reduce((a: number, y: { feeTotal: string }) => a + cents(y.feeTotal), 0),
    ).toBe(15000000);
    expect(body.months.find((m: { isReference: boolean }) => m.isReference).label).toBe('SET/26');
    expect(body.works.map((w: { name: string }) => w.name)).toEqual(['Obra A', 'Obra B']);
    expect(body.works[0].physical).toHaveLength(22);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ url: '/api/v1/portfolio/consolidated' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /work-curves/sync', () => {
  it('recalculates projections left behind by a curve change', async () => {
    const workId = await createWork({ startDate: '2031-01-01' });
    await putActual(workId, { source: 'ERP', points: OWN_10 });
    // Simulate the work starting: move its start into the past directly in the database.
    await ctx.db.execute(
      (await import('drizzle-orm'))
        .sql`UPDATE works SET start_date = '2025-01-01' WHERE id = ${workId}`,
    );
    const list = (
      await ctx.app.inject({ url: '/api/v1/work-curves', headers: auth(admin) })
    ).json();
    expect(list.counts.needsRecalc).toBe(1);
    const sync = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/work-curves/sync',
      headers: auth(admin),
    });
    expect(sync.json()).toEqual({ recalculated: 1, markedStale: 0, unchanged: 0 });
    const proj = (
      await ctx.app.inject({ url: `/api/v1/projections/${workId}`, headers: auth(admin) })
    ).json();
    expect(proj.curveSource).toBe('WORK_ACTUAL');
  });
});
