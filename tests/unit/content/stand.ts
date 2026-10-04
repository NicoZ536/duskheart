/**
 * The content of a milestone for the tests that pin it exactly (ADR-Entwurf „Doku-Tests je Meilenstein“, M7-01): parallel
 * strands add content during M7, so a test of the M6 state counts the M6 records – and fails if one of them is gone –
 * instead of everything; what comes later must be a canonical id of docs/SPIEL.md §29 (`M7_IDS`).
 *
 * `tests/fixtures/content/stand-m6.json` holds the ids of the counted collections at the end of M6 (frozen; written from the
 * content at the M6 gate: the ids of `items`, `recipes`, `stations`, `conditions`, `perks`, `creatures`, `armorSets` in
 * definition order).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../../src/content/index';
import type { ContentCategory } from '../../../src/content/categories';

/** The collections the M6 stand lists. */
export type StandCollection = 'items' | 'recipes' | 'stations' | 'conditions' | 'perks' | 'creatures' | 'armorSets';

const STAND_M6 = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/content/stand-m6.json'), 'utf8')) as Readonly<Record<StandCollection, readonly string[]>>;

/** The ids of `collection` at the end of M6, in definition order. */
export function m6Ids(collection: StandCollection): readonly string[] {
  return STAND_M6[collection];
}

/** The M6 ids of `collection` the content no longer has (empty: nothing of M6 was lost or renamed). */
export function missingM6(collection: StandCollection): string[] {
  return m6Ids(collection).filter((id) => !CONTENT.has(collection, id));
}

/** The §C counts over the records of M6 only (each record counted in its collection's categories, ADR-0006). */
export function m6CountsByCategory(): Partial<Record<ContentCategory, number>> {
  const counts: Partial<Record<ContentCategory, number>> = {};
  for (const c of CONTENT.collections()) {
    const ids = (STAND_M6 as Readonly<Record<string, readonly string[]>>)[c.name];
    if (ids === undefined) continue;
    for (const id of ids) {
      const r = c.find(id);
      if (r === undefined) continue;
      for (const cat of c.categoriesOf(r)) counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return counts;
}

/** Every backticked id of docs/SPIEL.md §29 (the canonical ids of M7). */
export const M7_IDS: ReadonlySet<string> = (() => {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const start = doc.indexOf('\n## 29. ');
  if (start < 0) throw new Error('docs/SPIEL.md: Abschnitt 29 fehlt');
  const end = doc.indexOf('\n## ', start + 1);
  return new Set([...doc.slice(start, end < 0 ? undefined : end).matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string));
})();

/** The ids of `collection` beyond M6 that §29 does not name (empty: every addition is a canonical id of M7). */
export function undocumentedSinceM6(collection: StandCollection): string[] {
  const m6 = new Set(m6Ids(collection));
  const all = CONTENT.collections().find((c) => c.name === collection)?.ids() ?? [];
  return all.filter((id) => !m6.has(id) && !M7_IDS.has(id));
}
