/**
 * M4-09 Reparatur (MASTERPROMPT §13.1 "Haltbarkeit für Werkzeuge, Waffen, Rüstung; Reparatur an Werkbank, Amboss
 * oder Schleifstein (anteilige Materialkosten). Kaputt = unbenutzbar, nie zerstört."):
 * - Kosten: je Zutat ohne Haltbarkeit Anzahl × abgenutzter Anteil × 0,5, gerundet; mindestens ein Stück der größten.
 * - Wo: die Werkbank I bessert Steinzeit-Stücke aus, Werkbank II und Bronzeamboss auch Bronze, der Schleifstein
 *   Werkzeuge und Waffen bis Bronze, keine Rüstung.
 * - Ausbessern bringt das Stück auf die volle Haltbarkeit seiner Qualität, auch ein kaputtes;
 *   Material aus Taschen und Kisten; ohne Station, Material, Schaden oder Haltbarkeit: abgelehnt; tot nichts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { contentRecipeBook } from '../../../src/game/crafting/recipes';
import { newStack } from '../../../src/game/items/stack';
import { repairCosts, repairRecipe, wornShare } from '../../../src/game/repair/formulas';
import { catalog, eventsOf, stationWorld, type StationWorld } from './stationen-testwelt';

const book = contentRecipeBook(catalog);
const durable = (item: string): boolean => catalog.get(item).haltbarkeit !== undefined;

/** Puts a worn piece of `item` (durability `left`, quality `q`) into the first free inventory slot. */
function worn(w: StationWorld, item: string, left: number, q = 1): void {
  w.inventory.giveStack(w.sim, { ...newStack(catalog.get(item), 1, q === 1 ? {} : { qualitaet: q }), haltbarkeit: left });
}

describe('anteilige Materialkosten', () => {
  it('Anzahl × abgenutzter Anteil × 0,5, gerundet; mindestens ein Stück der größten Zutat', () => {
    expect(BALANCE.crafting.repairMaterialShare).toBe(0.5);
    const axe = book.ingredients('rezept_steinaxt');
    expect(repairCosts(axe, durable, 0)).toEqual([]);
    // Broken (worn 1): half the recipe – 1 twig, 1 stone, 1 rope (0,5 rounds up).
    expect(repairCosts(axe, durable, 1).map((c) => [c.key, c.anzahl])).toEqual([
      ['zweig', 1],
      ['stein', 1],
      ['faserseil', 1],
    ]);
    // Barely worn: at least one piece of the largest ingredient.
    expect(repairCosts(axe, durable, 0.1).map((c) => [c.key, c.anzahl])).toEqual([['zweig', 1]]);
    const bronze = book.ingredients('rezept_bronzehammer');
    expect(repairCosts(bronze, durable, 1).map((c) => [c.key, c.anzahl])).toEqual([
      ['bronzebarren', 2],
      ['holz', 1],
    ]);
    expect(repairCosts(bronze, durable, 0.5).map((c) => [c.key, c.anzahl])).toEqual([
      ['bronzebarren', 1],
      ['holz', 1],
    ]);
  });

  it('der abgenutzte Anteil kennt die Qualität; der gefüllte Eimer kostet wie der Eimer', () => {
    const axe = catalog.get('bronzeaxt');
    expect(wornShare(axe, { item: 'bronzeaxt', count: 1, haltbarkeit: 150 })).toBe(0);
    expect(wornShare(axe, { item: 'bronzeaxt', count: 1, haltbarkeit: 90, qualitaet: 3 })).toBe(0.5);
    expect(wornShare(axe, { item: 'bronzeaxt', count: 1, haltbarkeit: 0 })).toBe(1);
    expect(repairRecipe(book, 'holzeimer_wasser')?.id).toBe('rezept_holzeimer');
    expect(repairRecipe(book, 'steinaxt')?.id).toBe('rezept_steinaxt');
    expect(repairRecipe(book, 'fackel')?.id).toBe('rezept_fackel');
  });
});

