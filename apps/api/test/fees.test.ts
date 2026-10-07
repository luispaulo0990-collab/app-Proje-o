import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { upgradeProjectionsToCurrentFeeRules } from '../src/modules/projections/fee-rules-upgrade.js';
import {
  UNITA_22,
  auth,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

/*
 * Work: 22 months from JAN/27, budget 1.000.000,00 × 10% = taxa 100.000,00, curva UNITA_22.
 * Competência M−1 → JAN/27 0,00 · FEV/27 400,00 (0,4%) · MAR/27 1.200,00 (1,2%) · …
 */
const API_KEY = 'chave-de-integracao-com-32-caracteres';
let ctx: TestContext;
let admin: string;
let viewer: string;
let workId: string;

const inject = (
  method: 'GET' | 'PUT' | 'DELETE' | 'POST',
  url: string,
  payload?: object,
  token = admin,
) => ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload });

async function consolidatedAt(referenceDate: string) {
  const res = await inject('GET', `/portfolio/consolidated?referenceDate=${referenceDate}`);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return {
    totals: body.totals,
    work: body.works.find((w: { workId: string }) => w.workId === workId),
  };
}

beforeAll(async () => {
  ctx = await createTestApp({ INTEGRATION_API_KEYS: `planejamento:${API_KEY}` });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.db);
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  viewer = (await registerUser(ctx.app, 'viewer@unita.com.br')).token;
  const curve = await inject('POST', '/curves', { name: 'Curva Padrão', points: UNITA_22 });
  const work = await inject('POST', '/works', {
    name: 'Vila Matilde',
    clientName: 'REV3',
    units: 205,
    budget: '1000000.00',
    feeRate: '0.10',
    constructionSystem: 'Alvenaria Estrutural',
    curveVersionId: curve.json().latestVersionId,
    startDate: '2027-01-01',
    durationMonths: 22,
  });
  workId = work.json().id;
});

describe('competência M−1', () => {
  it('receives the progress of each month in the following month', async () => {
    const projection = (await inject('GET', `/projections/${workId}`)).json();
    expect(projection.fee).toHaveLength(23);
    expect(projection.fee.slice(0, 3).map((c: { current: string }) => c.current)).toEqual([
      '0.00',
      '400.00',
      '1200.00',
    ]);
  });
});

