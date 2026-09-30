import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  UNITA_22,
  auth,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let admin: string;
let viewer: string;

async function createCurve(
  app: FastifyInstance,
  token: string,
  points = UNITA_22,
  name = 'Curva Residencial',
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/curves',
    headers: auth(token),
    payload: { name, points },
  });
}

function workPayload(curveVersionId: string, patch: Record<string, unknown> = {}) {
  return {
    name: 'Residencial Alpha',
    clientName: 'REV3',
    units: 354,
    budget: '44187790.05',
    feeRate: '0.09',
    feeLagMonths: 0,
    constructionSystem: 'Alvenaria Estrutural',
    curveVersionId,
    startDate: '2027-01-01',
    durationMonths: 22,
    ...patch,
  };
}

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.db);
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
});

describe('curves', () => {
  it('creates a curve (V1) with canonical points', async () => {
    const res = await createCurve(ctx.app, admin);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ latestVersion: 1, periods: 22, status: 'ACTIVE' });
    expect(body.current.points[0]).toEqual({
      period: 1,
      monthlyPct: '0.00400000',
      cumulativePct: '0.00400000',
    });
    expect(body.current.points.at(-1).cumulativePct).toBe('1.00000000');
  });

  it('rejects invalid curves with domain issues (422)', async () => {
    const res = await createCurve(ctx.app, admin, [
      { period: 1, monthlyPct: '0.5' },
      { period: 2, monthlyPct: '0.4' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.map((d: { code: string }) => d.code)).toContain(
      'CURVE_SUM_NOT_100',
    );
  });

  it('only ADMIN manages curves; VIEWER can read and validate', async () => {
    expect((await createCurve(ctx.app, viewer)).statusCode).toBe(403);
    const v = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/curves/validate',
      headers: auth(viewer),
      payload: {
        points: [
          { period: 1, monthlyPct: '0.6' },
          { period: 2, monthlyPct: '0.3' },
        ],
      },
    });
    expect(v.json()).toMatchObject({ valid: false, canonical: null });
  });

  it('editing points creates a new version and keeps the old one intact', async () => {
    const created = (await createCurve(ctx.app, admin)).json();
    const flat = Array.from({ length: 4 }, (_, i) => ({ period: i + 1, monthlyPct: '0.25' }));
    const updated = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/curves/${created.id}`,
      headers: auth(admin),
      payload: { points: flat, notes: 'Revisão' },
    });
    expect(updated.json()).toMatchObject({ latestVersion: 2, periods: 4 });
    expect(updated.json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const v1 = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/curves/${created.id}/versions/1`,
      headers: auth(viewer),
    });
    expect(v1.json().points).toHaveLength(22);
  });
});

