import { normalizeWorkName } from './work-curve-provider.js';

/**
 * Matches work names of an external sheet to the works registered in the system.
 *
 * External sheets usually prefix the registered name with the client/brand
 * ("Viva Benx Klabin" → Benx · "Klabin"; "MetroCasa Vista Cupecê" → Metrocasa · "Cupece").
 * Levels (strongest first):
 *   4 EXACT + client  · 3 EXACT · 2 CONTAINS + client · 1 CONTAINS
 * CONTAINS = the registered name appears as whole consecutive words inside the sheet name.
 * "client" = a word of the registered client (≥ 3 letters) appears in the sheet name or client.
 *
 * Assignment is one-to-one and conservative: at each level only unambiguous pairs are taken,
 * repeating until nothing changes, then the next (weaker) level. Anything still ambiguous
 * stays unmatched and is reported — never guessed.
 */
export type MatchKind = 'EXACT' | 'APPROXIMATE';

export interface SheetEntry {
  key: string;
  name: string;
  client: string | null;
}
export interface RegisteredWork {
  id: string;
  name: string;
  clientName: string;
}

const words = (text: string) =>
  normalizeWorkName(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

export function scoreMatch(sheet: SheetEntry, work: RegisteredWork): number {
  const sheetWords = words(sheet.name);
  const workWords = words(work.name);
  const exact = sheetWords.join(' ') === workWords.join(' ');
  if (!exact && !containsSequence(sheetWords, workWords)) return 0;
  const context = new Set([...sheetWords, ...words(sheet.client ?? '')]);
  const client = words(work.clientName)
    .filter((w) => w.length >= 3)
    .some((w) => context.has(w));
  return (exact ? 3 : 1) + (client ? 1 : 0);
}

export function matchWorkNames(
  sheet: readonly SheetEntry[],
  works: readonly RegisteredWork[],
): Map<string, { workId: string; kind: MatchKind }> {
  const scores = new Map<string, Map<string, number>>();
  for (const s of sheet) {
    const row = new Map<string, number>();
    for (const w of works) {
      const score = scoreMatch(s, w);
      if (score > 0) row.set(w.id, score);
    }
    scores.set(s.key, row);
  }

  const result = new Map<string, { workId: string; kind: MatchKind }>();
  const takenWorks = new Set<string>();
  for (const level of [4, 3, 2, 1]) {
    let changed = true;
    while (changed) {
      changed = false;
      // Proposals: sheet entry → its only free candidate at this level.
      const proposals = new Map<string, string>();
      for (const s of sheet) {
        if (result.has(s.key)) continue;
        const row = scores.get(s.key) ?? new Map<string, number>();
        // A stronger free candidate still exists → this entry is ambiguous, wait.
        const free = [...row].filter(([id]) => !takenWorks.has(id));
        if (free.some(([, sc]) => sc > level)) continue;
        const atLevel = free.filter(([, sc]) => sc === level);
        const only = atLevel.length === 1 ? atLevel[0] : undefined;
        if (only) proposals.set(s.key, only[0]);
      }
      const demand = new Map<string, number>();
      for (const id of proposals.values()) demand.set(id, (demand.get(id) ?? 0) + 1);
      for (const [key, id] of proposals) {
        if (demand.get(id) !== 1) continue; // two sheet names want the same work
        result.set(key, { workId: id, kind: level >= 3 ? 'EXACT' : 'APPROXIMATE' });
        takenWorks.add(id);
        changed = true;
      }
    }
  }
  return result;
}