describe('PUT/DELETE /works/:id/fee-issuances/:month (taxa emitida)', () => {
  it('uses the issued value and projects the balance over the following months', async () => {
    const put = await inject('PUT', `/works/${workId}/fee-issuances/2027-03`, {
      amount: '1000.00',
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      issuance: { month: '2027-03-01', amount: '1000.00', updatedBy: 'Usuário Teste' },
      projectionVersion: 2,
    });

    const { work, totals } = await consolidatedAt('2027-03-15');
    // 100.000 − (0 + 400) − 1.000 = 98.600 to be received after MAR/27.
    expect(work).toMatchObject({
      feeAtReference: '1000.00',
      feeRealized: '1400.00',
      feeRemaining: '98600.00',
      feeIssuance: { amount: '1000.00' },
      feeAdjustment: { issuedTotal: '1000.00', balanceAfterIssued: '98600.00' },
    });
    expect(totals.issuedWorksAtReference).toBe(1);
    expect(work.fee.find((c: { month: string }) => c.month === '2027-03-01').origin).toBe('ISSUED');

    // A recalculation keeps the issuance.
    const recalc = await inject('POST', `/projections/${workId}/calculate`, {
      mode: 'REPLACE_MANUAL',
    });
    expect(recalc.statusCode).toBe(200);
    expect((await consolidatedAt('2027-03-15')).work.feeRemaining).toBe('98600.00');

    // Removing it brings back the curve: 100.000 − (0 + 400 + 1.200).
    const del = await inject('DELETE', `/works/${workId}/fee-issuances/2027-03`);
    expect(del.statusCode).toBe(200);
    const after = (await consolidatedAt('2027-03-15')).work;
    expect(after).toMatchObject({
      feeRemaining: '98400.00',
      feeIssuance: null,
      feeAdjustment: null,
    });

    const audit = (await inject('GET', `/works/${workId}/audit`)).json();
    const actions = audit.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['FEE_ISSUANCE', 'FEE_ISSUANCE_REMOVED']));
  });

  it('blocks editing an issued month in the projection grid', async () => {
    await inject('PUT', `/works/${workId}/fee-issuances/2027-03`, { amount: '1000.00' });
    const edit = await inject('PUT', `/projections/${workId}`, {
      changes: [{ series: 'FEE', periodIndex: 3, value: '5000' }],
    });
    expect(edit.statusCode).toBe(400);
  });

  it('keeps a pending "preserve or replace" decision pending', async () => {
    // A manual cell that no longer fits (outside a shorter schedule) flags the projection.
    await inject('PUT', `/projections/${workId}`, {
      changes: [{ series: 'PHYSICAL', periodIndex: 22, value: '0.05' }],
    });
    const work = (await inject('GET', `/works/${workId}`)).json();
    const changed = await inject('PUT', `/works/${workId}`, {
      name: work.name,
      clientName: work.client.name,
      units: work.units,
      budget: work.budget,
      feeRate: work.feeRate,
      constructionSystem: work.constructionSystem,
      curveVersionId: work.curve.versionId,
      startDate: work.startDate,
      durationMonths: 20,
      status: work.status,
    });
    expect(changed.statusCode).toBe(200);
    expect((await inject('GET', `/projections/${workId}`)).json().isStale).toBe(true);

    await inject('PUT', `/works/${workId}/fee-issuances/2027-03`, { amount: '1000.00' });
    expect((await inject('GET', `/projections/${workId}`)).json().isStale).toBe(true);
  });

  it('accepts issuances from an integration key', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/works/${workId}/fee-issuances/2027-03-01`,
      headers: { 'x-api-key': API_KEY },
      payload: { amount: '1200.00' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().issuance.updatedBy).toBe('Integração: planejamento');
  });

  it('validates month, value, fee horizon and role', async () => {
    const url = `/works/${workId}/fee-issuances`;
    expect((await inject('PUT', `${url}/2027-03`, { amount: '-1' })).statusCode).toBe(400);
    expect((await inject('PUT', `${url}/2027-03`, { amount: '1.001' })).statusCode).toBe(400);
    expect((await inject('PUT', `${url}/2027-13-05`, { amount: '1' })).statusCode).toBe(400);
    expect((await inject('PUT', `${url}/2027-13`, { amount: '1' })).statusCode).toBe(400);
    // Before the first fee month and after the last one (NOV/28).
    expect((await inject('PUT', `${url}/2026-12`, { amount: '1' })).statusCode).toBe(422);
    expect((await inject('PUT', `${url}/2028-12`, { amount: '1' })).statusCode).toBe(422);
    expect((await inject('PUT', `${url}/2027-03`, { amount: '1' }, viewer)).statusCode).toBe(403);
    expect((await inject('DELETE', `${url}/2027-04`)).statusCode).toBe(404);
    // Nothing was stored by the rejected calls.
    expect((await inject('GET', url)).json().items).toEqual([]);
  });
});

describe('INCC number-index (/incc-indices)', () => {
  it('derives the variation from the index and corrects the balance from the next month on', async () => {
    await inject('PUT', `/works/${workId}/fee-issuances/2027-03`, { amount: '1000.00' });

    // JAN/27 alone has no variation (no previous index): nothing changes yet.
    await inject('PUT', '/incc-indices/2027-01', { index: '1000' });
    const feb = await inject('PUT', '/incc-indices/2027-02', {
      index: '1010',
      note: 'INCC-DI FGV',
    });
    expect(feb.statusCode).toBe(200);
    expect(feb.json()).toMatchObject({
      index: { month: '2027-02-01', index: '1010.000000', rate: '0.01000000', note: 'INCC-DI FGV' },
      recalculatedWorks: 1,
    });
    // MAR/27: 99.600 × 1,01 = 100.596 − 1.000 = 99.596
    expect((await consolidatedAt('2027-03-15')).work).toMatchObject({
      feeRemaining: '99596.00',
      feeAdjustment: { inccCorrection: '996.00' },
    });

    // INCC of MAR/27 (1015,05 ÷ 1010 − 1 = 0,5%) is known before the APR/27 issuance.
    await inject('PUT', '/incc-indices/2027-03', { index: '1015.05' });
    expect((await consolidatedAt('2027-03-15')).work.feeRemaining).toBe('100093.98');

    const list = (await inject('GET', '/incc-indices', undefined, viewer)).json();
    expect(
      list.items.map((r: { month: string; rate: string | null }) => [r.month, r.rate]),
    ).toEqual([
      ['2027-01-01', null],
      ['2027-02-01', '0.01000000'],
      ['2027-03-01', '0.00500000'],
    ]);

    const del = await inject('DELETE', '/incc-indices/2027-03');
    expect(del.json()).toMatchObject({ index: null, recalculatedWorks: 1 });
    expect((await consolidatedAt('2027-03-15')).work.feeRemaining).toBe('99596.00');
  });

  it('saves many months at once (history) and recalculates once', async () => {
    await inject('PUT', `/works/${workId}/fee-issuances/2027-03`, { amount: '1000.00' });
    const res = await inject('PUT', '/incc-indices', {
      items: [
        { month: '2027-02', index: '1010' },
        { month: '2027-01', index: '1000' },
      ],
      note: 'Histórico',
    });
    expect(res.json()).toEqual({ saved: 2, recalculatedWorks: 1 });
    expect((await consolidatedAt('2027-03-15')).work.feeRemaining).toBe('99596.00');
    const bad = await inject('PUT', '/incc-indices', {
      items: [
        { month: '2027-01', index: '1' },
        { month: '2027-01', index: '2' },
      ],
    });
    expect(bad.statusCode).toBe(400);
  });

  it('validates the index and requires EDITOR', async () => {
    expect((await inject('PUT', '/incc-indices/2027-02', { index: '0' })).statusCode).toBe(400);
    expect((await inject('PUT', '/incc-indices/2027-02', { index: '-5' })).statusCode).toBe(400);
    expect((await inject('PUT', '/incc-indices/2027-02', { index: 'abc' })).statusCode).toBe(400);
    expect(
      (await inject('PUT', '/incc-indices/2027-02', { index: '1010' }, viewer)).statusCode,
    ).toBe(403);
    expect((await inject('DELETE', '/incc-indices/2027-02')).statusCode).toBe(404);
  });
});

describe('PUT/DELETE /works/:id/fee-terms/:month (vigências da taxa)', () => {
  const feeOf = async (month: string) => {
    const projection = (await inject('GET', `/projections/${workId}`)).json();
    return {
      fee: projection.fee.find((c: { month: string }) => c.month === month)?.current,
      expectedFee: projection.totals.expectedFee,
    };
  };

  it('applies the new rate typed (not the variation) from the month on', async () => {
    const put = await inject('PUT', `/works/${workId}/fee-terms/2027-03`, {
      feeRate: '0.12',
      inccPeriodicity: 'MONTHLY',
      note: 'Aditivo 1',
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      term: { month: '2027-03-01', feeRate: '0.12000000', updatedBy: 'Usuário Teste' },
      projectionVersion: 2,
    });
    // FEV/27 keeps 10% (400,00); MAR/27 on: 1,2% × 1.000.000 × 12% = 1.440,00.
    // Fee = 1.000.000 × (0,004 × 10% + 0,996 × 12%) = 119.920,00.
    expect(await feeOf('2027-02-01')).toMatchObject({ fee: '400.00' });
    expect(await feeOf('2027-03-01')).toEqual({ fee: '1440.00', expectedFee: '119920.00' });

    const list = (await inject('GET', `/works/${workId}/fee-terms`, undefined, viewer)).json();
    expect(list).toMatchObject({
      base: { feeRate: '0.10000000', inccPeriodicity: 'MONTHLY', inccBaseMonth: '2027-01-01' },
      items: [{ month: '2027-03-01', inccPeriodicity: 'MONTHLY', note: 'Aditivo 1' }],
    });
    const history = (await inject('GET', `/works/${workId}/audit`)).json();
    expect(history.items.find((i: { action: string }) => i.action === 'FEE_TERM')).toMatchObject({
      field: 'Vigência da taxa 03/2027',
      newValue: '12% · INCC mensal',
    });

    const del = await inject('DELETE', `/works/${workId}/fee-terms/2027-03`);
    expect(del.json()).toMatchObject({ term: null, projectionVersion: 3 });
    expect((await feeOf('2027-03-01')).expectedFee).toBe('100000.00');
  });

  it('corrects the balance once per quarter by the INCC accumulated in it', async () => {
    await inject('PUT', `/works/${workId}/fee-terms/2027-01`, {
      feeRate: '0.10',
      inccPeriodicity: 'QUARTERLY',
    });
    await inject('PUT', '/incc-indices', {
      items: [
        { month: '2026-12', index: '1000' },
        { month: '2027-01', index: '1010' },
        { month: '2027-02', index: '1020' },
        { month: '2027-03', index: '1030.2' },
      ],
    });
    await inject('PUT', `/works/${workId}/fee-issuances/2027-03`, { amount: '1000.00' });
    await inject('PUT', `/works/${workId}/fee-issuances/2027-04`, { amount: '2000.00' });
    // Data-base JAN/27: MAR is not corrected; ABR by JAN..MAR (1030,2 ÷ 1000 − 1 = 3,02%):
    // (100.000 − 400 − 1.000) × 1,0302 = 101.577,72 − 2.000 = 99.577,72 to be received.
    expect((await consolidatedAt('2027-04-15')).work).toMatchObject({
      feeRemaining: '99577.72',
      feeAdjustment: { inccCorrection: '2977.72' },
    });
  });

  it('validates rate, periodicity and role', async () => {
    const put = (body: object, token = admin) =>
      inject('PUT', `/works/${workId}/fee-terms/2027-03`, body, token);
    expect((await put({ feeRate: '1.5', inccPeriodicity: 'MONTHLY' })).statusCode).toBe(400);
    expect((await put({ feeRate: '0.09', inccPeriodicity: 'WEEKLY' })).statusCode).toBe(400);
    expect((await put({ feeRate: '0.09' })).statusCode).toBe(400);
    expect((await put({ feeRate: '0.09', inccPeriodicity: 'MONTHLY' }, viewer)).statusCode).toBe(
      403,
    );
    expect((await inject('DELETE', `/works/${workId}/fee-terms/2027-03`)).statusCode).toBe(404);
  });
});

describe('upgrade of projections generated under the previous fee rules', () => {
  it('regenerates them once with the M−1 competence, keeping manual cells', async () => {
    await inject('PUT', `/projections/${workId}`, {
      changes: [{ series: 'PHYSICAL', periodIndex: 5, value: '0.05' }],
    });
    // Simulates a version stored by engine 0.2.0 (lag 2 + "Ajuste projeção de taxa").
    await ctx.db.execute(sql`
      UPDATE projections
         SET parameters = parameters || '{"feeLagMonths": 2, "feeRecalibration": {"id": "x"}}'::jsonb
       WHERE work_id = ${workId} AND is_current`);

    expect(await upgradeProjectionsToCurrentFeeRules(ctx.db)).toBe(1);
    expect(await upgradeProjectionsToCurrentFeeRules(ctx.db)).toBe(0);

    const projection = (await inject('GET', `/projections/${workId}`)).json();
    expect(projection.fee).toHaveLength(23);
    expect(projection.manualCount).toBe(1);
    expect(projection.note).toContain('competência M−1');
  });
});
