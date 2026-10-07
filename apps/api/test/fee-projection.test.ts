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

/*
 * Manual fee projection typed in the Consolidado. Work: 22 months from JAN/27, budget
 * 1.000.000,00 × 10% = 100.000,00; FEV/27 400,00 · MAR/27 1.200,00 · … (curva UNITA_22, M−1).
 */
let ctx: TestContext;
let admin: string;
let workId: string;
let curveVersionId: string;

const inject = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: auth(admin), payload });
const workBody = (feeRate: string) => ({
  name: 'Vila Matilde',
  clientName: 'REV3',
  units: 205,
  budget: '1000000.00',
  feeRate,
  constructionSystem: 'Alvenaria Estrutural',
  curveVersionId,
  startDate: '2027-01-01',
  durationMonths: 22,
});
/** Fee row of the work as the Consolidado shows it. */
async function feeRow() {
  const body = (await inject('GET', '/portfolio/consolidated?referenceDate=2027-01-15')).json();
  const work = body.works.find((w: { workId: string }) => w.workId === workId);
  return work.fee as { periodIndex: number; month: string; value: string; origin: string }[];
}
const total = (cells: { value: string }[]) =>
  cells.reduce((acc, c) => acc + Math.round(Number(c.value) * 100), 0) / 100;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.db);
  admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
  const curve = await inject('POST', '/curves', { name: 'Curva Padrão', points: UNITA_22 });
  curveVersionId = curve.json().latestVersionId;
  workId = (await inject('POST', '/works', workBody('0.10'))).json().id;
});

describe('manual fee projection (Consolidado)', () => {
  it('keeps every month typed and recalculates the others', async () => {
    const before = await feeRow();
    // The Consolidado cells carry the address used to edit them.
    expect(before[2]).toMatchObject({ periodIndex: 3, month: '2027-03-01', value: '1200.00' });

    // Next month (FEV/27) and three months ahead (ABR/27), as typed in the grid.
    const put = await inject('PUT', `/projections/${workId}`, {
      changes: [
        { series: 'FEE', periodIndex: 2, value: '5000.00' },
        { series: 'FEE', periodIndex: 4, value: '8000.00' },
      ],
    });
    expect(put.statusCode).toBe(200);

    const after = await feeRow();
    expect(after[1]).toMatchObject({ value: '5000.00', origin: 'MANUAL' });
    expect(after[3]).toMatchObject({ value: '8000.00', origin: 'MANUAL' });
    // The rest is recalculated so the contract fee is still received in full.
    expect(Number(after[2]?.value)).toBeLessThan(1200);
    expect(total(after)).toBe(100000);
  });

  it('keeps the manual months when a parameter changes (no "review" lock)', async () => {
    await inject('PUT', `/projections/${workId}`, {
      changes: [
        { series: 'FEE', periodIndex: 2, value: '5000.00' },
        { series: 'FEE', periodIndex: 4, value: '8000.00' },
      ],
    });
    // Fee rate 10% → 12%: recalculated around the manual months.
    expect((await inject('PUT', `/works/${workId}`, workBody('0.12'))).statusCode).toBe(200);
    const projection = (await inject('GET', `/projections/${workId}`)).json();
    expect(projection.isStale).toBe(false);
    const after = await feeRow();
    expect(after[1]).toMatchObject({ value: '5000.00', origin: 'MANUAL' });
    expect(after[3]).toMatchObject({ value: '8000.00', origin: 'MANUAL' });
    expect(total(after)).toBe(120000);
  });

  it('sends a month back to the curve when the value is cleared', async () => {
    await inject('PUT', `/projections/${workId}`, {
      changes: [{ series: 'FEE', periodIndex: 2, value: '5000.00' }],
    });
    await inject('PUT', `/projections/${workId}`, {
      changes: [{ series: 'FEE', periodIndex: 2, value: null }],
    });
    expect((await feeRow())[1]).toMatchObject({ value: '400.00', origin: 'CURVE' });
  });
});
