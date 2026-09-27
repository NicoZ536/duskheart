/**
 * M4-29 "Station läuft" and the loops of the base, read from the simulation's state (src/audio/loopSources.ts):
 * a processing station loops while it runs, the crafting queue at a hand station loops at the station, a camp fire
 * crackles once it is lit (also without an event – a loaded game), the hearth crackles while it burns, blazes roar –
 * only the nearest few of a preset, only within its range and on the listener's layer, at most `maxLoops` in all.
 * Rescans run every `LOOP_SCAN_SECONDS` and on the frame after a loop event. Footsteps on built floors
 * (src/audio/underfoot.ts) sound like the floor; fuel sounds by the kind of light it went into (src/audio/lightProbe.ts).
 */
import { describe, expect, it } from 'vitest';
import { FIRE_AUDIO, FLOOR_STEP, HEARTH_AUDIO } from '../../../src/audio/baseSounds';
import { createEventSfxContext, cuesFor, isLoopCue } from '../../../src/audio/eventMap';
import { CRAFT_LOOP, LOOP_SCAN_SECONDS, LOOP_SOURCE_EVENTS, LoopDirector, MAX_WORLD_LOOPS, blazeLoop, hearthLoop, lightLoop, stationLoop, type LoopSink } from '../../../src/audio/loopSources';
import { MAX_VOICES, type SfxCue } from '../../../src/audio/sfxPlayer';
import { LightProbe } from '../../../src/audio/lightProbe';
import { FloorProbe } from '../../../src/audio/underfoot';
import { BUILD_MATERIALS } from '../../../src/content/balance/building';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { SIM_EVENT_TYPES, type SimEventMap } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';
import { lagerWelt, type LagerWelt } from '../game/lager-testwelt';
import { lightWorld } from '../game/licht-testwelt';
import { stationWorld, TICK_HZ } from '../game/stationen-testwelt';
import { OFFSET, meadow } from '../game/spieler-testwelt';

/** Records the loop slots like the SFX player keeps them. */
class Sink implements LoopSink {
  readonly listener = { x: 0, y: 0, layer: 0 };
  readonly slots = new Map<string, SfxCue>();
  calls = 0;
  setLoop(slot: string, cue: SfxCue | null): void {
    this.calls++;
    if (cue === null) this.slots.delete(slot);
    else this.slots.set(slot, cue);
  }
  at(p: { x: number; y: number }, layer = 0): this {
    this.listener.x = p.x;
    this.listener.y = p.y;
    this.listener.layer = layer;
    return this;
  }
  ids(): Record<string, string> {
    return Object.fromEntries([...this.slots].map(([k, v]) => [k, v.id]));
  }
}

/** A director that scans on every call (time moves on by a scan period each time). */
function scanner(max?: number): { director: LoopDirector; scan: (sim: Parameters<LoopDirector['update']>[0], sink: Sink) => void } {
  const director = new LoopDirector(SFX_PRESETS, max);
  let now = 0;
  return {
    director,
    scan: (sim, sink) => {
      now += LOOP_SCAN_SECONDS;
      director.update(sim, sink, now);
    },
  };
}

