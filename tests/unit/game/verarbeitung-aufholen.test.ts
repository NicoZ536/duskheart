/**
 * M4-04 Verarbeitungsstationen (MASTERPROMPT §15.1 "Verarbeitungsstationen … haben Eingang, Brennstoff und
 * Ausgang, laufen zeitbasiert und holen in entladenen Chunks per Zeitstempel auf", §15.4 "Brennwerte (Zweig 15 …
 * Magmit 600)"; docs/ARCHITEKTUR.md "Aufholen"):
 * - Brennwerte §15.4 als Daten; die Items tragen sie.
 * - Eingang, Brennstoff, Ausgang: Chargen laufen von selbst, Brennstoff glüht nur, während die Station arbeitet;
 *   ohne Brennstoff, ohne Zutaten oder mit vollem Ausgang steht sie (Ereignis + Grund); der Schmelzofen nimmt nur
 *   Holzkohle oder Heißeres; Holz im Köhlermeiler glimmt ein Viertel so schnell.
 * - Aufholen: ein Chunk 2 h entladen ⇒ identisches Ergebnis wie durchgehend tickend – in einem Schritt, in zwei
 *   Schritten und mit wechselndem Aktiv/Eingefroren; in der echten Simulation über Zeitsprung und Aufhol-Registry.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { acceptsFuel, advanceProcessing, batchTicks, fuelHeatTicks } from '../../../src/game/stations/formulas';
import { copyStationsState, type StationsState } from '../../../src/game/stations/state';
import type { StationSystem } from '../../../src/game/stations/system';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { catalog, eventsOf, stationWorld, TICK_HZ, type StationWorld } from './stationen-testwelt';

const S = BALANCE.stations;

describe('Brennwerte §15.4', () => {
  it('die Tabelle: Zweig 15 · Holzscheit 45 · Harzholz 60 · Torf 90 · Holzkohle 120 · Steinkohle 180 · Öl 240 · Magmit 600', () => {
    expect(S.burnSeconds).toEqual({ zweig: 15, holz: 45, harzholz: 60, torf: 90, holzkohle: 120, steinkohle: 180, oel: 240, magmit: 600 });
    for (const [id, seconds] of Object.entries(S.burnSeconds)) {
      const item = CONTENT.collection('items').find(id);
      if (item !== undefined) expect(item.brennwert, id).toBe(seconds);
    }
    expect(catalog.get('holzkohle').brennwert).toBe(120);
  });

  it('Glut je Brennstück: Brennwert durch die Brennrate der Station', () => {
    expect(fuelHeatTicks(45, 1, 60)).toBe(2700);
    expect(fuelHeatTicks(45, 0.25, 60)).toBe(10800);
    expect(fuelHeatTicks(120, 1, 60)).toBe(7200);
    expect(batchTicks(60, 1, 60)).toBe(3600);
    expect(batchTicks(60, 1.25, 60)).toBe(2880);
    const furnace = S.fuel.schmelzofen;
    expect(acceptsFuel(furnace, 45)).toBe(false);
    expect(acceptsFuel(furnace, 120)).toBe(true);
    expect(acceptsFuel(furnace, undefined)).toBe(false);
    expect(acceptsFuel(S.fuel.lehmofen, 15)).toBe(true);
  });
});

/** Slot of `item` in the bags. */
function put(w: StationWorld, station: number, item: string, bereich: 'eingang' | 'brennstoff', count?: number): string[] {
  return w.refused({ type: 'station.put', station, from: w.slotOf(item), bereich, ...(count === undefined ? {} : { count }) });
}

