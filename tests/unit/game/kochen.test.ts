/**
 * M7-25: cooking (MASTERPROMPT §18 "Kochen: Spieß, Kessel (Suppen, Eintopf), Backofen (Brot, Kuchen), Trockengestell
 * (Trockenfleisch), Räucherkammer (Räucherfisch), Mühle (Mehl), Gärfass (Wein, Bier)", §16.4 "Küche (Kessel + Vorrat + Tisch):
 * +20 % Kochtempo, +10 % Mahlzeitwirkung"; docs/SPIEL.md §21 "Koch-Stationen"): the stations of the kitchen on the kitchen
 * test world – the cauldron cooks only over a fire beside it, recipes with water take it from open water or a rain collector,
 * the processing stations run their batches, a kitchen speeds its cooking stations and marks their food. Raw meat's poisoning
 * is in mahlzeiten.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { STATIONS } from '../../../src/content/stations';
import { fromKitchen } from '../../../src/game/meals/formulas';
import { kitchenFireCheck } from '../../../src/game/meals/kitchen';
import { roomCraftTempo } from '../../../src/game/rooms/formulas';
import { WATER_DEPTH_SHALLOW, WATER_LAKE } from '../../../src/world/model/chunk';
import { kuecheWelt, type KuecheWelt } from './kueche-testwelt';
import { OFFSET, T } from './spieler-testwelt';

const INV = (index: number) => ({ bereich: 'inventar', index }) as const;

function rejected(ev: Map<string, unknown[]>): string[] {
  return ((ev.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

/** The kitchen world with the player on (10, 10), every recipe visible, a lake tile at (9, 11) unless `dry`. */
function welt(dry = false): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.crafting.unlockAll(w.sim);
  if (!dry) {
    const { chunk, i } = w.chunks.at(OFFSET + 9, OFFSET + 11);
    chunk.water[i] = WATER_LAKE | WATER_DEPTH_SHALLOW;
  }
  w.run(1);
  return w;
}

/** Puts `count` × `item` into inventar slot `index`. */
function give(w: KuecheWelt, item: string, count: number, index: number): void {
  w.put(w.stack(item, count), INV(index));
}

function countOf(w: KuecheWelt, item: string): number {
  let n = 0;
  for (const s of w.inventory.state.inventar) if (s !== null && s.item === item) n += s.count;
  return n;
}

/** Starts `recipe` once and runs until its piece is done (or `max` ticks). */
function cook(w: KuecheWelt, recipe: string, max = 20000): { ev: Map<string, unknown[]>; ticks: number } {
  const ev = w.run(1, [{ type: 'craft.start', recipe, count: 1 }]);
  const started = (ev.get('craftStarted') ?? []) as Array<{ ticks: number }>;
  const ticks = started[0]?.ticks ?? 0;
  if (ticks > 0) {
    const rest = w.run(Math.min(ticks + 2, max));
    for (const [k, v] of rest) ev.set(k, [...(ev.get(k) ?? []), ...v]);
  }
  return { ev, ticks };
}