describe('Ausbessern an Werkbank, Amboss und Schleifstein', () => {
  it('ein kaputtes Steinwerkzeug an der Werkbank: volle Haltbarkeit, halbe Zutaten', () => {
    const w = stationWorld();
    w.place('werkbank', 5, 4);
    worn(w, 'steinaxt', 0);
    w.give('zweig', 3);
    w.give('stein', 3);
    w.give('faserseil', 1);
    const slot = w.slotOf('steinaxt');
    expect(w.repair.quote(w.sim, slot)).toEqual({ station: 'werkbank', costs: repairCosts(book.ingredients('rezept_steinaxt'), durable, 1) });
    const ev = w.run(1, [{ type: 'repair.item', slot }]);
    expect(eventsOf(ev, 'itemRepaired')).toEqual([expect.objectContaining({ item: 'steinaxt', haltbarkeit: 60, station: 'werkbank', materialien: { zweig: 1, stein: 1, faserseil: 1 } })]);
    expect(w.inventory.state[slot.bereich][slot.index]?.haltbarkeit).toBe(60);
    expect([w.has('zweig'), w.has('stein'), w.has('faserseil')]).toEqual([2, 2, 0]);
  });

  it('Bronze braucht Werkbank II, Amboss oder Schleifstein; der Schleifstein bessert keine Rüstung', () => {
    const w = stationWorld();
    w.place('werkbank', 5, 4);
    worn(w, 'bronzeaxt', 30, 3);
    w.give('bronzebarren', 4);
    w.give('holz', 2);
    const slot = w.slotOf('bronzeaxt');
    expect(w.refused({ type: 'repair.item', slot })).toEqual(['noStation']);
    w.place('schleifstein', 3, 6);
    expect(w.repair.quote(w.sim, slot)).toMatchObject({ station: 'schleifstein' });
    w.place('amboss_bronze', 5, 6);
    // The anvil and the grindstone both mend bronze tools: the first of the best stage mends.
    expect(w.refused({ type: 'repair.item', slot })).toEqual([]);
    const axe = w.inventory.state[slot.bereich][slot.index];
    expect(axe).toMatchObject({ item: 'bronzeaxt', haltbarkeit: 180, qualitaet: 3 });
    // A repaired piece is whole: nothing more to mend.
    expect(w.refused({ type: 'repair.item', slot })).toEqual(['notDamaged']);
  });

  it('Material aus Kisten in der Nähe; ohne genug Material, ohne Haltbarkeit oder leerer Platz: abgelehnt', () => {
    const w = stationWorld();
    w.place('werkbank', 5, 4);
    worn(w, 'steinspitzhacke', 10);
    const slot = w.slotOf('steinspitzhacke');
    expect(w.refused({ type: 'repair.item', slot })).toEqual(['notEnough']);
    const chest = w.chest(8, 4, { zweig: 5, stein: 5, faserseil: 5 });
    expect(w.refused({ type: 'repair.item', slot })).toEqual([]);
    expect(chest.left).toEqual({ zweig: 4, stein: 4, faserseil: 5 });
    w.give('fackel', 1);
    expect(w.refused({ type: 'repair.item', slot: w.slotOf('fackel') })).toEqual(['notRepairable']);
    expect(w.refused({ type: 'repair.item', slot: { bereich: 'inventar', index: 29 } })).toEqual(['slotEmpty']);
  });

  it('ein Stück in der Hand wird ebenso ausgebessert; tot nichts', () => {
    const w = stationWorld();
    w.place('werkbank', 5, 4);
    worn(w, 'steinspeer', 5);
    w.give('zweig', 2);
    w.give('feuerstein', 2);
    w.give('faserseil', 2);
    const slot = w.slotOf('steinspeer');
    expect(w.refused({ type: 'repair.item', slot })).toEqual([]);
    expect(w.inventory.state[slot.bereich][slot.index]?.haltbarkeit).toBe(60);
    worn(w, 'steinmesser', 1);
    w.vit().health = 0;
    expect(w.refused({ type: 'repair.item', slot: w.slotOf('steinmesser') })).toEqual(['dead']);
  });
});