describe('Eingang, Brennstoff, Ausgang', () => {
  it('das Trockengestell trocknet ohne Brennstoff: 6 Fasern ⇒ ein Strohbündel nach 120 s', () => {
    const w = stationWorld();
    const rack = w.place('trockengestell', 6, 4);
    w.give('fasern', 13);
    expect(put(w, rack, 'fasern', 'eingang', 12)).toEqual([]);
    expect(w.has('fasern')).toBe(1);
    // No fuel slot on the drying rack.
    expect(put(w, rack, 'fasern', 'brennstoff')).toEqual(['noSlots']);
    const t = BALANCE.crafting.durationSeconds.trocknen * TICK_HZ;
    const ev = w.run(t);
    expect(eventsOf(ev, 'stationProduced')).toEqual([expect.objectContaining({ id: rack, station: 'trockengestell', recipe: 'rezept_strohbuendel', item: 'strohbuendel', count: 1 })]);
    expect(w.st(rack).proc?.ausgang[0]).toEqual({ item: 'strohbuendel', count: 1 });
    const done = w.run(t);
    expect(eventsOf(done, 'stationStopped')).toEqual([expect.objectContaining({ reason: 'eingang' })]);
    expect(w.st(rack).proc?.ausgang[0]).toEqual({ item: 'strohbuendel', count: 2 });
    expect(w.st(rack).proc?.laeuft).toBe(false);
    w.run(1, [{ type: 'station.takeAll', station: rack }]);
    expect(w.has('strohbuendel')).toBe(2);
  });

  it('der Lehmofen brennt nur mit Brennstoff; ohne steht er und behält den Fortschritt', () => {
    const w = stationWorld();
    const oven = w.place('lehmofen', 6, 4);
    w.give('ziegel_roh', 2);
    w.give('holz', 1);
    expect(put(w, oven, 'ziegel_roh', 'eingang')).toEqual([]);
    const cold = w.run(10);
    expect(eventsOf(cold, 'stationProduced')).toHaveLength(0);
    expect(w.st(oven).proc).toMatchObject({ rezept: 'rezept_ziegel', fortschritt: 0, halt: 'brennstoff', laeuft: false });
    expect(put(w, oven, 'holz', 'brennstoff')).toEqual([]);
    // One log: 45 s of heat, the batch takes 60 s.
    const burn = w.run(45 * TICK_HZ + 5);
    expect(eventsOf(burn, 'stationStopped')).toEqual([expect.objectContaining({ reason: 'brennstoff' })]);
    expect(w.st(oven).proc).toMatchObject({ fortschritt: 45 * TICK_HZ, glut: 0, brennstoff: null });
    w.give('holz', 1);
    put(w, oven, 'holz', 'brennstoff');
    const rest = w.run(15 * TICK_HZ + 1);
    expect(eventsOf(rest, 'stationProduced')).toEqual([expect.objectContaining({ item: 'ziegel', count: 2 })]);
    // The rest of the log keeps glowing for the next batch (fuel burns only while working).
    expect(w.st(oven).proc?.glut).toBe(30 * TICK_HZ);
    expect(w.st(oven).proc?.halt).toBe('eingang');
  });

  it('der Schmelzofen nimmt nur Holzkohle oder Heißeres und schmilzt Kupfer; Bronze aus Kupfer und Zinn', () => {
    const w = stationWorld();
    const furnace = w.place('schmelzofen', 6, 4);
    w.give('holz', 2);
    w.give('holzkohle', 2);
    w.give('kupfererz', 2);
    w.give('fasern', 2);
    expect(put(w, furnace, 'holz', 'brennstoff')).toEqual(['weakFuel']);
    expect(put(w, furnace, 'fasern', 'brennstoff')).toEqual(['notFuel']);
    expect(put(w, furnace, 'fasern', 'eingang')).toEqual(['wrongItem']);
    expect(put(w, furnace, 'holzkohle', 'brennstoff')).toEqual([]);
    expect(put(w, furnace, 'kupfererz', 'eingang')).toEqual([]);
    const ev = w.run(BALANCE.crafting.durationSeconds.schmelzen * TICK_HZ + 1);
    expect(eventsOf(ev, 'stationProduced')).toEqual([expect.objectContaining({ item: 'kupferbarren', count: 1 })]);
    // Bronze: three copper bars and one tin bar make four bronze bars.
    const v = stationWorld();
    const f2 = v.place('schmelzofen', 6, 4);
    v.give('kupferbarren', 3);
    v.give('zinnbarren', 1);
    v.give('holzkohle', 1);
    put(v, f2, 'kupferbarren', 'eingang');
    put(v, f2, 'zinnbarren', 'eingang');
    put(v, f2, 'holzkohle', 'brennstoff');
    v.run(BALANCE.crafting.durationSeconds.schmelzen * TICK_HZ + 1);
    expect(v.st(f2).proc?.ausgang[0]).toEqual({ item: 'bronzebarren', count: 4 });
  });

  it('der Köhlermeiler: ein Scheit glimmt drei Minuten und verkohlt eine Ladung Bauholz zu Holzkohle', () => {
    const w = stationWorld();
    const kiln = w.place('koehlermeiler', 6, 4);
    w.give('treibholz', 4);
    w.give('holz', 2);
    w.give('zweig', 1);
    expect(put(w, kiln, 'treibholz', 'eingang')).toEqual([]);
    // One input slot: logs do not join the driftwood (a kiln load is one kind of timber).
    expect(put(w, kiln, 'holz', 'eingang')).toEqual(['stationFull']);
    expect(put(w, kiln, 'zweig', 'brennstoff')).toEqual([]);
    // A twig (15 s) smoulders a minute at rate 0,25 – then the load waits.
    const a = w.run(60 * TICK_HZ + 1);
    expect(eventsOf(a, 'stationStopped')).toEqual([expect.objectContaining({ reason: 'brennstoff' })]);
    w.give('holz', 1);
    expect(put(w, kiln, 'holz', 'brennstoff', 1)).toEqual([]);
    const b = w.run(120 * TICK_HZ);
    expect(eventsOf(b, 'stationProduced')).toEqual([expect.objectContaining({ item: 'holzkohle', count: 3 })]);
    expect(w.st(kiln).proc?.eingang.every((s) => s === null)).toBe(true);
  });

  it('voller Ausgang hält die Station an; Herausnehmen lässt sie weiterlaufen', () => {
    const w = stationWorld();
    const saw = w.place('trockengestell', 6, 4);
    const proc = w.stations.station(saw)?.proc;
    if (proc === null || proc === undefined) throw new Error('no slots');
    // Both output slots full of something else: no room for straw.
    proc.ausgang[0] = { item: 'stein', count: 100 };
    proc.ausgang[1] = { item: 'stein', count: 100 };
    w.give('fasern', 6);
    put(w, saw, 'fasern', 'eingang');
    w.run(5);
    expect(w.st(saw).proc?.halt).toBe('ausgang');
    w.run(1, [{ type: 'station.take', station: saw, bereich: 'ausgang', index: 1 }]);
    w.run(2);
    expect(w.st(saw).proc?.rezept).toBe('rezept_strohbuendel');
  });

  it('Eingang herausnehmen verwirft die laufende Charge', () => {
    const w = stationWorld();
    const rack = w.place('trockengestell', 6, 4);
    w.give('fasern', 6);
    put(w, rack, 'fasern', 'eingang');
    w.run(100);
    expect(w.st(rack).proc?.fortschritt).toBe(101);
    w.run(1, [{ type: 'station.take', station: rack, bereich: 'eingang', index: 0, count: 1 }]);
    expect(w.st(rack).proc).toMatchObject({ rezept: null, fortschritt: 0 });
    expect(w.has('fasern')).toBe(1);
  });
});

