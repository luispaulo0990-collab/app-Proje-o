import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkCurveProvider } from '../src/integrations/work-curve-provider.js';
import { closeTestApp, createTestApp, resetDatabase, type TestContext } from './helpers.js';

const SECRET = 'segredo-do-agendamento-123';

class EmptyProvider implements WorkCurveProvider {
  readonly source = 'BD_FISICO_GERAL';
  readonly description = 'teste';
  calls = 0;
  async fetchCurves() {
    this.calls += 1;
    return { curves: [], issues: [] };
  }
}

describe('GET /integrations/work-curves/cron (Vercel Cron)', () => {
  const provider = new EmptyProvider();
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp(
      { CRON_SECRET: SECRET },
      { workCurveProvider: provider, economicProvider: null },
    );
    await resetDatabase(ctx.db);
  });
  afterAll(() => closeTestApp(ctx));

  const url = '/api/v1/integrations/work-curves/cron';

  it('recusa sem o segredo ou com segredo errado', async () => {
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const wrong = await ctx.app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer errado-errado-errado' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(provider.calls).toBe(0);
  });

  it('importa (não simula) com o segredo correto', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dryRun).toBe(false);
    expect(provider.calls).toBe(1);
  });
});
