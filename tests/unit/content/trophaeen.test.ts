/**
 * M6-30d: the special parts of the Grünhain foes (src/content/items/trophaeen.ts) – `wolfszahn` from the wolf, `keilerhauer`
 * from the boar, carved from their carcasses (source `drop:<kreatur>`, derived from the loot tables) – and their use: the
 * first jewellery, strung at the workbench (src/content/recipes/trophaeen.ts), worn in the jewellery slots with a small,
 * real effect (fear resistance through the fear formulas, maximum health through the equipment's stats). Icons in the
 * game atlas; the validator counts the jewellery.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { itemCountCategories, itemIconId } from '../../../src/content/items/index';
import { TROPHAEEN } from '../../../src/content/items/trophaeen';
import { buildItemIndex } from '../../../src/content/items/usage';
import { TROPHAEEN_REZEPTE } from '../../../src/content/recipes/trophaeen';
import { SPRITES } from '../../../src/generated/atlas';
import { aggregateEquipmentStats } from '../../../src/game/equipment/formulas';
import { frightAmount } from '../../../src/game/fear/formulas';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { EQUIPMENT_SLOTS, EQUIPMENT_SLOT_KIND } from '../../../src/game/items/slots';

const catalog = contentItemCatalog();
const index = buildItemIndex(CONTENT);

describe('Jagdtrophäen des Grünhains (M6-30d)', () => {
  it('Wolfszahn und Keilerhauer stammen vom Zerlegen des Wolfs bzw. Keilers', () => {
    const loot = CONTENT.collection('lootTables');
    expect(loot.get('wolf').zerlegen.find((z) => z.item === 'wolfszahn')).toMatchObject({ chance: expect.any(Number) });
    expect(loot.get('keiler').zerlegen.find((z) => z.item === 'keilerhauer')).toMatchObject({ chance: expect.any(Number) });
    expect(index.sources.get('wolfszahn')).toEqual(['drop:wolf']);
    expect(index.sources.get('keilerhauer')).toEqual(['drop:keiler']);
    // Special parts: only their own creature gives them.
    for (const table of loot.values()) {
      const items = [...table.beute.map((b) => b.item), ...table.zerlegen.map((z) => z.item)];
      if (items.includes('wolfszahn')) expect(table.id).toBe('wolf');
      if (items.includes('keilerhauer')) expect(table.id).toBe('keiler');
    }
  });

  it('jedes Teil wird verwendet: Kette aus drei Zähnen, Amulett aus zwei Hauern, beide an der Werkbank mit Sehne', () => {
    expect(TROPHAEEN_REZEPTE.map((r) => [r.id, r.station, r.ergebnis, r.zutaten])).toEqual([
      ['rezept_wolfszahnkette', 'werkbank', { item: 'wolfszahnkette', anzahl: 1 }, [{ item: 'wolfszahn', anzahl: 3 }, { item: 'sehnen', anzahl: 1 }]],
      ['rezept_haueramulett', 'werkbank', { item: 'haueramulett', anzahl: 1 }, [{ item: 'keilerhauer', anzahl: 2 }, { item: 'sehnen', anzahl: 1 }]],
    ]);
    for (const part of ['wolfszahn', 'keilerhauer']) expect(index.uses.get(part)?.some((u) => u.kind === 'zutat'), part).toBe(true);
    for (const jewel of ['wolfszahnkette', 'haueramulett']) {
      expect(index.uses.get(jewel)?.some((u) => u.kind === 'ausruesten'), jewel).toBe(true);
      expect(index.sources.get(jewel), jewel).toEqual([`rezept:rezept_${jewel}`]);
      expect(CONTENT.has('recipes', `rezept_${jewel}`)).toBe(true);
    }
  });

  it('Schmuck: getragen in den Schmuckplätzen, zählt als Schmuck (§C), ungewöhnlich, Stapel 1', () => {
    const slots = EQUIPMENT_SLOTS.filter((s) => EQUIPMENT_SLOT_KIND[s] === 'schmuck');
    expect(slots).toEqual(['schmuck1', 'schmuck2']);
    for (const id of ['wolfszahnkette', 'haueramulett']) {
      const def = catalog.get(id);
      expect(def, id).toMatchObject({ kategorie: 'schmuck', ausruestung: 'schmuck', raritaet: 'ungewoehnlich', stapel: BALANCE.items.stack.schmuck, stufe: 0 });
      expect(itemCountCategories(def)).toEqual(['items', 'jewelry']);
    }
    expect(CONTENT.countsByCategory().jewelry).toBeGreaterThanOrEqual(2);
  });

  it('die Wirkung ist echt: die Kette senkt Schreck und Dunkelfurcht um 10 %, das Amulett gibt +5 maximales Leben', () => {
    const wear = (...ids: string[]) => aggregateEquipmentStats(ids.map((id) => ({ def: catalog.get(id), stack: newStack(catalog.get(id), 1) })));
    const kette = wear('wolfszahnkette');
    expect(kette.werte.furchtresistenz).toBeCloseTo(0.1, 12);
    // A sighting frightens by 10 points (§12.3): with the necklace by 9.
    expect(frightAmount(10, kette.werte.furchtresistenz)).toBeCloseTo(9, 12);
    const beide = wear('wolfszahnkette', 'haueramulett');
    expect(beide.werte.maxLeben).toBe(5);
    expect(beide.werte.furchtresistenz).toBeCloseTo(0.1, 12);
    // Jewellery leaves the armour to the sets (§D).
    expect(beide.werte.ruestung).toBe(0);
    expect(beide.ruestungsgewicht).toBeNull();
  });

  it('Texte DE/EN, Icons im Spielatlas, Tauschwerte über den Teilen', () => {
    const sprites: Readonly<Record<string, unknown>> = SPRITES;
    for (const def of TROPHAEEN) {
      expect(def.name.de.length * def.name.en.length, def.id).toBeGreaterThan(0);
      expect(def.beschreibung.de).not.toBe(def.beschreibung.en);
      expect(sprites[itemIconId(def.id)], def.id).toBeDefined();
    }
    const value = (id: string): number => catalog.get(id).tauschwert;
    expect(value('wolfszahnkette')).toBeGreaterThan(3 * value('wolfszahn') + value('sehnen'));
    expect(value('haueramulett')).toBeGreaterThan(2 * value('keilerhauer') + value('sehnen'));
  });
});
