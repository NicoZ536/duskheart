/**
 * Validator-Regel `musik` (tools/validator/musik.ts), Teil M7-73 und M7-101: jedes Ereignis von `STINGER_EVENTS` nennt einen
 * Stinger, den es gibt (auch `vaultEntered` → `gewoelbe_betreten`, `vaultCompleted` → `gewoelbe_bezwungen`), und jeder
 * gezählte Ortstyp nennt seinen Entdeckungs-Stinger. Der echte Content ist ohne Fehler; fehlt einem gezählten Ortstyp der
 * Stinger oder der Sammlung ein Stinger der Tabelle, meldet die Regel es.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import type { ContentCollection, ContentRecord, ContentRegistryView } from '../../../src/content/registry';
import { checkMusic } from '../../../tools/validator/musik';

const PROGRESS = readFileSync(new URL('../../../PROGRESS.md', import.meta.url), 'utf8');

/** The game's registry with collection `name`'s records replaced by `records`. */
function withCollection(name: string, records: readonly ContentRecord[]): ContentRegistryView {
  return {
    collectionNames: () => CONTENT.collectionNames(),
    collections: () =>
      CONTENT.collections().map((c): ContentCollection<ContentRecord> => {
        if (c.name !== name) return c;
        const byId = new Map(records.map((r) => [r.id, r]));
        return {
          name: c.name,
          size: records.length,
          refs: c.refs,
          get: (id) => byId.get(id) ?? c.get(id),
          find: (id) => byId.get(id),
          has: (id) => byId.has(id),
          ids: () => records.map((r) => r.id),
          values: () => records,
          categoriesOf: (r) => c.categoriesOf(r),
        };
      }),
    hasCollection: (n) => CONTENT.hasCollection(n),
    has: (collection, id) => CONTENT.has(collection, id),
    countsByCategory: () => CONTENT.countsByCategory(),
    references: () => CONTENT.references(),
  };
}

describe('Validator-Regel musik: Stinger der Ereignisse und der Ortstypen', () => {
  it('der Content des Spiels ist ohne Fehler', () => {
    expect(checkMusic(CONTENT, PROGRESS).errors).toEqual([]);
  });

  it('ein gezählter Ortstyp ohne Entdeckungs-Stinger ist ein Fehler; ein nicht gezählter (Gewölbe, Arena) nicht', () => {
    const places = CONTENT.collection('locationTypes').values();
    const without = places.map((p) => (p.id === 'schrein' ? { ...p, stinger: undefined } : p));
    expect(checkMusic(withCollection('locationTypes', without), PROGRESS).errors).toEqual(['Ortstyp schrein: kein Entdeckungs-Stinger (locationTypes.stinger)']);
    expect(places.filter((p) => !p.zaehlt).map((p) => [p.id, p.stinger])).toEqual([
      ['bossarena', undefined],
      ['gewoelbe', undefined],
    ]);
  });

  it('fehlt der Sammlung der Stinger eines Ereignisses, nennt die Regel das Ereignis', () => {
    const stingers = CONTENT.collection('stingers').values().filter((s) => s.id !== 'gewoelbe_bezwungen');
    expect(checkMusic(withCollection('stingers', stingers), PROGRESS).errors).toEqual(['Ereignis vaultCompleted: Stinger gewoelbe_bezwungen fehlt']);
  });
});
