/**
 * Automatisch berechnete Quellen und Verwendungen (MASTERPROMPT §13.1 „Verwendungen (automatisch
 * berechnet)“, §15.1 „Verwendet in“/„Herkunft“; docs/SPIEL.md §2).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { buildItemIndex, classifyItemReference, intrinsicItemUses, ITEM_RELATIONS, referencePathMatches, type ItemRelation } from '../../../src/content/items/index';
import { ContentRegistry } from '../../../src/content/registry';
import { idSchema, ref, refSchema } from '../../../src/content/schema/common';

const itemSchema = z.object({ id: idSchema, kategorie: z.string(), quellen: z.array(z.string()).optional(), brennwert: z.number().optional() }).strict();
const recipeSchema = z.object({ id: idSchema, output: refSchema, inputs: z.array(z.object({ item: refSchema, count: z.number() })) }).strict();
const objectSchema = z.object({ id: idSchema, drops: z.array(z.object({ item: refSchema })) }).strict();

const RECIPE_RELATIONS: readonly ItemRelation[] = [
  ...ITEM_RELATIONS,
  { collection: 'recipes', path: 'output', kind: 'quelle', source: 'rezept' },
  { collection: 'recipes', path: 'inputs[].item', kind: 'verwendung', use: 'zutat' },
];

function fixture() {
  return new ContentRegistry()
    .defineCollection('items', itemSchema, [
      { id: 'holz', kategorie: 'rohstoff', brennwert: 45 },
      { id: 'stein', kategorie: 'rohstoff', quellen: ['haendlerin'] },
      { id: 'steinaxt', kategorie: 'werkzeug' },
      { id: 'truhe', kategorie: 'platzierbar' },
    ])
    .defineCollection('worldObjects', objectSchema, [{ id: 'baum_eiche', drops: [{ item: 'holz' }, { item: 'holz' }] }], { refs: [ref('drops[].item', 'items')] })
    .defineCollection('recipes', recipeSchema, [{ id: 'rezept_steinaxt', output: 'steinaxt', inputs: [{ item: 'holz', count: 2 }, { item: 'stein', count: 3 }] }], {
      refs: [ref('output', 'items'), ref('inputs[].item', 'items')],
    });
}

describe('Quellen und Verwendungen', () => {
  it('Quellen: deklariert + abgeleitet aus Drops und Rezepten; Verwendungen: eigene Daten + Zutaten', () => {
    const index = buildItemIndex(fixture(), RECIPE_RELATIONS);
    expect(index.sources.get('holz')).toEqual(['welt:baum_eiche']);
    expect(index.sources.get('stein')).toEqual(['haendlerin']);
    expect(index.sources.get('steinaxt')).toEqual(['rezept:rezept_steinaxt']);
    expect(index.sources.get('truhe')).toEqual([]);
    expect(index.uses.get('holz')).toEqual([{ kind: 'brennstoff' }, { kind: 'zutat', by: 'recipes/rezept_steinaxt' }]);
    expect(index.uses.get('stein')).toEqual([{ kind: 'zutat', by: 'recipes/rezept_steinaxt' }]);
    expect(index.uses.get('truhe')).toEqual([]);
    expect(index.unclassified).toEqual([]);
  });

  it('nicht eingeordnete Referenzen auf items werden gemeldet', () => {
    const index = buildItemIndex(fixture());
    expect(index.unclassified.map((r) => `${r.collection}/${r.id}.${r.at}`)).toEqual(['recipes/rezept_steinaxt.output', 'recipes/rezept_steinaxt.inputs[0].item', 'recipes/rezept_steinaxt.inputs[1].item']);
  });

  it('eigene Verwendungen: essen, brennen, ausrüsten, Werkzeug, pflanzen', () => {
    expect(intrinsicItemUses({ essbar: { saettigung: 1, durst: 0 } })).toEqual(['essen']);
    expect(intrinsicItemUses({ brennwert: 15 })).toEqual(['brennstoff']);
    expect(intrinsicItemUses({ kategorie: 'ruestung' })).toEqual(['ausruesten']);
    expect(intrinsicItemUses({ kategorie: 'rucksack' })).toEqual(['ausruesten']);
    expect(intrinsicItemUses({ kategorie: 'werkzeug', werkzeug: { art: 'axt', abbaukraft: 1 } })).toEqual(['werkzeug']);
    expect(intrinsicItemUses({ kategorie: 'saatgut', pflanzt: 'baum_eiche' })).toEqual(['pflanzen']);
    expect(intrinsicItemUses({ kategorie: 'rohstoff' })).toEqual([]);
  });

  it('Referenzpfade: [] passt auf jeden Index, {} auf jeden Schlüssel', () => {
    expect(referencePathMatches('drops[].item', 'drops[3].item')).toBe(true);
    expect(referencePathMatches('drops[].item', 'drops.item')).toBe(true);
    expect(referencePathMatches('drops[].item', 'drops[3].menge')).toBe(false);
    expect(referencePathMatches('output', 'output')).toBe(true);
    expect(referencePathMatches('output', 'outputs')).toBe(false);
    expect(referencePathMatches('kosten{}', 'kosten.holz')).toBe(true);
    expect(referencePathMatches('kosten{}', 'kosten')).toBe(false);
    expect(classifyItemReference({ collection: 'worldObjects', id: 'x', at: 'drops[0].item', target: 'items', value: 'holz' })).toMatchObject({ kind: 'quelle', source: 'welt' });
  });

  it('echter Content: jede Item-Referenz ist eingeordnet; Brennstoffe und Nahrung haben Verwendungen', () => {
    const index = buildItemIndex(CONTENT);
    expect(index.unclassified).toEqual([]);
    // Wood burns (§15.4), is timber in the ingredient group `bauholz` (M4-01) and goes into the recipes without a
    // station (M3-16), the stations (M4-05), the bronze tools' hafts (M4-10), palisades and fences (M4-12), the
    // wooden crate (M4-21), the hearth (M4-20), the weapons' hafts and grips and the armoury's stations (M6-11,
    // M6-12, M6-31) and the box trap (M6-30).
    const recipe = (id: string): { kind: 'zutat'; by: string } => ({ kind: 'zutat', by: `recipes/rezept_${id}` });
    expect(index.uses.get('holz')).toEqual([
      { kind: 'brennstoff' },
      { kind: 'zutat', by: 'ingredientGroups/bauholz' },
      ...['holzeimer', 'lagerfeuer', 'werkbank'].map(recipe),
      ...['saegebock', 'steinmetzbank', 'trockengestell', 'koehlermeiler', 'lehmofen', 'holzkohle_lagerfeuer'].map(recipe),
      ...['bronzeaxt', 'bronzeschaufel', 'bronzehacke', 'bronzesichel', 'bronzehammer', 'bronzemesser'].map(recipe),
      ...['wand_palisade', 'zaun_holz', 'kiste_holz', 'herdfeuer'].map(recipe),
      ...['feuersteinklinge', 'steinkampfaxt', 'holzkeule', 'kurzbogen', 'bronzeschwert', 'bronzekampfaxt', 'bronzestreitkolben', 'bronzespeer', 'bronzezweihaender'].map(recipe),
      ...['webstuhl', 'schneidertisch', 'gerbrahmen', 'knochenkeule', 'kastenfalle'].map(recipe),
    ]);
    // Driftwood is timber only through the group.
    expect(index.uses.get('treibholz')).toEqual([{ kind: 'brennstoff' }, { kind: 'zutat', by: 'ingredientGroups/bauholz' }]);
    expect(index.uses.get('apfel')).toEqual([{ kind: 'essen' }, recipe('kiste_deko')]);
    expect(index.uses.get('setzling_birke')).toEqual([{ kind: 'pflanzen' }]);
    // Placing a part, a chest, a bed or the hearth on the build grid costs the item (M4-11, M4-19 … M4-21, M4-34).
    for (const id of ['wand_holz', 'truhe', 'kiste_holz', 'strohbett', 'grasbett', 'herdfeuer']) expect(index.uses.get(id), id).toEqual([{ kind: 'baukosten', by: `buildParts/${id}` }]);
    // The covered table is a table with a cloth (M4-19): the table goes into it and is placed itself.
    expect(index.uses.get('tisch_holz')).toEqual([recipe('tischdecke'), { kind: 'baukosten', by: 'buildParts/tisch_holz' }]);
    // A station is used as the station of its recipes and by its own station record (M4-05).
    expect(index.uses.get('saegebock')?.at(-1)).toEqual({ kind: 'station', by: 'stations/saegebock' });
  });
});