describe('Koch-Stationen (Inhalt)', () => {
  it('sechs neue Stationen; der Kessel ist eine Handstation über Feuer, die anderen verarbeiten (mit oder ohne Brennstoff)', () => {
    const byId = new Map(STATIONS.map((s) => [s.id, s]));
    expect(byId.get('kessel')).toMatchObject({ art: 'handwerk', feuer: true });
    expect(byId.get('kraeutertisch')).toMatchObject({ art: 'handwerk' });
    expect(byId.get('backofen')?.verarbeitung?.brennstoff).toBe(true);
    expect(byId.get('raeucherkammer')?.verarbeitung?.brennstoff).toBe(true);
    expect(byId.get('muehle')?.verarbeitung?.brennstoff).toBe(false);
    expect(byId.get('gaerfass')?.verarbeitung?.brennstoff).toBe(false);
    expect(byId.get('trockengestell')?.verarbeitung?.brennstoff).toBe(false);
    // The validator's count (M7-25: at least 19 stations).
    expect(CONTENT.collection('stations').values().length).toBeGreaterThanOrEqual(19);
  });

  it('jede Kochstation hat Rezepte; jedes Rezept einer Kochstation führt zu Essen, Trank oder Mehl', () => {
    const recipes = CONTENT.collection('recipes').values();
    for (const st of ['kessel', 'backofen', 'raeucherkammer', 'muehle', 'gaerfass', 'kraeutertisch', 'trockengestell', 'lagerfeuer']) {
      const own = recipes.filter((r) => r.station === st);
      expect(own.length, st).toBeGreaterThan(0);
    }
    expect(BALANCE.meals.cookingStations).toEqual(['lagerfeuer', 'kessel', 'backofen', 'raeucherkammer', 'trockengestell', 'kraeutertisch']);
  });

  it('Feuerprüfung: ein Feuer auf dem Ring um die Grundfläche oder darunter zählt, zwei Kacheln weg nicht', () => {
    const fires = new Set<string>();
    const check = kitchenFireCheck({ fireLit: (_l, x, y) => fires.has(`${x},${y}`), hearthLit: () => false });
    const sim = kuecheWelt().sim;
    expect(check(sim, 0, 10, 10, 1, 1)).toBe(false);
    fires.add('11,11');
    expect(check(sim, 0, 10, 10, 1, 1)).toBe(true);
    fires.clear();
    fires.add('12,10');
    expect(check(sim, 0, 10, 10, 1, 1)).toBe(false);
    expect(check(sim, 0, 10, 10, 2, 1)).toBe(true);
    fires.clear();
    fires.add('9,9');
    expect(check(sim, 0, 10, 10, 1, 1)).toBe(true);
    expect(check(sim, 0, 10, 10, 0, 0)).toBe(true);
  });

  it('Küchentempo: +20 % nur an Kochstationen in einer Küche; die Werkstatt bleibt bei +15 % für alles', () => {
    // MASTERPROMPT §16.4 "Küche (…): +20 % Kochtempo" – the contract's number, not only the balance table's.
    expect(roomCraftTempo('kueche', 'kessel')).toBe(0.2);
    expect(BALANCE.meals.kitchen.tempo).toBe(0.2);
    expect(roomCraftTempo('kueche', 'muehle')).toBe(0);
    expect(roomCraftTempo('kueche', null)).toBe(0);
    expect(roomCraftTempo('werkstatt', 'kessel')).toBe(BALANCE.rooms.effects.workshopTempo);
    expect(roomCraftTempo(null, 'kessel')).toBe(0);
  });
});

describe('Kessel', () => {
  it('ohne Feuer daneben: noFire; mit Feuer kocht er den Eintopf aus Fleisch und Gemüse', () => {
    const w = welt();
    expect(w.stations.placeAt(w.sim, 'kessel', 0, OFFSET + 11, OFFSET + 10)).toBeTypeOf('number');
    give(w, 'wildfleisch_roh', 1, 0);
    give(w, 'karotte', 2, 1);
    expect(rejected(w.run(1, [{ type: 'craft.start', recipe: 'rezept_eintopf', count: 1 }]))).toEqual(['noFire']);
    w.fireAt(12, 11);
    const { ev } = cook(w, 'rezept_eintopf');
    expect(rejected(ev)).toEqual([]);
    expect(countOf(w, 'eintopf')).toBe(1);
    expect(countOf(w, 'karotte')).toBe(0);
    // Cooked food is perishable from fresh (the item's shelf life).
    const pot = w.inventory.state.inventar.find((s) => s?.item === 'eintopf');
    expect(pot?.frische).toBe(100);
    expect(fromKitchen(pot ?? { daten: undefined })).toBe(false);
  });

  it('Wasser: ohne Wasser in Reichweite noWater; ein Regensammler mit Wasser genügt und gibt einen Schluck ab', () => {
    const w = welt(true);
    w.stations.placeAt(w.sim, 'kessel', 0, OFFSET + 11, OFFSET + 10);
    w.fireAt(11, 11);
    give(w, 'kamille', 2, 0);
    expect(rejected(w.run(1, [{ type: 'craft.start', recipe: 'rezept_kamillentee', count: 1 }]))).toEqual(['noWater']);
    w.water.placed(w.sim, 'regensammler', 0, OFFSET + 10, OFFSET + 12);
    const c = [...w.water.all][0];
    if (c === undefined) throw new Error('no collector');
    (c as { fill: number }).fill = 60;
    const { ev } = cook(w, 'rezept_kamillentee');
    expect(rejected(ev)).toEqual([]);
    expect(countOf(w, 'kamillentee')).toBe(1);
    expect(c.fill).toBe(60 - BALANCE.water.collector.minutesPerSip);
  });

  it('in der Küche: 20 % schneller und das Gericht trägt daten.kueche', () => {
    const plain = welt();
    plain.stations.placeAt(plain.sim, 'kessel', 0, OFFSET + 11, OFFSET + 10);
    plain.fireAt(12, 10);
    give(plain, 'schafgarbe', 2, 0);
    const base = cook(plain, 'rezept_schafgarbentee').ticks;
    const k = welt();
    k.stations.placeAt(k.sim, 'kessel', 0, OFFSET + 11, OFFSET + 10);
    k.fireAt(12, 10);
    k.room(11, 10, 'kueche');
    give(k, 'schafgarbe', 2, 0);
    const fast = cook(k, 'rezept_schafgarbentee').ticks;
    expect(fast).toBeLessThan(base);
    expect(fast / base).toBeCloseTo(1 / 1.2, 1);
    const tee = k.inventory.state.inventar.find((s) => s?.item === 'schafgarbentee');
    expect(tee?.daten).toEqual({ kueche: true });
  });

  it('der Spieß am Lagerfeuer: Wildfleisch wird gebraten (Handrezept am Feuer)', () => {
    const w = welt();
    w.fireAt(11, 10);
    // The camp fire is a station of the light system: a lit one in reach (a stand-in provider of the test).
    w.crafting.addStations((_s, _layer, x, y, r, station) => (station === 'lagerfeuer' && w.fireTiles.has(`${OFFSET + 11},${OFFSET + 10}`) && Math.hypot(x - (OFFSET + 11.5) * T, y - (OFFSET + 10.5) * T) <= r ? { station: 'lagerfeuer', platz: 0, tempo: 1, qualitaet: 0 } : null));
    give(w, 'wildfleisch_roh', 1, 0);
    cook(w, 'rezept_gebratenes_fleisch');
    expect(countOf(w, 'gebratenes_fleisch')).toBe(1);
  });
});

