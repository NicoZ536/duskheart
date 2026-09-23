import { describe, expect, it } from 'vitest';
import {
  RARITIES,
  findLocalizedTexts,
  idSchema,
  isContentId,
  localizedTextSchema,
  looksLikeLocalizedText,
  missingLanguages,
  parseRefPath,
  raritySchema,
  ref,
  resolvePath,
  tierSchema,
} from '../../../src/content/schema/common';

describe('idSchema', () => {
  it('accepts snake_case ascii ids', () => {
    for (const id of ['axe', 'stone_axe', 'glutsand_2', 'a1_b2_c3']) {
      expect(idSchema.safeParse(id).success).toBe(true);
      expect(isContentId(id)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const id of ['', 'Axe', 'stone-axe', '_axe', 'axe_', 'stone__axe', '2axe', 'äxte', 'stone axe', 'a'.repeat(65)]) {
      expect(idSchema.safeParse(id).success).toBe(false);
      expect(isContentId(id)).toBe(false);
    }
    expect(isContentId(42)).toBe(false);
  });
});

describe('localizedTextSchema', () => {
  it('requires both languages, non-empty', () => {
    expect(localizedTextSchema.parse({ de: 'Axt', en: 'Axe' })).toEqual({ de: 'Axt', en: 'Axe' });
    expect(localizedTextSchema.safeParse({ de: 'Axt' }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ de: 'Axt', en: '' }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ de: '   ', en: 'Axe' }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ de: 'Axt', en: 'Axe', fr: 'Hache' }).success).toBe(false);
  });

  it('finds localized texts anywhere in a record and reports missing languages', () => {
    const record = {
      id: 'tablet_1',
      name: { de: 'Tafel', en: 'Tablet' },
      pages: [{ text: { de: 'Seite', en: '' } }, { text: { de: 'Zwei' } }],
      data: new Uint8Array(4),
      count: 3,
    };
    const found = findLocalizedTexts(record);
    expect(found.map((f) => f.path)).toEqual(['name', 'pages[0].text', 'pages[1].text']);
    expect(found.map((f) => missingLanguages(f.text))).toEqual([[], ['en'], ['en']]);
    expect(looksLikeLocalizedText({ de: 'x', note: 'y' })).toBe(false);
    expect(looksLikeLocalizedText({})).toBe(false);
    expect(looksLikeLocalizedText(['de'])).toBe(false);
  });
});

describe('tier and rarity', () => {
  it('tiers are integers 0–7', () => {
    expect(tierSchema.safeParse(0).success).toBe(true);
    expect(tierSchema.safeParse(7).success).toBe(true);
    expect(tierSchema.safeParse(8).success).toBe(false);
    expect(tierSchema.safeParse(-1).success).toBe(false);
    expect(tierSchema.safeParse(1.5).success).toBe(false);
  });

  it('has the five rarities of §4.5 in ascending order', () => {
    expect(RARITIES).toEqual(['gewoehnlich', 'ungewoehnlich', 'selten', 'episch', 'legendaer']);
    expect(raritySchema.safeParse('episch').success).toBe(true);
    expect(raritySchema.safeParse('mythisch').success).toBe(false);
  });
});

describe('reference paths', () => {
  it('parses valid paths and rejects malformed ones', () => {
    expect(parseRefPath('inputs[].item')).toEqual([
      { key: 'inputs', mode: 'array' },
      { key: 'item', mode: 'value' },
    ]);
    expect(parseRefPath('loot{}.item')[0]).toEqual({ key: 'loot', mode: 'map' });
    for (const bad of ['', 'a..b', 'a[', 'a[].', '1a', 'a b']) expect(() => parseRefPath(bad)).toThrow(SyntaxError);
    expect(() => ref('a..b', 'items')).toThrow(SyntaxError);
    expect(ref('station', 'stations')).toEqual({ path: 'station', collection: 'stations' });
  });

  it('resolves every value at a path with its concrete location', () => {
    const record = {
      station: 'workbench',
      inputs: [{ item: 'wood' }, { item: 'stone' }, { count: 2 }],
      loot: { common: { item: 'fiber' }, rare: { item: 'amber' } },
      optional: null,
    };
    expect(resolvePath(record, 'station')).toEqual([{ at: 'station', value: 'workbench' }]);
    expect(resolvePath(record, 'inputs[].item')).toEqual([
      { at: 'inputs[0].item', value: 'wood' },
      { at: 'inputs[1].item', value: 'stone' },
    ]);
    expect(resolvePath(record, 'loot{}.item')).toEqual([
      { at: 'loot.common.item', value: 'fiber' },
      { at: 'loot.rare.item', value: 'amber' },
    ]);
    expect(resolvePath(record, 'optional')).toEqual([]);
    expect(resolvePath(record, 'missing.deep')).toEqual([]);
    // Shape mismatch surfaces the raw value so the validator can report it.
    expect(resolvePath(record, 'station[]')).toEqual([{ at: 'station', value: 'workbench' }]);
  });
});
