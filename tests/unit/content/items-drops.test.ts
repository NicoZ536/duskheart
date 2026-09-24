/**
 * Welt-Drops (docs/SPIEL.md §6; MASTERPROMPT §14): Welt-Objekte → Items. Laubbäume geben Holz, Zweig,
 * Rinde, Laub; Kiefer/Tanne zusätzlich Harz; Obstbäume saisonal Früchte; Stumpf roden Holz/Harz + 40 %
 * Setzling; Felsen Stein, Feuerstein, Kies; Erzknoten ihr Erz; Pflanzen, Büsche und Streudeko Beeren,
 * Pilze, Kräuter, Fasern, Blumen; die Salzküste Muschel, Tang, Treibholz, Salz (Salzkruste).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { buildItemIndex } from '../../../src/content/items/index';
import { WORLD_OBJECT_DROP_IDS, worldObjectDropSchema, worldObjectSchema, type WorldObject, type WorldObjectDrop } from '../../../src/content/worldObjects';

const objects = CONTENT.collection('worldObjects');

function drops(id: string, anlass?: WorldObjectDrop['anlass']): readonly WorldObjectDrop[] {
  const all = objects.get(id).drops ?? [];
  return anlass === undefined ? all : all.filter((d) => d.anlass === anlass);
}

function items(id: string, anlass?: WorldObjectDrop['anlass']): string[] {
  return drops(id, anlass).map((d) => d.item);
}

describe('Drop-Schema', () => {
  it('gültige Drops; min ≤ max, Chance 0–1, Anlass Standard „abbau“, Jahreszeiten eindeutig', () => {
    expect(worldObjectDropSchema.parse({ item: 'holz', min: 1, max: 2 })).toEqual({ item: 'holz', min: 1, max: 2, anlass: 'abbau' });
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 3, max: 2 }).success).toBe(false);
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 0, max: 2 }).success).toBe(false);
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 1, max: 2, chance: 0 }).success).toBe(false);
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 1, max: 2, chance: 1.5 }).success).toBe(false);
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 1, max: 2, jahreszeiten: ['sommer', 'sommer'] }).success).toBe(false);
    expect(worldObjectDropSchema.safeParse({ item: 'holz', min: 1, max: 2, jahreszeiten: ['monsun'] }).success).toBe(false);
  });

  it('nur Bäume haben Stümpfe und Ernten ohne Fällen', () => {
    const bush = objects.get('busch_beeren');
    expect(worldObjectSchema.safeParse({ ...bush, drops: [{ item: 'zweig', min: 1, max: 1, anlass: 'roden' }] }).success).toBe(false);
    expect(worldObjectSchema.safeParse({ ...bush, drops: [] }).success).toBe(false);
  });

  it('jede Drop-Tabelle gehört zu einem Welt-Objekt, jedes Drop-Item existiert', () => {
    for (const id of WORLD_OBJECT_DROP_IDS) expect(objects.has(id), id).toBe(true);
    for (const o of objects.values()) for (const d of o.drops ?? []) expect(CONTENT.has('items', d.item), `${o.id} → ${d.item}`).toBe(true);
  });
});

describe('Welt-Drops nach docs/SPIEL.md §6', () => {
  const trees = objects.values().filter((o: WorldObject) => o.kind === 'baum' && o.drops !== undefined);

  it('Laubbäume: Holz, Zweig, Rinde, Laub; Kiefer und Tanne zusätzlich Harz', () => {
    for (const id of ['baum_eiche', 'baum_birke', 'baum_buche', 'baum_weide', 'baum_mangrove', 'baum_apfelbaum']) expect(items(id, 'abbau'), id).toEqual(['holz', 'zweig', 'rinde', 'laub']);
    for (const id of ['baum_kiefer', 'baum_tanne']) expect(items(id, 'abbau'), id).toEqual(['holz', 'zweig', 'rinde', 'laub', 'harz']);
  });

  it('Stumpf roden: Holz (Nadelbäume auch Harz) und 40 % Setzling der Art', () => {
    expect(BALANCE.items.drops.saplingChance).toBe(0.4);
    for (const tree of trees) {
      const clearing = drops(tree.id, 'roden');
      expect(clearing[0]?.item, tree.id).toBe('holz');
      const sapling = clearing.find((d) => d.item.startsWith('setzling_'));
      if (CONTENT.has('items', `setzling_${tree.id.replace('baum_', '')}`)) {
        expect(sapling, tree.id).toMatchObject({ item: `setzling_${tree.id.replace('baum_', '')}`, chance: 0.4, min: 1, max: 1 });
      } else expect(sapling, tree.id).toBeUndefined();
    }
    expect(items('baum_kiefer', 'roden')).toContain('harz');
  });

  it('Obstbäume tragen in ihrer Jahreszeit Früchte', () => {
    expect(drops('baum_apfelbaum', 'ernte')).toEqual([{ item: 'apfel', min: 2, max: 4, anlass: 'ernte', jahreszeiten: ['herbst'] }]);
    expect(drops('baum_kirschbaum', 'ernte')[0]).toMatchObject({ item: 'kirsche', jahreszeiten: ['sommer'] });
    expect(drops('baum_birnbaum', 'ernte')[0]).toMatchObject({ item: 'birne', jahreszeiten: ['herbst'] });
    expect(drops('baum_walnussbaum', 'ernte')[0]).toMatchObject({ item: 'walnuss', jahreszeiten: ['herbst'] });
  });

  it('Felsen, Erze, Pflanzen, Büsche, Streudeko und Salzküste', () => {
    for (const id of ['fels_klein_gruenhain', 'fels_gross_gruenhain', 'fels_klein_wurzelhoehlen', 'fels_gross_wurzelhoehlen']) expect(items(id), id).toEqual(['stein', 'feuerstein', 'kies']);
    for (const id of ['fels_klein_salzkueste', 'fels_gross_salzkueste']) expect(items(id), id).toEqual(['stein', 'feuerstein', 'kies', 'salz']);
    expect([items('erz_kupfer'), items('erz_zinn'), items('erz_salpeter')]).toEqual([['kupfererz'], ['zinnerz'], ['salpeter']]);
    expect(items('busch_beeren')).toEqual(['walderdbeeren', 'himbeeren', 'blaubeeren', 'zweig']);
    expect(items('pflanze_kraeuter')).toEqual(['schafgarbe', 'wegerich', 'baerlauch']);
    expect(items('pflanze_fasergras')).toEqual(['fasern']);
    expect(items('deko_blumen')).toEqual(['blume_gelb', 'blume_rot', 'blume_blau']);
    expect(items('deko_pilze')).toEqual(['pfifferling', 'fliegenpilz']);
    expect([items('deko_muscheln'), items('deko_tang'), items('deko_treibholz')]).toEqual([['muschel'], ['tang'], ['treibholz']]);
  });

  it('ohne Werkzeug erreichbar: Steine, Feuerstein, Zweige, Fasern liegen zum Aufheben bereit', () => {
    const byHand = objects.values().filter((o) => o.tool === 'hand');
    const handItems = new Set(byHand.flatMap((o) => (o.drops ?? []).map((d) => d.item)));
    for (const id of ['stein', 'feuerstein', 'zweig', 'fasern', 'laub']) expect(handItems.has(id), id).toBe(true);
  });

  it('jedes Item hat eine Quelle in der Welt, beim Graben oder deklariert', () => {
    const index = buildItemIndex(CONTENT);
    for (const id of CONTENT.collection('items').ids()) expect((index.sources.get(id) ?? []).length, id).toBeGreaterThan(0);
    expect(index.sources.get('holz')).toContain('welt:baum_eiche');
    expect(index.sources.get('sand')).toEqual(['graben:duenengras', 'graben:sand']);
    expect(index.sources.get('setzling_eiche')).toEqual(['welt:baum_eiche']);
  });
});