describe('Schleifen aus dem Zustand der Simulation', () => {
  it('jedes Schleifen-Ereignis ist ein Sim-Ereignis; höchstens ein Drittel der Stimmen sind Welt-Schleifen', () => {
    for (const type of LOOP_SOURCE_EVENTS) expect(SIM_EVENT_TYPES as readonly string[]).toContain(type);
    expect(MAX_WORLD_LOOPS).toBeLessThanOrEqual(MAX_VOICES / 2);
  });

  it('Verarbeitungsstation: der Lehmofen röhrt an seiner Mitte, solange er brennt; abgebaut verstummt er', () => {
    const w = stationWorld();
    const oven = w.place('lehmofen', 6, 4);
    w.give('lehm', 6);
    w.give('holz', 4);
    w.run(1, [{ type: 'station.put', station: oven, from: w.slotOf('lehm'), bereich: 'eingang' }]);
    const sink = new Sink().at(w.pos());
    const { scan } = scanner();
    scan(w.sim, sink);
    // Input without fuel: the kiln stands cold.
    expect(sink.slots.has(stationLoop(oven))).toBe(false);
    w.run(2, [{ type: 'station.put', station: oven, from: w.slotOf('holz'), bereich: 'brennstoff' }]);
    expect(w.st(oven).proc?.laeuft).toBe(true);
    scan(w.sim, sink);
    // 2 × 2 footprint anchored on (6, 4): its centre is the corner of the four tiles.
    expect(sink.slots.get(stationLoop(oven))).toEqual({ id: 'sfx_station_ofen', x: (OFFSET + 7) * TILE_PX, y: (OFFSET + 5) * TILE_PX, layer: 0 });
    w.run(1, [{ type: 'station.remove', station: oven }]);
    scan(w.sim, sink);
    expect(sink.slots.size).toBe(0);
  });

  it('Handwerk an der Säge: die Säge klingt am Sägebock, solange die Warteschlange arbeitet', () => {
    const w = stationWorld();
    const saw = w.place('saegebock', 5, 4);
    w.crafting.unlockAll(w.sim);
    w.give('holz', 2);
    const sink = new Sink().at(w.pos());
    const { scan } = scanner();
    w.run(2, [{ type: 'craft.start', recipe: 'rezept_brett', count: 2 }]);
    scan(w.sim, sink);
    const size = w.stations.footprintOf(w.st(saw));
    expect(sink.slots.get(CRAFT_LOOP)).toEqual({ id: 'sfx_station_saege', x: (OFFSET + 5 + size.b / 2) * TILE_PX, y: (OFFSET + 4 + size.t / 2) * TILE_PX, layer: 0 });
    // Between the two pieces the queue keeps working: the loop stays.
    const piece = w.crafting.orders[0]?.dauer ?? 0;
    expect(piece).toBeGreaterThan(0);
    w.run(piece - 1);
    scan(w.sim, sink);
    expect(sink.ids()).toEqual({ [CRAFT_LOOP]: 'sfx_station_saege' });
    w.run(piece + 2 * TICK_HZ);
    expect(w.crafting.orders).toHaveLength(0);
    expect(w.has('brett')).toBe(4);
    scan(w.sim, sink);
    expect(sink.slots.size).toBe(0);
  });

  it('Lagerfeuer: kalt still, entzündet knistert es – auch für einen neuen Hörer ohne ein einziges Ereignis (Spielstand geladen)', () => {
    const w = lightWorld(meadow(24, 24));
    w.spawn(10, 10);
    w.give('lagerfeuer', 1);
    w.give('holz', 10);
    const fire = w.place('lagerfeuer', 11, 10);
    const sink = new Sink().at(w.pos());
    const { scan } = scanner();
    scan(w.sim, sink);
    expect(sink.slots.size).toBe(0);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    scan(w.sim, sink);
    expect(sink.slots.get(lightLoop(fire))).toEqual({ id: 'sfx_feuer_knistern', x: (OFFSET + 11.5) * TILE_PX, y: (OFFSET + 10.5) * TILE_PX, layer: 0 });
    // A fresh audio kernel (after loading, or the first input) hears the burning fire at once.
    const fresh = new Sink().at(w.pos());
    scanner().scan(w.sim, fresh);
    expect(fresh.ids()).toEqual({ [lightLoop(fire)]: 'sfx_feuer_knistern' });
    // Far away (beyond the crackle's range) and on another layer: no voice.
    const range = (SFX_PRESETS.find((p) => p.id === 'sfx_feuer_knistern')?.reichweite ?? 0) * TILE_PX;
    const away = new Sink().at({ x: w.pos().x + range + 2 * TILE_PX, y: w.pos().y });
    scanner().scan(w.sim, away);
    expect(away.slots.size).toBe(0);
    const below = new Sink().at(w.pos(), -1);
    scanner().scan(w.sim, below);
    expect(below.slots.size).toBe(0);
    // Doused: silent again.
    w.step(1, [{ type: 'light.douse', light: fire }]);
    scan(w.sim, sink);
    expect(sink.slots.size).toBe(0);
  });

  describe('Basis', () => {
    function base(): LagerWelt {
      return lagerWelt(meadow(40, 20), { x: 10, y: 10 });
    }

    it('Herdfeuer: knistert, solange es brennt', () => {
      const w = base();
      expect(w.build('herdfeuer', 12, 9)).toBeNull();
      const id = w.hearth.hearths[0]?.id ?? 0;
      w.give('holz', 4);
      w.act({ type: 'hearth.fuel', hearth: id, from: w.slotOf('holz'), count: 4 });
      const sink = new Sink().at(w.pos());
      const { scan } = scanner();
      scan(w.sim, sink);
      expect(sink.slots.size).toBe(0);
      w.act({ type: 'hearth.ignite', hearth: id });
      scan(w.sim, sink);
      expect(sink.slots.get(hearthLoop(id))).toEqual({ id: HEARTH_AUDIO.burning, x: (OFFSET + 13.5) * TILE_PX, y: (OFFSET + 10.5) * TILE_PX, layer: 0 });
      w.act({ type: 'hearth.douse', hearth: id });
      scan(w.sim, sink);
      expect(sink.slots.size).toBe(0);
    });

    it('Brand: die vier nächsten brennenden Kacheln lodern, der Rest schweigt; nähert man sich anderen, wandern die Stimmen', () => {
      const w = base();
      for (let x = 7; x < 17; x++) expect(w.build('wand_holz', x, 6), `${x}`).toBeNull();
      for (let x = 7; x < 17; x++) w.act({ type: 'fire.ignite', tx: OFFSET + x, ty: OFFSET + 6 });
      expect(w.feuer.size).toBe(10);
      const voices = SFX_PRESETS.find((p) => p.id === FIRE_AUDIO.burning)?.stimmen ?? 0;
      expect(voices).toBe(4);
      const sink = new Sink().at(w.centre(5, 6));
      const { scan } = scanner();
      scan(w.sim, sink);
      expect(Object.keys(sink.ids()).sort()).toEqual([7, 8, 9, 10].map((x) => blazeLoop(0, OFFSET + x, OFFSET + 6)).sort());
      for (const cue of sink.slots.values()) expect(cue.id).toBe(FIRE_AUDIO.burning);
      // Walking along the burning wall: the voices follow to the nearest tiles.
      sink.at(w.centre(18, 6));
      scan(w.sim, sink);
      expect(Object.keys(sink.ids()).sort()).toEqual([13, 14, 15, 16].map((x) => blazeLoop(0, OFFSET + x, OFFSET + 6)).sort());
    });

    it(`höchstens maxLoops Welt-Schleifen zusammen (Voreinstellung ${MAX_WORLD_LOOPS}), die nächsten zuerst`, () => {
      const w = base();
      for (let x = 12; x < 16; x++) w.build('wand_holz', x, 6);
      for (let x = 12; x < 16; x++) w.act({ type: 'fire.ignite', tx: OFFSET + x, ty: OFFSET + 6 });
      expect(w.build('herdfeuer', 5, 12)).toBeNull();
      const id = w.hearth.hearths[0]?.id ?? 0;
      w.give('holz', 2);
      w.act({ type: 'hearth.fuel', hearth: id, from: w.slotOf('holz'), count: 2 });
      w.act({ type: 'hearth.ignite', hearth: id });
      const sink = new Sink().at(w.centre(6, 12));
      scanner(3).scan(w.sim, sink);
      expect(sink.slots.size).toBe(3);
      // The hearth right beside the listener is among them.
      expect(sink.slots.has(hearthLoop(id))).toBe(true);
      const all = new Sink().at(w.centre(6, 12));
      scanner().scan(w.sim, all);
      expect(all.slots.size).toBe(5);
    });
  });

  it('scannt im Takt und nach einem Schleifen-Ereignis sofort; bewegt bestehende Schleifen nur', () => {
    const w = stationWorld();
    const oven = w.place('lehmofen', 6, 4);
    w.give('lehm', 6);
    w.give('holz', 4);
    w.run(1, [{ type: 'station.put', station: oven, from: w.slotOf('lehm'), bereich: 'eingang' }]);
    w.run(2, [{ type: 'station.put', station: oven, from: w.slotOf('holz'), bereich: 'brennstoff' }]);
    const sink = new Sink().at(w.pos());
    const director = new LoopDirector(SFX_PRESETS);
    director.update(w.sim, sink, 0);
    expect(director.loops).toEqual(new Map([[stationLoop(oven), 'sfx_station_ofen']]));
    const calls = sink.calls;
    // Within the scan period nothing is read …
    w.run(1, [{ type: 'station.remove', station: oven }]);
    director.update(w.sim, sink, LOOP_SCAN_SECONDS / 2);
    expect(sink.calls).toBe(calls);
    // … unless an event of `LOOP_SOURCE_EVENTS` (stationRemoved) said something may have stopped.
    director.invalidate();
    director.update(w.sim, sink, LOOP_SCAN_SECONDS / 2);
    expect(sink.slots.size).toBe(0);
    expect(director.loops.size).toBe(0);
  });
});