/** Four stations with inputs and fuel for more than two hours: a clay oven, a furnace, a drying rack, a kiln. */
function camp(w: StationWorld): number[] {
  const oven = w.place('lehmofen', 6, 2);
  const furnace = w.place('schmelzofen', 6, 5);
  const rack = w.place('trockengestell', 2, 7);
  const kiln = w.place('koehlermeiler', 1, 1);
  w.give('ziegel_roh', 4);
  w.give('lehm', 6);
  w.give('holz', 10);
  w.give('kupfererz', 6);
  w.give('zinnerz', 2);
  w.give('holzkohle', 1);
  w.give('fasern', 18);
  w.give('treibholz', 8);
  for (const [station, item, bereich, count] of [
    [oven, 'ziegel_roh', 'eingang', 4],
    [oven, 'lehm', 'eingang', 6],
    [oven, 'holz', 'brennstoff', 2],
    [furnace, 'kupfererz', 'eingang', 6],
    [furnace, 'zinnerz', 'eingang', 2],
    [furnace, 'holzkohle', 'brennstoff', 1],
    [rack, 'fasern', 'eingang', 18],
    [kiln, 'treibholz', 'eingang', 8],
    [kiln, 'holz', 'brennstoff', 1],
  ] as const) {
    expect(put(w, station, item, bereich, count), `${item} → ${bereich}`).toEqual([]);
  }
  return [oven, furnace, rack, kiln];
}

