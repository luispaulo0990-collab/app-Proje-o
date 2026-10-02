import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadInccHistory } from '../src/database/incc-history.js';
import { inccIndicesRepository } from '../src/database/repositories/incc-indices.repository.js';
import { closeTestApp, createTestApp, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDatabase(ctx.db));

describe('INCC-DI history (FGV, AGO/94 → AGO/26)', () => {
  it('loads every month once and never overwrites an edited month', async () => {
    expect(await loadInccHistory(ctx.db)).toBe(385);
    const rows = await inccIndicesRepository.list(ctx.db);
    expect(rows[0]).toMatchObject({ month: '1994-08-01', indexValue: '100.000000' });
    expect(rows.at(-1)).toMatchObject({ month: '2026-08-01', indexValue: '1296.889000' });

    await inccIndicesRepository.upsertMany(ctx.db, [{ month: '2026-08-01', indexValue: '1300' }], {
      note: 'editado',
      updatedById: null,
    });
    expect(await loadInccHistory(ctx.db)).toBe(0);
    expect((await inccIndicesRepository.find(ctx.db, '2026-08-01'))?.indexValue).toBe(
      '1300.000000',
    );
  });
});
