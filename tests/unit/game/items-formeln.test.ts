/**
 * Item-Laufzeit (docs/SPIEL.md §2): Katalog, Stapel (Anlegen, Zusammenlegen, Prüfen), Platzregeln und
 * die reinen Item-Formeln (Qualität, Haltbarkeit, Frische).
 */
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../../src/content/items/index';
import { contentItemCatalog, ItemCatalog, ItemCatalogError } from '../../../src/game/items/catalog';
import { FRESHNESS_MAX, maxDurability, QUALITY_MAX, QUALITY_MIN, qualityFactor, weightedFreshness, wornDurability } from '../../../src/game/items/formulas';
import { EQUIPMENT_SLOTS, FIXED_AREA_SIZES, MAX_SLOT_INDEX, equipmentRef, equipmentSlotIndex, sameSlot, slotCapacity } from '../../../src/game/items/slots';
import { canStack, checkStack, itemStackSchema, joinedStack, newStack, stackQuality, withCount } from '../../../src/game/items/stack';
import { testCatalog } from './items-fixtures';

const catalog = testCatalog();

describe('Item-Katalog', () => {
  it('der Content-Katalog enthält alle Items der Registry, einmal gebaut', () => {
    const c = contentItemCatalog();
    expect(c).toBe(contentItemCatalog());
    expect(c.ids()).toEqual(ITEMS.map((i) => i.id));
    expect(c.get('holz').name.de).toBe('Holz');
    expect(c.find('gibtsnicht')).toBeUndefined();
    expect(() => c.get('gibtsnicht')).toThrow(ItemCatalogError);
  });

  it('lehnt doppelte Ids ab', () => {
    const holz = ITEMS.find((i) => i.id === 'holz');
    if (holz === undefined) throw new Error('holz fehlt');
    expect(() => new ItemCatalog([holz, holz])).toThrow(/duplicate item "holz"/);
  });
});

