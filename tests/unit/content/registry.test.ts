import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentError, ContentRegistry } from '../../../src/content/registry';
import { idSchema, localizedTextSchema, ref, refSchema, tierSchema } from '../../../src/content/schema/common';

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

function fixture() {
  return new ContentRegistry()
    .defineCollection('materials', materialSchema, MATERIALS, { category: 'items' })
    .defineCollection('weapons', weaponSchema, WEAPONS, {
      category: ['items', 'weapons'],
      refs: [ref('material', 'materials'), ref('upgrades[].material', 'materials')],
    });
}

describe('ContentRegistry', () => {
  it('works with zero collections (the M0 game registry)', () => {
    const empty = new ContentRegistry();
    expect(empty.collectionNames()).toEqual([]);
    expect(empty.countsByCategory()).toEqual({});
    expect(empty.references()).toEqual([]);
    expect(empty.has('items', 'axe')).toBe(false);
    expect(CONTENT.collectionNames()).toEqual([]);
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
