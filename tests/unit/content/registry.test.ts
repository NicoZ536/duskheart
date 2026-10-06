import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentError, ContentRegistry } from '../../../src/content/registry';
import { idSchema, localizedTextSchema, ref, refSchema, tierSchema } from '../../../src/content/schema/common';
import { m6CountsByCategory, missingM6, type StandCollection } from './stand';

const materialSchema = z.object({ id: idSchema, name: localizedTextSchema, tier: tierSchema }).strict();
const weaponSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    material: refSchema,
    upgrades: z.array(z.object({ material: refSchema, count: z.number().int().min(1) })).default([]),
  })
  .strict();

const MATERIALS = [
  { id: 'wood', name: { de: 'Holz', en: 'Wood' }, tier: 0 },
  { id: 'copper_ingot', name: { de: 'Kupferbarren', en: 'Copper ingot' }, tier: 1 },
];
const WEAPONS = [
  { id: 'club', name: { de: 'Keule', en: 'Club' }, material: 'wood' },
  { id: 'copper_sword', name: { de: 'Kupferschwert', en: 'Copper sword' }, material: 'copper_ingot', upgrades: [{ material: 'wood', count: 2 }] },
];

/**
 * The collections docs/SPIEL.md §29 adds with M7 ("**Neue Sammlungen** … `traps` … bleibt unberührt."): the backticked names of
 * that paragraph (ADR-0207).
 */
function m7Collections(): Set<string> {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const from = doc.indexOf('- **Neue Sammlungen**');
  const to = doc.indexOf('bleibt\n  unberührt.', from);
  if (from < 0 || to < 0) throw new Error('docs/SPIEL.md §29: Absatz „Neue Sammlungen“ fehlt');
  return new Set([...doc.slice(from, to).matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1] as string));
}

function fixture() {
  return new ContentRegistry()
    .defineCollection('materials', materialSchema, MATERIALS, { category: 'items' })
    .defineCollection('weapons', weaponSchema, WEAPONS, {
      category: ['items', 'weapons'],
      refs: [ref('material', 'materials'), ref('upgrades[].material', 'materials')],
    });
}

