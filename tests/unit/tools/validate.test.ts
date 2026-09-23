import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT_CATEGORIES } from '../../../src/content/categories';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema, localizedTextSchema, ref, refSchema } from '../../../src/content/schema/common';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, FINAL } from '../../../tools/content-targets';
import {
  checkI18nParity,
  checkLocalizedTexts,
  checkReferences,
  checkTargets,
  countCategories,
  effectiveTargets,
  emptyResult,
  loadRegistry,
  loadTargets,
  parseTargets,
  runChecks,
  validateRegistry,
} from '../../../tools/validator/checks';

const TARGET_FIXTURE = fileURLToPath(new URL('../../fixtures/validator/zielwerte-items-4.json', import.meta.url));

const itemSchema = z.object({ id: idSchema, name: localizedTextSchema }).strict();
const recipeSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    output: refSchema,
    inputs: z.array(z.object({ item: refSchema, count: z.number().int().min(1) })),
    station: refSchema.optional(),
  })
  .strict();

const ITEMS = [
  { id: 'wood', name: { de: 'Holz', en: 'Wood' } },
  { id: 'stone', name: { de: 'Stein', en: 'Stone' } },
  { id: 'stone_axe', name: { de: 'Steinaxt', en: 'Stone axe' } },
];

function fixture(recipes: Array<z.input<typeof recipeSchema>>, recipeRefs = [ref('output', 'items'), ref('inputs[].item', 'items')]) {
  return new ContentRegistry()
    .defineCollection('items', itemSchema, ITEMS, { category: (r) => (r.id.endsWith('_axe') ? ['items', 'weapons'] : ['items']) })
    .defineCollection('recipes', recipeSchema, recipes, { category: 'recipes', refs: recipeRefs });
}

const GOOD_RECIPE = {
  id: 'craft_stone_axe',
  name: { de: 'Steinaxt bauen', en: 'Make stone axe' },
  output: 'stone_axe',
  inputs: [
    { item: 'wood', count: 2 },
    { item: 'stone', count: 3 },
  ],
};

describe('content validator: registry checks', () => {
  it('a consistent fixture passes and reports counts for every §C category', () => {
    const res = validateRegistry(fixture([GOOD_RECIPE]));
    expect(res.errors).toEqual([]);
    expect(Object.keys(res.counts).sort()).toEqual(Object.keys(CATEGORIES).sort());
    expect(res.counts.items).toBe(3);
    expect(res.counts.weapons).toBe(1);
    expect(res.counts.recipes).toBe(1);
    expect(res.counts.bosses).toBe(0);
  });

  it('a broken reference is an error naming record, path and target', () => {
    const broken = { ...GOOD_RECIPE, inputs: [{ item: 'wood', count: 2 }, { item: 'flint', count: 1 }] };
    const errors = checkReferences(fixture([broken]));
    expect(errors).toEqual(['Referenz recipes/craft_stone_axe.inputs[1].item → items/flint existiert nicht']);
    expect(validateRegistry(fixture([broken])).errors).toHaveLength(1);
  });

  it('a reference into an undefined collection is an error', () => {
    const withStation = { ...GOOD_RECIPE, station: 'workbench' };
    const errors = checkReferences(fixture([withStation], [ref('output', 'items'), ref('station', 'stations')]));
    expect(errors).toEqual(['Referenz recipes/craft_stone_axe.station zeigt auf unbekannte Sammlung "stations"']);
  });

  it('a malformed reference value is an error', () => {
    const lax = new ContentRegistry().defineCollection('things', z.object({ id: idSchema, target: z.unknown() }), [{ id: 'a', target: 5 }], {
      refs: [ref('target', 'things')],
    });
    expect(checkReferences(lax)).toEqual(['Referenz things/a.target ist keine gültige ID: 5']);
  });

  it('a missing translation is an error (schema at load time)', async () => {
    const missing = [{ id: 'wood', name: { de: 'Holz' } }];
    const loaded = await loadRegistry(() => new ContentRegistry().defineCollection('items', itemSchema, missing as never));
    expect(loaded.registry).toBeUndefined();
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toMatch(/Content lässt sich nicht laden: Content items\[0\] "wood" invalid: name\.en/);
  });

  it('a missing or empty translation is an error even with a lax schema', () => {
    const laxText = z.object({ de: z.string(), en: z.string().optional() });
    const lax = new ContentRegistry().defineCollection('tablets', z.object({ id: idSchema, pages: z.array(laxText) }), [
      { id: 'tablet_1', pages: [{ de: 'Seite eins', en: 'Page one' }, { de: 'Seite zwei' }, { de: ' ', en: 'Page three' }] },
    ]);
    expect(checkLocalizedTexts(lax)).toEqual(['Übersetzung fehlt (EN): tablets/tablet_1.pages[1]', 'Übersetzung fehlt (DE): tablets/tablet_1.pages[2]']);
  });

  it('counts only known categories', () => {
    const view: ContentRegistryView = {
      collectionNames: () => [],
      collections: () => [],
      hasCollection: () => false,
      has: () => false,
      countsByCategory: () => ({ items: 2, gadgets: 1 }) as never,
      references: () => [],
    };
    const { counts, errors } = countCategories(view);
    expect(counts.items).toBe(2);
    expect(errors).toEqual([expect.stringMatching(/Unbekannte Zählkategorie "gadgets"/)]);
  });

  it('content categories and validator categories are the same list', () => {
    expect([...CONTENT_CATEGORIES].sort()).toEqual(Object.keys(CATEGORIES).sort());
  });
});

