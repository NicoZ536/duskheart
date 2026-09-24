/**
 * M3-30: gesture rules of the inventory screen (src/ui/screens/inventar/model.ts) – slot keys, drag &
 * drop, Shift+click, right click, double click, number keys, the bin (confirmation from rarity Selten),
 * keyboard carrying, and which worn piece a tooltip compares with; the empty-slot silhouettes.
 */
import { describe, expect, it } from 'vitest';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import type { ItemDef, ItemInput } from '../../../src/content/schema/item';
import { emptyBags, withSlot, type BagsState } from '../../../src/game/inventory/bags';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { BAG_AREAS, EQUIPMENT_SLOTS, type SlotRef } from '../../../src/game/items/slots';
import { newStack } from '../../../src/game/items/stack';
import { GLYPH_SIZE, glyphRuns, type GlyphId } from '../../../src/ui/screens/inventar/glyphs';
import {
  carryConfirm,
  clickIntent,
  comparisonSlot,
  discardIntent,
  DOLL_LEFT,
  DOLL_RIGHT,
  dropIntent,
  equipmentSlotRef,
  gridRows,
  hotbarIntent,
  needsDiscardConfirm,
  parseSlotKey,
  slotKey,
} from '../../../src/ui/screens/inventar/model';

function probe(id: string, spec: Omit<ItemSpec, 'id' | 'name' | 'beschreibung' | 'tauschwert' | 'sounds'>): ItemInput {
  return baseItem({ id, name: { de: id, en: id }, beschreibung: { de: 'Test.', en: 'Test.' }, tauschwert: 1, sounds: { aufheben: ITEM_SFX.holz }, ...spec });
}

/** Fixture pieces of later tiers: armour, jewellery, tools, a backpack, and rarer items for the bin rule. */
const FIXTURES = defineItemGroup('ui_proben', [
  probe('ui_helm', { kategorie: 'ruestung', ausruestung: 'kopf', ruestungsgewicht: 'leicht', haltbarkeit: 60, werte: { ruestung: 2 } }),
  probe('ui_helm_selten', { kategorie: 'ruestung', ausruestung: 'kopf', ruestungsgewicht: 'mittel', haltbarkeit: 60, raritaet: 'selten', werte: { ruestung: 4 } }),
  probe('ui_ring', { kategorie: 'schmuck', ausruestung: 'schmuck', raritaet: 'episch', werte: { furchtresistenz: 0.2 } }),
  probe('ui_axt', { kategorie: 'werkzeug', haltbarkeit: 60, werkzeug: { art: 'axt', abbaukraft: 1 } }),
  probe('ui_axt2', { kategorie: 'werkzeug', haltbarkeit: 60, werkzeug: { art: 'axt', abbaukraft: 2 } }),
  probe('ui_rucksack', { kategorie: 'rucksack', rucksack: { plaetze: 8 } }),
]);
const catalog = new ItemCatalog([...ITEMS, ...FIXTURES]);
const def = (id: string): ItemDef => catalog.get(id);

function put(state: BagsState, ref: SlotRef, id: string): BagsState {
  return withSlot(state, ref, newStack(def(id), 1));
}

const INV = (index: number): SlotRef => ({ bereich: 'inventar', index });

describe('Inventar: Slot-Schlüssel', () => {
  it('Rundlauf für jeden Bereich, Fehlformen ergeben null', () => {
    for (const bereich of BAG_AREAS) expect(parseSlotKey(slotKey({ bereich, index: 7 }))).toEqual({ bereich, index: 7 });
    for (const bad of [null, undefined, '', 'inventar', 'tasche:1', 'inventar:-1', 'inventar:1.5', 'inventar:x']) expect(parseSlotKey(bad)).toBeNull();
  });
});