describe('ContentRegistry', () => {
  it('works with zero collections', () => {
    const empty = new ContentRegistry();
    expect(empty.collectionNames()).toEqual([]);
    expect(empty.countsByCategory()).toEqual({});
    expect(empty.references()).toEqual([]);
    expect(empty.has('items', 'axe')).toBe(false);
  });

  it('the game registry holds the world, M3, M4, M5 and M6 collections in dependency order, then those of M7', () => {
    // World (M2), then items (M3-01), the ingredient groups (M4-01) and recipes (M3-16) that reference items and
    // groups, the stations (M4-05) the recipes name, the build parts (M4-11) and room types (M4-17), conditions
    // (M3-19), skills (M3-32), the sound presets (M3-33) and the particle kinds and sources (M5-11).
    const names = CONTENT.collectionNames();
    const upToM6 = [
      'biomes',
      'ores',
      'terrain',
      'worldObjects',
      'items',
      'ingredientGroups',
      'recipes',
      'stations',
      'buildParts',
      'roomTypes',
      'conditions',
      'skills',
      'armorSets',
      'perks',
      'sfx',
      'aiProfiles',
      'lootTables',
      'creatures',
      'spawnTables',
      'traps',
      'particleKinds',
      'particleEmitters',
    ];
    expect(names.slice(0, upToM6.length)).toEqual(upToM6);
    // M7 (ADR-0207): every later collection is one of the new collections of docs/SPIEL.md §29 – the places' and the observers'
    // since wave 0, the strands' as they come.
    const m7 = m7Collections();
    expect(m7.size).toBeGreaterThanOrEqual(30);
    expect(names.slice(upToM6.length).filter((n) => !m7.has(n))).toEqual([]);
    for (const n of ['locationTypes', 'placeLayouts', 'placeLoot', 'stats', 'statSources', 'milestones', 'chronicleRules', 'knowledge', 'guideHints', 'mechanics']) expect(names, n).toContain(n);
    expect(CONTENT.has('biomes', 'gruenhain')).toBe(true);
    // Every record counts in its collection's categories (ADR-0006); items also in their kind's category.
    const items = CONTENT.collection('items').values();
    const expected: Record<string, number> = {
      trees: 14,
      items: items.length,
      potions: items.filter((i) => i.kategorie === 'trank' || i.kategorie === 'medizin').length,
      // Weapons are the items with attack data: the weapon category and the thrown weapons among the ammunition (M6-11).
      weapons: items.filter((i) => i.waffe !== undefined).length,
      armor: items.filter((i) => i.kategorie === 'ruestung').length,
      jewelry: items.filter((i) => i.kategorie === 'schmuck').length,
      armorSets: CONTENT.collection('armorSets').size,
      perks: CONTENT.collection('perks').size,
      creatures: CONTENT.collection('creatures').size,
      buildParts: items.filter((i) => i.kategorie === 'bauteil').length,
      recipes: CONTENT.collection('recipes').size,
      stations: CONTENT.collection('stations').size,
      statusEffects: CONTENT.collection('conditions').size,
      sfx: CONTENT.collection('sfx').size,
    };
    // M7 (ADR-0207): the dishes among the items, the elites among the creatures and the categories of the collections §29 adds
    // count as their records map them – a key only where something counts.
    const dishes = items.filter((i) => i.kategorie === 'gericht').length;
    if (dishes > 0) expected.dishes = dishes;
    const elites = CONTENT.collection('creatures')
      .values()
      .filter((c) => c.familie === 'elite').length;
    if (elites > 0) expected.elites = elites;
    for (const c of CONTENT.collections().slice(upToM6.length)) for (const r of c.values()) for (const cat of c.categoriesOf(r)) expected[cat] = (expected[cat] ?? 0) + 1;
    expect(CONTENT.countsByCategory()).toEqual(expected);
    // M4 acceptance (M4-06, M4-10, M4-12, M4-19): ≥ 11 stations, ≥ 150 items, ≥ 90 recipes, ≥ 70 build parts, furniture and decoration;
    // M6 adds the armoury (M6-11, M6-12, M6-31: 49 items, 49 recipes, 3 stations, 22 weapons, 12 armour pieces in 3 sets, 18 combat
    // perks) and hunting (M6-30); the creature strands their special parts (M6-22 wasp stings with their arrow poison recipe,
    // M6-23/24 raw crab meat); M6-30d the wolf's fang and the boar's tusk with the first jewellery (4 items, 2 recipes); the
    // M6 gate the jellyfish's stinging threads with their arrow poison recipe (MASTERPROMPT §20.1 "Jede Kreatur: … Beutetabelle").
    // Counted over the records of M6 (tests/fixtures/content/stand-m6.json), none of them lost – M7 adds its own (ADR-0208);
    // the validator's targets keep the totals (tools/validator/zielwerte.json).
    for (const c of ['items', 'recipes', 'stations', 'conditions', 'perks', 'creatures', 'armorSets'] as const satisfies readonly StandCollection[]) expect(missingM6(c), c).toEqual([]);
    expect(m6CountsByCategory()).toMatchObject({ items: 239, recipes: 186, stations: 15, buildParts: 74, statusEffects: 31, weapons: 22, armor: 12, armorSets: 3, jewelry: 2, perks: 18 });
  });

  it('validates, types and looks up records', () => {
    const reg = fixture();
    const sword = reg.get('weapons', 'copper_sword');
    expect(sword.name.en).toBe('Copper sword');
    expect(sword.upgrades).toEqual([{ material: 'wood', count: 2 }]);
    // Schema defaults are applied at load time.
    expect(reg.get('weapons', 'club').upgrades).toEqual([]);
    expect(reg.collection('materials').ids()).toEqual(['wood', 'copper_ingot']);
    expect(reg.collection('materials').size).toBe(2);
    expect(reg.has('materials', 'wood')).toBe(true);
    expect(reg.has('materials', 'stone')).toBe(false);
    expect(reg.collection('weapons').find('spear')).toBeUndefined();
    expect(reg.collectionNames()).toEqual(['materials', 'weapons']);
  });

  it('freezes loaded records', () => {
    const reg = fixture();
    const wood = reg.get('materials', 'wood');
    expect(Object.isFrozen(wood)).toBe(true);
    expect(Object.isFrozen(wood.name)).toBe(true);
    expect(() => {
      (wood as { tier: number }).tier = 5;
    }).toThrow(TypeError);
  });

  it('throws descriptive errors for unknown collections and ids', () => {
    const reg = fixture();
    expect(() => reg.get('weapons', 'spear')).toThrow(ContentError);
    expect(() => reg.get('weapons', 'spear')).toThrow(/Unknown id "spear" in content collection "weapons"/);
    const untyped = reg as unknown as ContentRegistry<Record<string, { id: string }>>;
    expect(() => untyped.get('armor', 'helmet')).toThrow(/Unknown content collection "armor" \(defined: materials, weapons\)/);
    expect(() => new ContentRegistry().collection('items' as never)).toThrow(/defined: none/);
  });

  it('rejects schema violations with collection, index, id and issue path', () => {
    const bad = [{ id: 'axe', name: { de: 'Axt' }, tier: 1 }];
    expect(() => new ContentRegistry().defineCollection('materials', materialSchema, bad as never)).toThrow(ContentError);
    expect(() => new ContentRegistry().defineCollection('materials', materialSchema, bad as never)).toThrow(/materials\[0\] "axe" invalid: name\.en/);
    const badTier = [{ id: 'axe', name: { de: 'Axt', en: 'Axe' }, tier: 9 }];
    expect(() => new ContentRegistry().defineCollection('materials', materialSchema, badTier)).toThrow(/tier/);
  });

  it('rejects malformed ids even when the schema forgets idSchema', () => {
    const lax = z.object({ id: z.string() });
    expect(() => new ContentRegistry().defineCollection('things', lax, [{ id: 'Bad-Id' }])).toThrow(/snake_case/);
  });

  it('rejects duplicate ids and duplicate collections', () => {
    expect(() => new ContentRegistry().defineCollection('materials', materialSchema, [MATERIALS[0], MATERIALS[1], MATERIALS[0]] as typeof MATERIALS)).toThrow(
      /Duplicate id "wood" in content collection "materials" \(records 0 and 2\)/,
    );
    const reg = new ContentRegistry().defineCollection('materials', materialSchema, MATERIALS);
    expect(() => reg.defineCollection('materials', materialSchema, [])).toThrow(/already defined/);
  });

  it('validates collection names, reference paths and category mappings', () => {
    expect(() => new ContentRegistry().defineCollection('Bad_Name', materialSchema, [])).toThrow(/Invalid collection name/);
    expect(() => new ContentRegistry().defineCollection('weapons', weaponSchema, WEAPONS, { refs: [{ path: 'a..b', collection: 'materials' }] })).toThrow(ContentError);
    expect(() => new ContentRegistry().defineCollection('weapons', weaponSchema, WEAPONS, { refs: [{ path: 'material', collection: 'Bad Name' }] })).toThrow(/invalid collection name/);
    expect(() => new ContentRegistry().defineCollection('materials', materialSchema, MATERIALS, { category: () => ['gadgets' as never] })).toThrow(/unknown category "gadgets"/);
  });

  it('counts records per §C category using each collection mapping', () => {
    const reg = fixture().defineCollection('trees', z.object({ id: idSchema, kind: z.enum(['fruit', 'wood']) }), [
      { id: 'apple', kind: 'fruit' },
      { id: 'oak', kind: 'wood' },
    ], { category: (r) => (r.kind === 'fruit' ? ['trees', 'crops', 'trees'] : ['trees']) });
    expect(reg.countsByCategory()).toEqual({ items: 4, weapons: 2, trees: 2, crops: 1 });
  });

  it('lists every declared reference with its concrete location', () => {
    expect(fixture().references()).toEqual([
      { collection: 'weapons', id: 'club', at: 'material', target: 'materials', value: 'wood' },
      { collection: 'weapons', id: 'copper_sword', at: 'material', target: 'materials', value: 'copper_ingot' },
      { collection: 'weapons', id: 'copper_sword', at: 'upgrades[0].material', target: 'materials', value: 'wood' },
    ]);
  });
});