describe('works + projections', () => {
  let curveVersionId: string;

  beforeEach(async () => {
    curveVersionId = (await createCurve(ctx.app, admin)).json().latestVersionId;
  });

  async function createWork(patch: Record<string, unknown> = {}) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/works',
      headers: auth(admin),
      payload: workPayload(curveVersionId, patch),
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  const getProjection = async (workId: string, query = '') =>
    (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/projections/${workId}${query}`,
        headers: auth(viewer),
      })
    ).json();

  it('creating a work computes the end date and generates projection V1', async () => {
    const work = await createWork();
    expect(work).toMatchObject({
      endDate: '2028-10-31',
      periods: 22,
      feeTotal: '3976901.10',
      client: { name: 'REV3' },
      curve: { version: 1 },
    });

    const p = await getProjection(work.id, '?referenceDate=2027-03-15');
    expect(p.version).toBe(1);
    expect(p.physical).toHaveLength(22);
    expect(p.totals).toEqual({
      physical: '1.00000000',
      fee: '3976901.10',
      expectedFee: '3976901.10',
    });
    expect(p.kpis).toMatchObject({
      referenceMonth: '2027-03-01',
      physicalAccumulated: '0.03600000',
      elapsedMonths: 3,
    });
  });

  it('validates input on the backend (400) and domain rules (422)', async () => {
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/works',
      headers: auth(admin),
      payload: workPayload(curveVersionId, { units: 0, feeRate: '-0.1' }),
    });
    expect(bad.statusCode).toBe(400);
    const badDate = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/works',
      headers: auth(admin),
      payload: workPayload(curveVersionId, { startDate: '2027-02-30' }),
    });
    expect(badDate.statusCode).toBe(422);
    const noCurve = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/works',
      headers: auth(admin),
      payload: workPayload('00000000-0000-4000-8000-000000000000'),
    });
    expect(noCurve.statusCode).toBe(422);
  });

  it('VIEWER cannot create works', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/works',
      headers: auth(viewer),
      payload: workPayload(curveVersionId),
    });
    expect(res.statusCode).toBe(403);
  });

  it('manual edit → new version with MANUAL origin, redistribution and audit trail', async () => {
    const work = await createWork();
    const edit = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/projections/${work.id}`,
      headers: auth(admin),
      payload: { changes: [{ series: 'PHYSICAL', periodIndex: 3, value: '0.05' }] },
    });
    expect(edit.statusCode).toBe(200);
    const p = edit.json();
    expect(p.version).toBe(2);
    expect(p.manualCount).toBe(1);
    expect(p.physical[2]).toMatchObject({
      origin: 'MANUAL',
      original: '0.02000000',
      current: '0.05000000',
    });
    expect(p.totals.physical).toBe('1.00000000');

    const audit = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/works/${work.id}/audit`,
        headers: auth(viewer),
      })
    ).json();
    const entry = audit.items.find((i: { action: string }) => i.action === 'EDIT_CELL');
    expect(entry).toMatchObject({
      field: 'PHYSICAL MAR/27',
      oldValue: '0.02000000',
      newValue: '0.05000000',
      origin: 'MANUAL',
      user: 'Usuário Teste',
    });
  });

  it('recalculation: dryRun reports manual cells; PRESERVE keeps and REPLACE discards them', async () => {
    const work = await createWork();
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/projections/${work.id}`,
      headers: auth(admin),
      payload: {
        changes: [
          { series: 'PHYSICAL', periodIndex: 1, value: '0.01' },
          { series: 'FEE', periodIndex: 2, value: '1000.00' },
        ],
      },
    });
    const calc = (body: Record<string, unknown>) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/v1/projections/${work.id}/calculate`,
        headers: auth(admin),
        payload: body,
      });

    const dry = (await calc({ dryRun: true })).json();
    expect(dry).toMatchObject({ dryRun: true, manualCount: 2 });

    const preserved = (await calc({ mode: 'PRESERVE_MANUAL' })).json();
    expect(preserved).toMatchObject({ version: 3, manualCount: 2 });

    const replaced = (await calc({ mode: 'REPLACE_MANUAL' })).json();
    expect(replaced).toMatchObject({ version: 4, manualCount: 0 });
    expect(replaced.physical[0].current).toBe('0.00400000');

    const versions = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/projections/${work.id}/versions`,
        headers: auth(viewer),
      })
    ).json();
    expect(
      versions.map((v: { version: number; isCurrent: boolean }) => [v.version, v.isCurrent]),
    ).toEqual([
      [4, true],
      [3, false],
      [2, false],
      [1, false],
    ]);
  });

  it('changing calc inputs regenerates automatically without manual cells, flags stale with them', async () => {
    const work = await createWork();
    const put = (patch: Record<string, unknown>) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/works/${work.id}`,
        headers: auth(admin),
        payload: workPayload(curveVersionId, patch),
      });

    expect((await put({ budget: '50000000.00' })).json().feeTotal).toBe('4500000.00');
    let p = await getProjection(work.id);
    expect(p).toMatchObject({ version: 2, isStale: false, totals: { fee: '4500000.00' } });

    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/projections/${work.id}`,
      headers: auth(admin),
      payload: { changes: [{ series: 'PHYSICAL', periodIndex: 2, value: '0.02' }] },
    });
    const updated = (await put({ budget: '50000000.00', durationMonths: 24 })).json();
    expect(updated.endDate).toBe('2028-12-31');
    p = await getProjection(work.id);
    expect(p).toMatchObject({ version: 3, isStale: true });
  });

  it('delete is blocked after manual adjustments; archive and duplicate work', async () => {
    const clean = await createWork({ name: 'Obra Limpa' });
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: `/api/v1/works/${clean.id}`,
          headers: auth(admin),
        })
      ).statusCode,
    ).toBe(204);

    const work = await createWork();
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/projections/${work.id}`,
      headers: auth(admin),
      payload: { changes: [{ series: 'PHYSICAL', periodIndex: 2, value: '0.02' }] },
    });
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: `/api/v1/works/${work.id}`,
          headers: auth(admin),
        })
      ).statusCode,
    ).toBe(409);

    const dup = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/works/${work.id}/duplicate`,
      headers: auth(admin),
    });
    expect(dup.json()).toMatchObject({ name: 'Residencial Alpha (cópia)', status: 'DRAFT' });

    const archived = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/works/${work.id}/archive`,
      headers: auth(admin),
    });
    expect(archived.json().status).toBe('ARCHIVED');

    const list = (
      await ctx.app.inject({ method: 'GET', url: '/api/v1/works', headers: auth(viewer) })
    ).json();
    expect(list.items.map((w: { name: string }) => w.name)).toEqual(['Residencial Alpha (cópia)']);
    const all = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/works?includeArchived=true',
        headers: auth(viewer),
      })
    ).json();
    expect(all.total).toBe(2);
  });

  it('a new curve version does not change existing works (rule 5)', async () => {
    const work = await createWork();
    const curveId = work.curve.id;
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/curves/${curveId}`,
      headers: auth(admin),
      payload: {
        points: Array.from({ length: 4 }, (_, i) => ({ period: i + 1, monthlyPct: '0.25' })),
      },
    });
    const after = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/works/${work.id}`,
        headers: auth(viewer),
      })
    ).json();
    expect(after.curve.version).toBe(1);
    expect((await getProjection(work.id)).physical[0].current).toBe('0.00400000');
  });
});

describe('api conventions', () => {
  it('returns the standard error envelope for unknown routes and exposes OpenAPI', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    const docs = await ctx.app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(docs.json().paths).toHaveProperty('/api/v1/works/');
  });
});
