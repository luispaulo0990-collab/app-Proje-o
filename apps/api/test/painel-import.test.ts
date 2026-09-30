import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import painel from '../src/database/data/painel-obras.json' with { type: 'json' };
import { seedDatabase } from '../src/database/seed-data.js';
import {
  auth,
  closeTestApp,
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDatabase(ctx.db));

const quiet = () => undefined;

describe('import of "Painel de obras.xlsx" (demo data)', () => {
  it('imports every work of the sheet with its own curve and is idempotent', async () => {
    await seedDatabase(ctx.db, { sampleWorks: true, log: quiet });
    await seedDatabase(ctx.db, { sampleWorks: true, log: quiet });
    const token = (await registerUser(ctx.app, 'admin@unita.com.br')).token;

    const list = (
      await ctx.app.inject({ url: '/api/v1/works?pageSize=200', headers: auth(token) })
    ).json();
    expect(list.total).toBe(painel.works.length);

    const consolidated = (
      await ctx.app.inject({ url: '/api/v1/portfolio/consolidated', headers: auth(token) })
    ).json();
    expect(
      consolidated.works.every((w: { curveSource: string }) => w.curveSource === 'WORK_ACTUAL'),
    ).toBe(true);

    // Fee total of each work = orçamento raso × % taxa (engine rounding), received + receivable closes.
    const cents = (v: string) => Math.round(Number(v) * 100);
    for (const w of consolidated.works) {
      expect(cents(w.feeRealized) + cents(w.feeRemaining)).toBe(cents(w.feeProjected));
    }
    const vilaDasBelezas = consolidated.works.find(
      (w: { name: string }) => w.name === 'Vila das Belezas',
    );
    expect(vilaDasBelezas).toMatchObject({
      clientName: 'REV3',
      feeProjected: '3976901.10',
      startDate: '2025-04-01',
    });
    expect(consolidated.works.filter((w: { name: string }) => w.name === 'Tucuruvi')).toHaveLength(
      2,
    );
  });

  it('removes the old fictitious samples and keeps works created by users', async () => {
    const admin = (await registerUser(ctx.app, 'admin@unita.com.br')).token;
    const curve = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/curves',
      headers: auth(admin),
      payload: { name: 'Curva X', points: [{ period: 1, monthlyPct: '1' }] },
    });
    const mine = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/works',
      headers: auth(admin),
      payload: {
        name: 'Obra do usuário',
        clientName: 'Cliente',
        units: 1,
        budget: '100.00',
        feeRate: '0.1',
        feeLagMonths: 0,
        constructionSystem: 'Alvenaria',
        curveVersionId: curve.json().latestVersionId,
        startDate: '2026-01-01',
        durationMonths: 1,
      },
    });
    // Legacy sample: no author and V1 note "Carga de exemplo".
    await ctx.db.execute(sql`UPDATE works SET created_by_id = NULL WHERE id = ${mine.json().id}`);
    const legacy = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/works/${mine.json().id}/duplicate`,
      headers: auth(admin),
    });
    await ctx.db.execute(
      sql`UPDATE works SET created_by_id = NULL, name = 'Mooca' WHERE id = ${legacy.json().id}`,
    );
    await ctx.db.execute(
      sql`UPDATE projections SET note = 'Carga de exemplo' WHERE work_id = ${legacy.json().id}`,
    );

    await seedDatabase(ctx.db, { sampleWorks: true, log: quiet });
    const detail = await ctx.app.inject({
      url: `/api/v1/works/${legacy.json().id}`,
      headers: auth(admin),
    });
    expect(detail.statusCode).toBe(404);
    const kept = await ctx.app.inject({
      url: `/api/v1/works/${mine.json().id}`,
      headers: auth(admin),
    });
    expect(kept.statusCode).toBe(200);
  });
});