describe('Schritte auf gebauten Böden (underfoot.ts)', () => {
  it('Dielen knarren wie Holz, Steinplatten wie Stein, Stampflehm wie Erde; eine Blaupause ist noch kein Boden', () => {
    const w = lagerWelt(meadow(20, 12), { x: 4, y: 4 });
    expect(w.build('boden_holz', 6, 4)).toBeNull();
    expect(w.build('boden_stein', 7, 4)).toBeNull();
    expect(w.build('boden_lehm', 8, 4)).toBeNull();
    w.act({ type: 'build.blueprint', part: 'boden_holz', tx: OFFSET + 9, ty: OFFSET + 4 });
    expect(w.building.partAt(0, 'boden', OFFSET + 9, OFFSET + 4)?.id).toBe('boden_holz');
    const probe = new FloorProbe();
    const step = (x: number): string | null => {
      const c = w.centre(x, 4);
      return probe.stepAt(w.sim, 0, c.x, c.y);
    };
    expect([step(6), step(7), step(8), step(9), step(10)]).toEqual(['sfx_schritt_holz', 'sfx_schritt_stein', 'sfx_schritt_erde', null, null]);
    // Another layer has no floor there.
    const c = w.centre(6, 4);
    expect(probe.stepAt(w.sim, -1, c.x, c.y)).toBeNull();
    // Every §16.2 material has its footstep.
    for (const m of BUILD_MATERIALS) expect(SFX_PRESETS.some((p) => p.id === FLOOR_STEP[m]), m).toBe(true);
  });

  it('der Schritt nimmt den Boden vor dem Gelände; wer schwimmt, schwimmt', () => {
    const onPlanks = createEventSfxContext({ underfoot: () => 'sfx_schritt_holz' });
    const step = (water: 'none' | 'shallow' | 'deep'): string[] =>
      cuesFor('playerStep', { entity: 1, terrain: 'gras', water, noise: 1, tick: 0 }, onPlanks).map((c) => (isLoopCue(c) ? '' : c.id));
    expect(step('none')).toEqual(['sfx_schritt_holz']);
    // The jetty over the shallows: planks, not wading.
    expect(step('shallow')).toEqual(['sfx_schritt_holz']);
    expect(step('deep')).toEqual(['sfx_wasser_schwimmzug']);
    expect(cuesFor('playerStep', { entity: 1, terrain: 'gras', water: 'none', noise: 1, tick: 0 }, createEventSfxContext()).map((c) => (isLoopCue(c) ? '' : c.id))).toEqual(['sfx_schritt_gras']);
  });
});

