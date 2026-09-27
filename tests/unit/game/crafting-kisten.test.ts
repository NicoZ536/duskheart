/**
 * M4-02 Crafting aus Inventar + Kisten (MASTERPROMPT §15.1 "Crafting nimmt aus Inventar und Kisten im Umkreis von
 * 8 Tiles (abschaltbar); Mengenwahl, Warteschlange (10), Abbrechen erstattet vollständig"):
 * - Zutaten kommen zuerst aus den Taschen, dann aus den Kisten im Umkreis von 8 Tiles (die nächste zuerst);
 *   Kisten weiter weg zählen nicht; `craft.useChests {on: false}` schaltet die Kisten ab (gespeichert).
 * - Mengenwahl bis 100 Stück je Auftrag, alle Zutaten beim Einreihen reserviert; höchstens 10 Aufträge.
 * - Abbrechen erstattet vollständig in die Taschen – auch, was aus Kisten kam; was nicht passt, fällt vor die Füße.
 * - `takeItems` (Reparatur) nimmt ebenso aus Taschen und Kisten.
 * - Die Abtastung der UI (≈ 10×/s) sucht die Kisten einmal für alle gefragten Items, nicht je Item (Review M4 #20).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { parseGameCommand } from '../../../src/game/commands';
import { createCraftingSample, WerkstattSampler } from '../../../src/game/samples/werkstatt';
import { TILE_PX } from '../../../src/world/model/coords';
import { catalog, eventsOf, rejections, stationWorld, type StationWorld } from './stationen-testwelt';

const C = BALANCE.crafting;

/** A world with a workbench next to the player (drawn tile (5, 4)) and two chests: 6 tiles and 11 tiles away. */
function world(): StationWorld & { readonly near: ReturnType<StationWorld['chest']>; readonly far: ReturnType<StationWorld['chest']> } {
  const w = stationWorld();
  w.place('werkbank', 5, 4);
  const near = w.chest(10, 4, { brett: 10, harz: 3 });
  const far = w.chest(15, 4, { brett: 50, faserseil: 20 });
  return { ...w, near, far };
}

describe('Abtastung für die UI (Review M4 #20)', () => {
  it('zählt Taschen und Kisten für alle gefragten Items mit einem Blick in die Kisten', () => {
    const w = world();
    let lookups = 0;
    w.crafting.addStores(() => {
      lookups++;
      return [];
    });
    w.give('brett', 2);
    w.run(1);
    const sampler = new WerkstattSampler(w.sim);
    const sample = createCraftingSample();
    sample.frageItems = ['brett', 'harz', 'faserseil', 'holz', 'stein'];
    lookups = 0;
    expect(sampler.sampleCrafting(sample)).toBe(true);
    expect(lookups).toBe(1);
    expect([...sample.imBeutel]).toEqual([
      ['brett', 2],
      ['harz', 0],
      ['faserseil', 0],
      ['holz', 0],
      ['stein', 0],
    ]);
    // The near chest (6 tiles) holds 10 planks and 3 resin; the far one (11 tiles) does not count.
    expect([...sample.verfuegbar]).toEqual([
      ['brett', 12],
      ['harz', 3],
      ['faserseil', 0],
      ['holz', 0],
      ['stein', 0],
    ]);
    for (const [item, n] of sample.verfuegbar) expect(n, item).toBe(w.crafting.available(w.sim, item));
  });
});

describe('Kisten im Umkreis von 8 Tiles', () => {
  it('der Umkreis ist 8 Tiles; nur Kisten darin zählen', () => {
    const w = world();
    const asked: number[] = [];
    w.crafting.addStores((_s, _layer, _x, _y, radiusPx) => {
      asked.push(radiusPx);
      return [];
    });
    w.give('faserseil', 1);
    w.run(1);
    expect(w.crafting.available(w.sim, 'brett')).toBe(10);
    expect(asked[0]).toBe(C.chestRadiusTiles * TILE_PX);
    expect(C.chestRadiusTiles).toBe(8);
    // 4 planks, 1 rope, 1 resin – the planks and the resin only in the near chest.
    expect(w.crafting.affordable(w.sim, 'rezept_holzeimer_werkbank')).toBe(1);
  });

  it('Taschen zuerst, dann die Kisten; die ferne Kiste bleibt unberührt', () => {
    const w = world();
    w.give('brett', 2);
    w.give('faserseil', 2);
    w.give('harz', 1);
    w.run(1);
    w.crafting.meetStation(w.sim, 'werkbank');
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_holzeimer_werkbank', count: 1 }]);
    expect(w.has('brett')).toBe(0);
    expect(w.near.left.brett).toBe(8);
    expect(w.far.left.brett).toBe(50);
    expect(w.has('faserseil')).toBe(1);
    expect(w.near.left.harz).toBe(3);
    const done = w.run(Math.ceil(C.durationSeconds.werkzeug * BALANCE.time.tickHz) + 2);
    expect(eventsOf(done, 'craftCompleted')).toHaveLength(1);
    expect(w.has('holzeimer')).toBe(1);
  });

  it('abschaltbar: ohne Kisten reichen die Zutaten nicht; der Schalter wird gespeichert', () => {
    const w = world();
    w.give('faserseil', 1);
    w.give('harz', 1);
    w.give('brett', 1);
    w.run(1);
    w.crafting.meetStation(w.sim, 'werkbank');
    w.run(1, [{ type: 'craft.useChests', on: false }]);
    expect(w.crafting.usesChests).toBe(false);
    expect(w.crafting.available(w.sim, 'brett')).toBe(1);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_holzeimer_werkbank', count: 1 }]))).toEqual(['notEnough']);
    expect((w.crafting.save.serialize() as { kisten: boolean }).kisten).toBe(false);
    w.run(1, [{ type: 'craft.useChests', on: true }]);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_holzeimer_werkbank', count: 1 }]))).toEqual([]);
  });
});

