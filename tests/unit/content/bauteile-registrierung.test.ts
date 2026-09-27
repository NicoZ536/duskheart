/**
 * Registrierung des M4-Contents (docs/SPIEL.md §8, §9; M4-05, M4-06, M4-12, M4-19 … M4-21, M4-34): Die Gruppendateien
 * der Items, Rezepte und Bauteile sind in `ITEM_GROUPS`, `RECIPE_GROUPS` und der Sammlung `buildParts`
 * zusammengeführt, und was zusammengehört, passt zueinander:
 * - jedes Item der Kategorie `bauteil` ist genau ein Bauteil, platzierbare Items sind Bauteil oder Station, nie beides;
 * - jedes Bauteil hat sein Rezept;
 * - die Kisten der Lagerung sind genau die Bauteile der Kategorie `lager` (Deko-Behälter sind `deko`), das Herdfeuer ist
 *   ein 3 × 3-Kamin, Betten sind Schlafplätze ihrer Art;
 * - die kanonischen Ids aus docs/SPIEL.md §8 sind registriert (Stationen als Stationen, Bauteile, Lagerung, Herdfeuer und
 *   Möbel als Bauteile) – außer den Möbeln, deren Quelle erst später kommt, und den Glutkernen der Leuchtfeuer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { ALL_BUILD_PARTS } from '../../../src/content/buildPartsAlle';
import { CONTENT } from '../../../src/content/index';
import { ITEM_GROUPS } from '../../../src/content/items/index';
import { MOEBEL, MOEBEL_BAUTEILE } from '../../../src/content/items/moebel';
import { MOEBEL_DEKO, MOEBEL_DEKO_BAUTEILE } from '../../../src/content/items/moebel_deko';
import { MOEBEL_REZEPTE } from '../../../src/content/recipes/moebel';
import { RECIPE_GROUPS } from '../../../src/content/recipes/index';

const items = CONTENT.collection('items');
const parts = CONTENT.collection('buildParts');
const recipes = CONTENT.collection('recipes');

/** Ids in backticks on the line of docs/SPIEL.md §8 that starts with `- **<titel>`. */
function spielIds(titel: string): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = text.split('\n').find((l) => l.startsWith(`- **${titel}`));
  if (line === undefined) throw new Error(`docs/SPIEL.md: no line „${titel}“`);
  return [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

describe('M4-Content registriert', () => {
  it('Möbel, Deko und ihre Rezepte sind in den Gruppen der Registry', () => {
    expect(ITEM_GROUPS.moebel).toBe(MOEBEL);
    expect(ITEM_GROUPS.moebel_deko).toBe(MOEBEL_DEKO);
    expect(RECIPE_GROUPS.moebel).toBe(MOEBEL_REZEPTE);
    for (const i of [...MOEBEL, ...MOEBEL_DEKO]) expect(items.has(i.id), i.id).toBe(true);
    for (const r of MOEBEL_REZEPTE) expect(recipes.has(r.id), r.id).toBe(true);
    for (const p of [...MOEBEL_BAUTEILE, ...MOEBEL_DEKO_BAUTEILE]) expect(parts.get(p.id), p.id).toEqual(p);
    expect(parts.values()).toEqual(ALL_BUILD_PARTS);
  });

  it('Bauteil-Items sind genau Bauteile, platzierbare Items Bauteil oder Station, jedes Bauteil hat ein Rezept', () => {
    for (const i of items.values().filter((x) => x.kategorie === 'bauteil')) expect(parts.has(i.id), i.id).toBe(true);
    for (const p of parts.values()) {
      expect(['bauteil', 'platzierbar'], p.id).toContain(items.get(p.id).kategorie);
      expect(CONTENT.has('stations', p.id), p.id).toBe(false);
      expect(recipes.values().some((r) => r.ergebnis.item === p.id), p.id).toBe(true);
    }
    const placeable = items.values().filter((x) => x.kategorie === 'platzierbar');
    for (const i of placeable) expect(parts.has(i.id) !== CONTENT.has('stations', i.id), i.id).toBe(true);
    expect(placeable.filter((i) => parts.has(i.id)).map((i) => i.id)).toEqual(['grasbett', 'kiste_holz', 'truhe', 'lagerregal', 'herdfeuer']);
  });

  it('Kisten, Herdfeuer und Betten passen zu ihren Systemen', () => {
    // §16.7: the storage system's containers are the parts of the category `lager`; decorative chests, crates and barrels are `deko`.
    const ofCategory = (k: string): string[] => parts.values().filter((p) => p.kategorie === k).map((p) => p.id);
    expect(ofCategory('lager')).toEqual(Object.keys(BALANCE.storage.containers));
    for (const id of ['truhe_deko', 'kiste_deko', 'fass_holz']) expect(parts.get(id).kategorie, id).toBe('deko');
    // §16.5: the hearth is a 3 × 3 stone ring of the category `kamin`, beside the fireplace.
    expect(parts.get('herdfeuer')).toMatchObject({ art: 'moebel', material: 'stein', groesse: { b: 3, t: 3 }, kategorie: 'kamin' });
    expect(ofCategory('kamin')).toEqual(['kamin_stein', 'herdfeuer']);
    // §11.5: beds are sleeping places of their kind (`BALANCE.sleep.places`): the grass bed of M3-16, the straw and wooden beds of M4-19.
    const beds = parts.values().filter((p) => p.kategorie === 'bett');
    expect(beds.map((p) => [p.id, p.schlafplatz])).toEqual([
      ['grasbett', 'grasbett'],
      ['strohbett', 'bett'],
      ['holzbett', 'bett'],
    ]);
    for (const b of beds) expect(Object.keys(BALANCE.sleep.places)).toContain(b.schlafplatz);
  });

  it('die kanonischen Ids aus docs/SPIEL.md §8 sind registriert', () => {
    // The station line also names the field `stufe` of the station records.
    for (const id of spielIds('Stationen T0 (M4-05)').filter((x) => x !== 'stufe')) expect(CONTENT.has('stations', id), id).toBe(true);
    for (const id of spielIds('Verarbeitungsprodukte T0–T1')) expect(items.has(id), id).toBe(true);
    for (const id of spielIds('Bauteile (M4-12)')) expect(parts.get(id).art, id).not.toMatch(/^(moebel|wandmoebel)$/);
    for (const id of spielIds('Lagerung (M4-21)')) expect(parts.get(id).kategorie, id).toBe('lager');
    // The ember cores come with their beacons (M7-36 …): not yet items.
    const herd = spielIds('Herdfeuer (M4-20)');
    expect(herd.filter((id) => !parts.has(id))).toEqual(['glutkern_1', 'glutkern_6']);
    const later = ['hirschgeweih_wand', 'kerzenstaender'];
    const moebel = [...spielIds('Möbel, Deko, Wandobjekte, Lichter T0–T1'), ...spielIds('Weitere Möbel und Deko')];
    expect(moebel.filter((id) => !parts.has(id))).toEqual(later);
    for (const id of later) expect(items.has(id), id).toBe(false);
  });
});
