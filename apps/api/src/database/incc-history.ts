import { Decimal, INCC_INDEX_SCALE, toFixedString } from '@unita/engine';
import type { Db } from './client.js';
import history from './data/incc-di.json' with { type: 'json' };
import { inccIndicesRepository } from './repositories/incc-indices.repository.js';

/**
 * INCC-DI (FGV) number-index history, AGO/1994 → AGO/2026, from "INCC-DI.xlsx" (aba Plan1)
 * sent by the user on 02/10/2026. Loaded idempotently: only months not registered yet are
 * inserted, so later edits made in the system are never overwritten.
 */
export async function loadInccHistory(db: Db): Promise<number> {
  const items = history.items.map((i) => ({
    month: i.month,
    indexValue: toFixedString(new Decimal(i.index), INCC_INDEX_SCALE),
  }));
  return inccIndicesRepository.insertMissing(db, items, `Histórico ${history.source}`);
}