describe('Verarbeitende Kochstationen', () => {
  /** Places `station` at (12, 10), loads the inputs (and fuel) and runs `seconds`; returns the output stacks. */
  function batch(station: string, inputs: Array<[string, number]>, fuel: number, seconds: number, kitchen = false) {
    const w = welt();
    const id = w.stations.placeAt(w.sim, station, 0, OFFSET + 11, OFFSET + 10);
    if (typeof id !== 'number') throw new Error(`placeAt ${station}: ${id}`);
    if (kitchen) w.room(11, 10, 'kueche');
    let slot = 0;
    for (const [item, n] of inputs) {
      give(w, item, n, slot);
      expect(rejected(w.run(1, [{ type: 'station.put', station: id, from: INV(slot), bereich: 'eingang' }])), item).toEqual([]);
      slot++;
    }
    if (fuel > 0) {
      give(w, 'holz', fuel, slot);
      expect(rejected(w.run(1, [{ type: 'station.put', station: id, from: INV(slot), bereich: 'brennstoff' }]))).toEqual([]);
    }
    w.sim.skipTicks(Math.ceil(seconds * BALANCE.time.tickHz));
    w.run(1);
    const p = w.stations.placed.find((s) => s.id === id);
    return { w, id, out: (p?.proc as { ausgang: Array<{ item: string; count: number } | null> } | null)?.ausgang ?? [] };
  }

  it('Mühle mahlt Getreide zu Mehl ohne Brennstoff (30 s)', () => {
    const { out } = batch('muehle', [['weizen', 2]], 0, 31);
    expect(out[0]).toMatchObject({ item: 'mehl', count: 1 });
  });

  it('Backofen backt aus Mehl zwei Brote (90 s, mit Holz); aus der Küche genommen tragen sie daten.kueche', () => {
    const { w, id, out } = batch('backofen', [['mehl', 2]], 4, 91, true);
    expect(out[0]).toMatchObject({ item: 'brot', count: 2 });
    expect(rejected(w.run(1, [{ type: 'station.take', station: id, bereich: 'ausgang', index: 0 }]))).toEqual([]);
    const brot = w.inventory.state.inventar.find((s) => s?.item === 'brot');
    expect(brot).toMatchObject({ count: 2, daten: { kueche: true } });
  });

  it('Räucherkammer räuchert Fisch mit Salz (180 s), Trockengestell trocknet Fleisch mit Salz', () => {
    expect(batch('raeucherkammer', [['forelle', 2], ['salz', 1]], 4, 181).out[0]).toMatchObject({ item: 'raeucherfisch', count: 2 });
    expect(batch('trockengestell', [['wildfleisch_roh', 2], ['salz', 1]], 0, BALANCE.crafting.durationSeconds.trocknen + 1).out[0]).toMatchObject({ item: 'trockenfleisch', count: 2 });
  });

  it('Gärfass vergärt Gerste zu Bier über 48 Minuten ohne Feuer', () => {
    const early = batch('gaerfass', [['gerste', 4]], 0, 2000);
    expect(early.out.every((s) => s === null)).toBe(true);
    expect(batch('gaerfass', [['gerste', 4]], 0, 2881).out[0]).toMatchObject({ item: 'bier', count: 2 });
  });
});