describe('Inventar: Gesten → Commands', () => {
  it('Ziehen auf einen anderen Platz verschiebt, auf denselben nichts', () => {
    expect(dropIntent(INV(1), INV(4))).toEqual({ kind: 'move', from: INV(1), to: INV(4) });
    expect(dropIntent(INV(1), INV(1))).toEqual({ kind: 'none' });
  });

  it('Klicks: Umschalt+Klick lagert um, Rechtsklick teilt, Doppelklick sammelt, einfacher Klick tut nichts', () => {
    const at = INV(3);
    expect(clickIntent(at, { button: 0, shift: true, detail: 1 })).toEqual({ kind: 'quickMove', from: at });
    expect(clickIntent(at, { button: 2, shift: false, detail: 1 })).toEqual({ kind: 'split', from: at });
    expect(clickIntent(at, { button: 0, shift: false, detail: 2 })).toEqual({ kind: 'collect', at });
    expect(clickIntent(at, { button: 0, shift: false, detail: 1 })).toEqual({ kind: 'none' });
    expect(clickIntent(at, { button: 1, shift: false, detail: 1 })).toEqual({ kind: 'none' });
  });

  it('Zifferntasten legen den Stapel unter dem Zeiger auf den Schnellleisten-Platz (Taste 1 = Platz 0, Taste 0 = Platz 9)', () => {
    expect(hotbarIntent(INV(5), 0)).toEqual({ kind: 'move', from: INV(5), to: { bereich: 'schnellleiste', index: 0 } });
    expect(hotbarIntent(INV(5), 9)).toEqual({ kind: 'move', from: INV(5), to: { bereich: 'schnellleiste', index: 9 } });
    expect(hotbarIntent({ bereich: 'schnellleiste', index: 2 }, 2)).toEqual({ kind: 'none' });
  });

  it('Mülleimer fragt erst ab Selten nach', () => {
    expect(needsDiscardConfirm(def('holz'))).toBe(false);
    expect(needsDiscardConfirm(def('leuchtpilz'))).toBe(false);
    expect(needsDiscardConfirm(def('ui_helm_selten'))).toBe(true);
    expect(needsDiscardConfirm(def('ui_ring'))).toBe(true);
    expect(discardIntent(INV(0), def('holz'))).toEqual({ kind: 'discard', from: INV(0), confirm: false });
    expect(discardIntent(INV(0), def('ui_ring'))).toEqual({ kind: 'discard', from: INV(0), confirm: true });
  });

  it('Tastatur: Bestätigen nimmt auf, auf anderem Platz legt es ab, auf demselben sammelt es (Doppelklick)', () => {
    let step = carryConfirm(null, INV(0), false);
    expect(step).toEqual({ carry: null, intent: { kind: 'none' } });
    step = carryConfirm(null, INV(2), true);
    expect(step).toEqual({ carry: INV(2), intent: { kind: 'none' } });
    expect(carryConfirm(INV(2), INV(7), false)).toEqual({ carry: null, intent: { kind: 'move', from: INV(2), to: INV(7) } });
    expect(carryConfirm(INV(2), INV(2), true)).toEqual({ carry: null, intent: { kind: 'collect', at: INV(2) } });
  });
});

describe('Inventar: Vergleich im Tooltip', () => {
  it('Rüstung mit dem getragenen Stück ihres Platzes, Schmuck mit dem belegten Schmuckplatz', () => {
    let bags = emptyBags();
    expect(comparisonSlot(bags, def('ui_helm_selten'), INV(0))).toBeNull();
    bags = put(bags, equipmentSlotRef('kopf'), 'ui_helm');
    expect(comparisonSlot(bags, def('ui_helm_selten'), INV(0))).toEqual(equipmentSlotRef('kopf'));
    bags = put(bags, equipmentSlotRef('schmuck2'), 'ui_ring');
    expect(comparisonSlot(bags, def('ui_ring'), INV(1))).toEqual(equipmentSlotRef('schmuck2'));
  });

  it('Werkzeug mit dem Stück in der Hand, nie ein getragenes Stück mit sich selbst; Rohstoffe ohne Vergleich', () => {
    let bags = put(emptyBags(), { bereich: 'schnellleiste', index: 0 }, 'ui_axt');
    expect(comparisonSlot(bags, def('ui_axt2'), INV(3))).toEqual({ bereich: 'schnellleiste', index: 0 });
    expect(comparisonSlot(bags, def('ui_axt'), { bereich: 'schnellleiste', index: 0 })).toBeNull();
    bags = put(bags, equipmentSlotRef('kopf'), 'ui_helm');
    expect(comparisonSlot(bags, def('ui_helm'), equipmentSlotRef('kopf'))).toBeNull();
    expect(comparisonSlot(bags, def('holz'), INV(0))).toBeNull();
    bags = put(bags, { bereich: 'rucksack', index: 0 }, 'ui_rucksack');
    expect(comparisonSlot(bags, def('ui_rucksack'), INV(2))).toEqual({ bereich: 'rucksack', index: 0 });
  });

  it('die Figur hat alle acht Ausrüstungsplätze links und rechts, Raster in Zehnerreihen', () => {
    expect([...DOLL_LEFT, ...DOLL_RIGHT].sort()).toEqual([...EQUIPMENT_SLOTS].sort());
    expect(gridRows(30)).toBe(3);
    expect(gridRows(24)).toBe(3);
    expect(gridRows(8)).toBe(1);
    expect(gridRows(0)).toBe(0);
  });
});

describe('Inventar: Silhouetten leerer Plätze', () => {
  it('jede Silhouette liegt im 12×12-Raster, ist nicht leer und hat ganze Läufe', () => {
    const ids: GlyphId[] = [...EQUIPMENT_SLOTS, 'guertel', 'rucksack', 'muell'];
    for (const id of ids) {
      const runs = glyphRuns(id);
      expect(runs.length, id).toBeGreaterThan(0);
      for (const [x, y, w] of runs) {
        expect(x >= 0 && y >= 0 && y < GLYPH_SIZE && x + w <= GLYPH_SIZE, `${id} ${x},${y},${w}`).toBe(true);
        expect(Number.isInteger(w) && w > 0).toBe(true);
      }
    }
  });
});