describe('content validator: i18n parity', () => {
  it('reports keys missing or empty in either language', () => {
    expect(checkI18nParity({ a: 'A', b: 'B' }, { a: 'A', b: 'B' })).toEqual([]);
    expect(checkI18nParity({ a: 'A', b: 'B' }, { a: 'A', c: 'C' })).toEqual(['Übersetzung fehlt (EN): b', 'Übersetzung fehlt (DE): c']);
    expect(checkI18nParity({ a: 'A' }, { a: '  ' })).toEqual(['Übersetzung fehlt (EN): a']);
    expect(checkI18nParity({ a: 1 }, { a: 'A' })).toEqual(['Übersetzung fehlt (DE): a']);
  });
});

describe('content validator: Zielwerte (ADR-0007)', () => {
  it('ein Zählwert unter dem Zielwert ist ein Fehler', () => {
    const counts = validateRegistry(fixture([GOOD_RECIPE])).counts;
    const targets = loadTargets(TARGET_FIXTURE);
    expect(targets.items).toBe(4);
    expect(checkTargets(counts, targets)).toEqual(['Mindestmenge Items gesamt (inkl. Bauteile): 3 < Ziel 4 (§C: 550)']);
    expect(checkTargets(counts, { ...targets, items: 3 })).toEqual([]);
  });

  it('die Zielwerte-Datei des Projekts nennt jede §C-Kategorie und wird erfüllt', async () => {
    const targets = loadTargets();
    expect(Object.keys(targets).sort()).toEqual(Object.keys(CATEGORIES).sort());
    for (const c of Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>) expect(targets[c]).toBeLessThanOrEqual(FINAL[c]);
    expect(checkTargets((await runChecks()).counts, targets)).toEqual([]);
  });

  it('eine unvollständige oder fehlerhafte Zielwerte-Datei ist ein Fehler', () => {
    const ziele = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, 0]));
    expect(() => parseTargets({ beschreibung: 'x', ziele })).not.toThrow();
    const { items: _items, ...ohneItems } = ziele;
    expect(() => parseTargets({ beschreibung: 'x', ziele: ohneItems })).toThrow(/ziele\.items/);
    expect(() => parseTargets({ beschreibung: 'x', ziele: { ...ziele, gadgets: 1 } })).toThrow(/Zielwerte ungültig/);
    expect(() => parseTargets({ beschreibung: 'x', ziele: { ...ziele, items: -1 } })).toThrow(/ziele\.items/);
    expect(() => parseTargets({ beschreibung: 'x', ziele: { ...ziele, items: 1.5 } })).toThrow(/ziele\.items/);
  });

  it('nach Spielabschluss gilt §C als Untergrenze', () => {
    const zero = parseTargets({ beschreibung: 'x', ziele: Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, 0])) });
    expect(effectiveTargets(zero, false)).toEqual(zero);
    expect(effectiveTargets(zero, true)).toEqual(FINAL);
    expect(checkTargets({}, effectiveTargets(zero, true))).toHaveLength(Object.keys(CATEGORIES).length);
  });
});

describe('content validator: real project', () => {
  it('runChecks loads the game registry and passes', async () => {
    const res = await runChecks();
    expect(res.errors).toEqual([]);
    expect(Object.keys(res.counts).sort()).toEqual(Object.keys(CATEGORIES).sort());
    expect(emptyResult().counts.items).toBe(0);
  });
});