/** Chunks of the stations of a world (all on the drawn map). */
function chunksOf(w: StationWorld): { layer: 0; cx: number; cy: number }[] {
  const keys = new Set(w.stations.placed.map((p) => `${p.tx >> CHUNK_SHIFT},${p.ty >> CHUNK_SHIFT}`));
  return [...keys].map((k) => {
    const [cx, cy] = k.split(',').map(Number) as [number, number];
    return { layer: 0, cx, cy };
  });
}

function stationsOf(w: StationWorld): StationsState {
  return copyStationsState(w.stations.save.serialize() as StationsState);
}

describe('Aufholen in entladenen Chunks: 2 h entladen = durchgehend tickend', () => {
  const TWO_HOURS = 2 * 3600;

  function run(mode: 'tickend' | 'eingefroren' | 'zweimal' | 'wechselnd'): StationWorld {
    const w = stationWorld();
    camp(w);
    const span = TWO_HOURS * (w.sim.clock.ticksPerGameHour / 3600);
    const from = w.sim.tick;
    if (mode === 'tickend') {
      w.run(span);
      return w;
    }
    w.active = false;
    let frozenAt = from;
    const catchUp = (): void => {
      for (const c of chunksOf(w)) w.stations.catchUp(c, frozenAt, w.sim.tick);
      frozenAt = w.sim.tick;
    };
    if (mode === 'eingefroren') {
      w.sim.skipTicks(span);
      catchUp();
      return w;
    }
    if (mode === 'zweimal') {
      w.sim.skipTicks(Math.floor(span / 3));
      catchUp();
      w.sim.skipTicks(span - Math.floor(span / 3));
      catchUp();
      return w;
    }
    // Active and frozen in turns: a chunk that comes back catches up first, then ticks.
    let left = span;
    let on = false;
    const piece = 977;
    while (left > 0) {
      const n = Math.min(piece, left);
      if (on) w.run(n);
      else w.sim.skipTicks(n);
      left -= n;
      on = !on;
      if (on) catchUp();
      w.active = on;
    }
    if (!on) catchUp();
    return w;
  }

  it('Lehmofen, Schmelzofen, Trockengestell und Köhlermeiler enden gleich – Restfortschritt eingeschlossen', () => {
    const ticking = run('tickend');
    const expected = stationsOf(ticking);
    // Something happened in the two hours: batches done, the oven out of fuel mid-batch.
    const [oven, furnace, rack, kiln] = expected.placed;
    expect(oven?.proc?.ausgang[0]).toEqual({ item: 'ziegel', count: 2 });
    expect(oven?.proc).toMatchObject({ halt: 'brennstoff', rezept: 'rezept_ziegel' });
    expect(furnace?.proc?.ausgang[0]).toEqual({ item: 'kupferbarren', count: 2 });
    expect(rack?.proc?.ausgang[0]).toEqual({ item: 'strohbuendel', count: 1 });
    expect(kiln?.proc?.fortschritt).toBeGreaterThan(0);
    for (const mode of ['eingefroren', 'zweimal', 'wechselnd'] as const) {
      const w = run(mode);
      expect(w.sim.tick, mode).toBe(ticking.sim.tick);
      expect(stationsOf(w), mode).toEqual(expected);
    }
  });

  it('der Aufholschritt allein: advanceProcessing über n Ticks = n Mal über einen Tick', () => {
    const a = stationWorld();
    const b = stationWorld();
    const [ovenA] = camp(a);
    const [ovenB] = camp(b);
    const pa = a.stations.station(ovenA as number)?.proc;
    const pb = b.stations.station(ovenB as number)?.proc;
    if (pa === null || pa === undefined || pb === null || pb === undefined) throw new Error('no slots');
    const ctx = a.stations.processingContext('lehmofen');
    for (let i = 0; i < 5000; i++) advanceProcessing(pa, ctx, 1);
    advanceProcessing(pb, ctx, 5000);
    expect(pb).toEqual(pa);
  });
});