describe('Stapel', () => {
  it('neue Stapel: volle Haltbarkeit je Qualität, volle Frische, Qualität 1 wird nicht gespeichert', () => {
    expect(newStack(catalog.get('holz'), 5)).toEqual({ item: 'holz', count: 5 });
    expect(newStack(catalog.get('himbeeren'), 2)).toEqual({ item: 'himbeeren', count: 2, frische: FRESHNESS_MAX });
    expect(newStack(catalog.get('himbeeren'), 2, { frische: 30 })).toMatchObject({ frische: 30 });
    expect(newStack(catalog.get('probe_axt'), 1, { qualitaet: 2 })).toEqual({ item: 'probe_axt', count: 1, haltbarkeit: 66, qualitaet: 2 });
    expect(newStack(catalog.get('stein'), 1, { daten: { name: 'Glücksstein' } }).daten).toEqual({ name: 'Glücksstein' });
    expect(() => newStack(catalog.get('stein'), 0)).toThrow(RangeError);
    expect(stackQuality({ item: 'stein', count: 1 })).toBe(1);
  });

  it('zusammenlegbar nur bei gleichem Item, gleicher Qualität, gleichen Daten und ohne Haltbarkeit', () => {
    const stein = newStack(catalog.get('stein'), 3);
    expect(canStack(stein, withCount(stein, 9))).toBe(true);
    expect(canStack(stein, newStack(catalog.get('holz'), 3))).toBe(false);
    expect(canStack(stein, { ...stein, qualitaet: 2 })).toBe(false);
    expect(canStack(stein, { ...stein, daten: { a: 1 } })).toBe(false);
    expect(canStack({ ...stein, daten: { a: 1 } }, { ...stein, daten: { a: 1 } })).toBe(true);
    expect(canStack({ ...stein, daten: { a: 1 } }, { ...stein, daten: { a: 2 } })).toBe(false);
    const axt = newStack(catalog.get('probe_axt'), 1);
    expect(canStack(axt, axt)).toBe(false);
    expect(joinedStack({ item: 'apfel', count: 4, frische: 50 }, { item: 'apfel', count: 12, frische: 100 }, 4)).toEqual({ item: 'apfel', count: 8, frische: 75 });
    expect(joinedStack(stein, stein, 2)).toEqual({ item: 'stein', count: 5 });
  });

  it('checkStack prüft Menge, Haltbarkeit und Frische gegen das Item', () => {
    const axt = catalog.get('probe_axt');
    const beeren = catalog.get('himbeeren');
    expect(checkStack(axt, { item: 'probe_axt', count: 1, haltbarkeit: 60 }, 1)).toBeNull();
    expect(checkStack(axt, { item: 'probe_axt', count: 1, haltbarkeit: 61 }, 1)).toMatch(/exceeds its maximum/);
    expect(checkStack(axt, { item: 'probe_axt', count: 1, haltbarkeit: 66, qualitaet: 2 }, 1)).toBeNull();
    expect(checkStack(axt, { item: 'probe_axt', count: 1 }, 1)).toMatch(/needs its durability/);
    expect(checkStack(axt, { item: 'probe_axt', count: 2, haltbarkeit: 5 }, 1)).toMatch(/exceed the slot capacity/);
    expect(checkStack(beeren, { item: 'himbeeren', count: 20, frische: 10 }, 20)).toBeNull();
    expect(checkStack(beeren, { item: 'himbeeren', count: 20 }, 20)).toMatch(/needs its freshness/);
    expect(checkStack(catalog.get('stein'), { item: 'stein', count: 1, frische: 3 }, 100)).toMatch(/does not spoil/);
    expect(checkStack(catalog.get('stein'), { item: 'stein', count: 1, haltbarkeit: 3 }, 100)).toMatch(/has no durability/);
    expect(checkStack(catalog.get('stein'), { item: 'holz', count: 1 }, 100)).toMatch(/checked against/);
  });

  it('Stapelschema: kanonisch (Qualität ab 2 Sternen, Frische 0–100, keine fremden Felder)', () => {
    expect(itemStackSchema.safeParse({ item: 'stein', count: 3 }).success).toBe(true);
    expect(itemStackSchema.safeParse({ item: 'stein', count: 3, qualitaet: 1 }).success).toBe(false);
    expect(itemStackSchema.safeParse({ item: 'stein', count: 3, frische: 101 }).success).toBe(false);
    expect(itemStackSchema.safeParse({ item: 'stein', count: 0 }).success).toBe(false);
    expect(itemStackSchema.safeParse({ item: 'stein', count: 1, farbe: 'rot' }).success).toBe(false);
  });
});

describe('Plätze', () => {
  it('Bereichsgrößen, Ausrüstungsadressen, Kapazität', () => {
    expect(FIXED_AREA_SIZES).toEqual({ inventar: 30, schnellleiste: 10, rucksack: 1, ausruestung: 8, guertel: 3 });
    expect(MAX_SLOT_INDEX).toBe(29);
    expect(EQUIPMENT_SLOTS.map((s) => equipmentSlotIndex(s))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(equipmentRef('nebenhand')).toEqual({ bereich: 'ausruestung', index: 5 });
    expect(sameSlot(equipmentRef('kopf'), { bereich: 'ausruestung', index: 0 })).toBe(true);
    expect(slotCapacity('inventar', catalog.get('stein'))).toBe(100);
    expect(slotCapacity('guertel', catalog.get('himbeeren'))).toBe(20);
    expect(slotCapacity('ausruestung', catalog.get('probe_ring'))).toBe(1);
  });
});

describe('Formeln', () => {
  it('Qualitätsfaktor, Höchsthaltbarkeit, Verschleiß, Frische', () => {
    expect([QUALITY_MIN, QUALITY_MAX]).toEqual([1, 3]);
    expect(qualityFactor(3)).toBe(1.2);
    expect(() => qualityFactor(0)).toThrow(RangeError);
    expect(() => qualityFactor(1.5)).toThrow(RangeError);
    expect([maxDurability(150, 2), maxDurability(1200, 3), maxDurability(250, 2)]).toEqual([165, 1440, 275]);
    expect([wornDurability(10, 3), wornDurability(2, 5), wornDurability(0, 1)]).toEqual([7, 0, 0]);
    expect(weightedFreshness(100, 1, 0, 3)).toBe(25);
  });
});