describe('Brennstoff je Licht (lightProbe.ts)', () => {
  it('Holz auf das Lagerfeuer klingt nach Nachlegen, Harz in die Harzlampe nach Harz – gelesen am platzierten Licht', () => {
    const w = lightWorld(meadow(24, 24));
    w.spawn(10, 10);
    w.give('lagerfeuer', 1);
    w.give('holz', 10);
    w.give('harz', 4);
    const fire = w.place('lagerfeuer', 11, 10);
    const lamp = w.light.placeFurniture(w.sim, 'harzlampe', 0, OFFSET + 10, OFFSET + 11);
    expect(lamp).not.toBeNull();
    const probe = new LightProbe();
    expect(probe.kindOf(w.sim, fire)).toBe('lagerfeuer');
    expect(probe.kindOf(w.sim, lamp ?? 0)).toBe('harzlampe');
    expect(probe.kindOf(w.sim, 9999)).toBeNull();
    const lookups = createEventSfxContext({ placedLightKind: (id) => probe.kindOf(w.sim, id) });
    const fuelSound = (light: number, item: string): string[] => {
      w.step(1, [{ type: 'light.fuel', light, from: w.slotOf(item) }]);
      const events = (w.last.get('fireFueled') ?? []) as SimEventMap['fireFueled'][];
      expect(events).toHaveLength(1);
      return events.flatMap((e) => cuesFor('fireFueled', e, lookups).map((c) => (isLoopCue(c) ? '' : c.id)));
    };
    expect(fuelSound(fire, 'holz')).toEqual(['sfx_feuer_nachlegen']);
    expect(fuelSound(lamp ?? 0, 'harz')).toEqual(['sfx_item_holz']);
  });
});