describe('Aufholen in der echten Simulation', () => {
  /** A game simulation with the player, a clay oven with bricks and wood next to it; returns the systems. */
  function game(): { sim: Simulation; stations: StationSystem; oven: number } {
    const sim = createSimulation({ seed: 20260924, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    expect(sim.player).not.toBe(NULL_ENTITY);
    const player = sim.system('player') as PlayerSystem;
    const stations = sim.system('stations') as StationSystem;
    const inventory = sim.system('inventory') as InventorySystem;
    const at = { x: 0, y: 0 };
    player.position(sim, at);
    const ptx = Math.floor(at.x / TILE_PX);
    const pty = Math.floor(at.y / TILE_PX);
    let oven = 0;
    for (let r = 1; r <= 2 && oven === 0; r++) {
      for (const [dx, dy] of [[r, 0], [-r - 1, 0], [0, r], [0, -r - 1], [r, r], [-r - 1, -r - 1]] as const) {
        const id = stations.placeAt(sim, 'lehmofen', 0, ptx + dx, pty + dy);
        if (typeof id === 'number') {
          oven = id;
          break;
        }
      }
    }
    expect(oven).toBeGreaterThan(0);
    sim.step([
      { type: 'inventory.give', item: 'ziegel_roh', count: 6 },
      { type: 'inventory.give', item: 'holz', count: 3 },
    ]);
    const slot = (item: string): { bereich: 'inventar' | 'schnellleiste'; index: number } => {
      for (const bereich of ['schnellleiste', 'inventar'] as const) {
        const index = inventory.state[bereich].findIndex((s) => s?.item === item);
        if (index >= 0) return { bereich, index };
      }
      throw new Error(`no ${item}`);
    };
    sim.step([
      { type: 'station.put', station: oven, from: slot('ziegel_roh'), bereich: 'eingang' },
      { type: 'station.put', station: oven, from: slot('holz'), bereich: 'brennstoff' },
    ]);
    sim.events.drain(() => undefined);
    expect(stations.station(oven)?.proc?.eingang[0]).toEqual({ item: 'ziegel_roh', count: 6 });
    return { sim, stations, oven };
  }

  it('Zeitsprung um 2 h (Zone eingefroren, Aufhol-Registry) = 2 h durchgehend tickend', () => {
    const ticking = game();
    const jumped = game();
    jumped.sim.step([{ type: 'advanceTime', minutes: 120 }]);
    while (ticking.sim.tick < jumped.sim.tick) ticking.sim.step();
    expect(ticking.sim.tick).toBe(jumped.sim.tick);
    const a = ticking.stations.station(ticking.oven);
    const b = jumped.stations.station(jumped.oven);
    expect(b).toEqual(a);
    // In two hours (120 s real at the default day length) two batches are fired, the third one glows on.
    expect(a?.proc?.ausgang[0]).toEqual({ item: 'ziegel', count: 4 });
    expect(a?.proc?.rezept).toBe('rezept_ziegel');
  });
});