describe('Mengenwahl, Warteschlange, Abbrechen', () => {
  it('Mengenwahl: ein Auftrag reserviert die Zutaten aller Stücke; mehr als 100 lehnt der Befehl ab', () => {
    const w = world();
    w.give('fasern', 30);
    w.run(1);
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 7 }]);
    expect(w.has('fasern')).toBe(9);
    expect(w.crafting.orders[0]?.anzahl).toBe(7);
    expect(() => parseGameCommand({ type: 'craft.start', recipe: 'rezept_faserseil', count: C.maxOrderCount + 1 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'craft.start', recipe: 'rezept_faserseil', count: 0 })).toThrow(TypeError);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 4 }]))).toEqual(['notEnough']);
  });

  it('die Warteschlange fasst 10 Aufträge', () => {
    const w = world();
    w.give('fasern', 3 * (C.queueLength + 1));
    w.run(1);
    const one = { type: 'craft.start', recipe: 'rezept_faserseil', count: 1 } as const;
    expect(rejections(w.run(1, Array.from({ length: C.queueLength }, () => one)))).toEqual([]);
    expect(w.crafting.orders).toHaveLength(C.queueLength);
    expect(rejections(w.run(1, [one]))).toEqual(['queueFull']);
    expect(w.has('fasern')).toBe(3);
  });

  it('Abbrechen erstattet vollständig – auch Zutaten aus Kisten, in die Taschen', () => {
    const w = world();
    w.give('faserseil', 1);
    // Planks and resin were owned once (the recipe is known) – now they lie only in the chest.
    w.give('brett', 1);
    w.give('harz', 1);
    w.run(1);
    w.inventory.take(w.sim, 'brett', 1);
    w.inventory.take(w.sim, 'harz', 1);
    w.crafting.meetStation(w.sim, 'werkbank');
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_holzeimer_werkbank', count: 1 }]);
    expect(w.near.left.brett).toBe(6);
    expect(w.near.left.harz).toBe(2);
    const ev = w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect(eventsOf(ev, 'craftCancelled')).toEqual([expect.objectContaining({ recipe: 'rezept_holzeimer_werkbank', pieces: 1, reason: 'abgebrochen' })]);
    expect([w.has('brett'), w.has('harz'), w.has('faserseil')]).toEqual([4, 1, 1]);
    expect(w.crafting.orders).toEqual([]);
  });

  it('volle Taschen: die Erstattung fällt vor die Füße, nichts geht verloren', () => {
    const w = world();
    w.give('fasern', 6);
    w.run(1);
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 2 }]);
    // Fill every carried slot with stones.
    w.give('stein', 100 * 40);
    w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    const spilledFibres = w.spilled.filter((s) => s.stack.item === 'fasern').reduce((n, s) => n + s.stack.count, 0);
    expect(w.has('fasern') + spilledFibres).toBe(6);
    expect(spilledFibres).toBeGreaterThan(0);
  });

  it('takeItems nimmt Taschen zuerst, dann Kisten, und nichts, wenn es nicht reicht', () => {
    const w = world();
    w.give('brett', 3);
    w.run(1);
    expect(w.crafting.takeItems(w.sim, 'brett', 20)).toBeNull();
    expect(w.has('brett')).toBe(3);
    const taken = w.crafting.takeItems(w.sim, 'brett', 5);
    expect(taken?.reduce((n, s) => n + s.count, 0)).toBe(5);
    expect(w.has('brett')).toBe(0);
    expect(w.near.left.brett).toBe(8);
    expect(catalog.get('brett').stapel).toBe(100);
  });
});
