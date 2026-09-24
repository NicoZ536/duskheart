/**
 * M2-22 acceptance: active zone and the mandatory catch-up registry (docs/ARCHITEKTUR.md "Aktive
 * Zone", docs/WORLD.md §5). An example chunk-bound system (plant growth, daily) registers its
 * catch-up handler; "ticked through while active" equals "frozen and caught up"; a time-dependent
 * system without a handler makes the registry check fail.
 */
import { describe, expect, it } from 'vitest';
import { ticksPerDayFor } from '../../../src/engine/time';
import { Simulation, type SimSystem } from '../../../src/game/sim';
import { ChunkData, chunkHash } from '../../../src/world/model/chunk';
import { packChunkId, type Layer } from '../../../src/world/model/coords';
import { ActiveZone, WORLD_CHUNKS_PARTICIPANT_ID } from '../../../src/world/stream/activeZone';
import { CatchUpCoverageError, CatchUpRegistry, isTimeDependent } from '../../../src/world/stream/catchUp';
import type { ChunkManager } from '../../../src/world/stream/chunkManager';
import { fixtureManager, settle, type FixturePlan } from './streamFixture';

const DAY_MINUTES = 12;
const TICKS_PER_DAY = ticksPerDayFor(DAY_MINUTES, 60);
/** Highest growth stage of the example plants. */
const MAX_GROWTH = 5;

/** Example chunk-bound system: plants in active chunks grow one stage per 06:00 (dailyTick). */
class GrowthSystem implements SimSystem {
  readonly id = 'growth';
  constructor(private readonly activeChunks: () => readonly ChunkData[]) {}

  dailyTick(): void {
    for (const chunk of this.activeChunks()) for (const s of chunk.objectState.values()) s.growth = Math.min(MAX_GROWTH, s.growth + 1);
  }

  /** Analytic catch-up: count the 06:00 borders crossed by the steps fromTick … toTick − 1. */
  catchUp(chunk: ChunkData, fromTick: number, toTick: number): void {
    const dawns = Math.floor(toTick / TICKS_PER_DAY) - Math.floor(fromTick / TICKS_PER_DAY);
    for (const s of chunk.objectState.values()) s.growth = Math.min(MAX_GROWTH, s.growth + dawns);
  }
}

interface Position {
  layer: Layer;
  cx: number;
  cy: number;
}

/** Simulation + chunk manager + zone, the zone driven by a scripted player position. */
class Harness {
  readonly sim: Simulation;
  readonly manager: ChunkManager<FixturePlan>;
  readonly zone: ActiveZone;
  readonly player: Position = { layer: 0, cx: 10, cy: 10 };

  constructor(extra: readonly SimSystem[] = []) {
    this.sim = new Simulation({ seed: 1, worldSize: 'small', dayLengthMinutes: DAY_MINUTES });
    this.manager = fixtureManager().manager;
    // The zone moves first in every tick (global: it is what decides which chunks tick).
    this.sim.addSystem({ id: 'active-zone', timeScope: 'global', update: () => this.zone.update(this.player.layer, this.player.cx, this.player.cy) });
    this.sim.addSystem(new GrowthSystem(() => this.zone.chunks));
    for (const s of extra) this.sim.addSystem(s);
    this.zone = new ActiveZone({ chunks: this.manager, catchUp: CatchUpRegistry.fromSystems(this.sim.systems), tick: () => this.sim.clock.tick });
  }

  /** Steps until `toTick`; `path(tick)` may move the player before each step. */
  run(toTick: number, path?: (tick: number, player: Position) => void): void {
    while (this.sim.tick < toTick) {
      path?.(this.sim.tick, this.player);
      this.sim.step();
    }
  }

  /** Plants saplings (growth 0) in the 3 × 3 chunks around (10, 10). */
  plant(): void {
    for (let cy = 9; cy <= 11; cy++) for (let cx = 9; cx <= 11; cx++) for (const i of [5, 300, 777]) this.manager.ensure(0, cx, cy).setObjectState(i, 3, 0);
  }

  hashes(): string[] {
    const out: string[] = [];
    for (let cy = 8; cy <= 12; cy++) for (let cx = 8; cx <= 12; cx++) out.push(chunkHash(this.manager.ensure(0, cx, cy)));
    return out;
  }
}

const END = Math.floor(TICKS_PER_DAY * 3.5);

/** Runs a scenario: plant after the first tick, follow `path`, end with the player at (10, 10). */
function scenario(path?: (tick: number, p: Position) => void): Harness {
  const h = new Harness();
  h.run(1);
  h.plant();
  h.run(END - 1, path);
  h.run(END, (_t, p) => Object.assign(p, { layer: 0, cx: 10, cy: 10 }));
  return h;
}

describe('catch-up registry (mandatory)', () => {
  it('a time-dependent system without catch-up handler fails the check', () => {
    const sim = new Simulation({ seed: 1 });
    sim.addSystem({ id: 'active-zone', timeScope: 'global', update: () => undefined });
    sim.addSystem(new GrowthSystem(() => []));
    // Burns torches down in chunks, but forgot to say what happens to torches in frozen chunks.
    sim.addSystem({ id: 'fackeln', worldTick: () => undefined });
    let error: unknown;
    try {
      CatchUpRegistry.fromSystems(sim.systems);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CatchUpCoverageError);
    expect((error as CatchUpCoverageError).missing).toEqual(['fackeln']);
    expect((error as CatchUpCoverageError).message).toContain('fackeln');
    // The harness cannot even build its zone with such a system.
    expect(() => new Harness([{ id: 'fackeln', worldTick: () => undefined }])).toThrow(CatchUpCoverageError);
  });

  it('accepts handlers and global declarations, runs handlers in system order', () => {
    const calls: string[] = [];
    const systems = [
      { id: 'a', update: () => undefined },
      { id: 'b', dailyTick: () => undefined },
      { id: 'c', worldTick: () => undefined },
      { id: 'd' },
    ];
    expect(systems.map(isTimeDependent)).toEqual([true, true, true, false]);
    const registry = new CatchUpRegistry()
      .register('c', (_chunk, from, to) => calls.push(`c ${from}→${to}`))
      .declareGlobal('b', 'weather runs for the whole world')
      .register('a', (_chunk, from, to) => calls.push(`a ${from}→${to}`))
      .seal(systems);
    expect(registry.chunkSystemIds()).toEqual(['a', 'c']);
    expect([...registry.globalSystems().keys()]).toEqual(['b']);
    const chunk = new ChunkData(0, 0, 0);
    registry.run(chunk, 10, 20);
    registry.run(chunk, 20, 20);
    expect(calls).toEqual(['a 10→20', 'c 10→20']);
    expect(() => registry.run(chunk, 20, 10)).toThrow(RangeError);
    expect(() => registry.run(chunk, -1, 10)).toThrow(RangeError);
    expect(() => registry.register('d', () => undefined)).toThrow(/sealed/);
  });

  it('rejects stale, duplicate and contradictory declarations', () => {
    const systems = [{ id: 'a', update: () => undefined }];
    const stale = new CatchUpRegistry().register('a', () => undefined).register('ghost', () => undefined);
    expect(() => stale.seal(systems)).toThrow(CatchUpCoverageError);
    expect(() => new CatchUpRegistry().register('a', () => undefined).declareGlobal('a', 'x')).toThrow(/already declared/);
    expect(() => new CatchUpRegistry().declareGlobal('a', ' ')).toThrow(/reason/);
    expect(() => CatchUpRegistry.fromSystems([{ id: 'x', update: () => undefined, timeScope: 'global', catchUp: () => undefined }])).toThrow(/one or the other/);
    expect(() => CatchUpRegistry.fromSystems([{ id: 'x', update: () => undefined, timeScope: 'chunky' }])).toThrow(/unknown timeScope/);
    const unsealed = new CatchUpRegistry();
    expect(() => unsealed.run(new ChunkData(0, 0, 0), 0, 1)).toThrow(/sealed/);
    expect(() => new ActiveZone({ chunks: fixtureManager().manager, catchUp: unsealed, tick: () => 0 })).toThrow(/sealed/);
  });

  it('the example handler is decomposable: a → c equals a → b → c', () => {
    const g = new GrowthSystem(() => []);
    const base = new ChunkData(0, 1, 1);
    for (const i of [1, 2, 3]) base.setObjectState(i, 3, i === 3 ? 4 : 0);
    for (const [a, b, c] of [
      [0, 100, TICKS_PER_DAY * 2 + 5],
      [TICKS_PER_DAY - 1, TICKS_PER_DAY, TICKS_PER_DAY + 1],
      [7, TICKS_PER_DAY * 3, TICKS_PER_DAY * 9],
    ] as const) {
      const once = base.clone();
      g.catchUp(once, a, c);
      const twice = base.clone();
      g.catchUp(twice, a, b);
      g.catchUp(twice, b, c);
      expect(chunkHash(twice)).toBe(chunkHash(once));
    }
  });
});

describe('active zone', () => {
  it('activates the radius, keeps the hysteresis ring, freezes beyond it', () => {
    const h = new Harness();
    h.run(1);
    expect(h.zone.size).toBe(25);
    expect(h.zone.isActive(0, 12, 12)).toBe(true);
    expect(h.zone.isActive(0, 13, 10)).toBe(false);
    expect(h.zone.isTileActive(0, 12 * 32 + 31, 8 * 32)).toBe(true);
    const ids = h.zone.chunks.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    h.run(100, (_t, p) => (p.cx = 11));
    expect(h.zone.size).toBe(30); // column 8 is at distance 3 = radius + hysteresis
    h.run(200, (_t, p) => (p.cx = 12));
    expect(h.zone.size).toBe(30); // column 8 frozen, column 9 kept
    expect(h.zone.isActive(0, 8, 10)).toBe(false);
    expect(h.manager.get(0, 8, 10)?.frozenAtTick).toBe(100);
  });

  it('switching layer freezes the whole old layer at that tick', () => {
    const h = new Harness();
    h.run(50);
    h.run(60, (_t, p) => (p.layer = -1));
    expect(h.zone.layer).toBe(-1);
    expect(h.zone.chunks.every((c) => c.layer === -1)).toBe(true);
    expect(h.zone.isActive(0, 10, 10)).toBe(false);
    expect(h.manager.get(0, 10, 10)?.frozenAtTick).toBe(50);
  });

  it('active chunks stay resident while the camera streams elsewhere', () => {
    const h = new Harness();
    h.run(1);
    settle(h.manager, 0, 28, 28);
    expect(h.manager.get(0, 10, 10)).toBeDefined();
    h.run(10, (_t, p) => Object.assign(p, { cx: 28, cy: 28 }));
    h.manager.update(0, 28, 28);
    expect(h.manager.get(0, 10, 10)).toBeUndefined();
    expect(h.zone.isActive(0, 28, 28)).toBe(true);
  });

  it('chunks prefetched by streaming activate without synchronous loads', () => {
    const h = new Harness();
    settle(h.manager, 0, 10, 10);
    h.run(1);
    h.run(3, (_t, p) => (p.cx = 11));
    expect(h.zone.size).toBe(30);
    expect(h.manager.syncLoads).toBe(0);
  });
});

describe('frozen + caught up ≡ ticked through', () => {
  it('plants grow identically whether their chunks stayed active, froze once or flickered', () => {
    const always = scenario();
    const awayAndBack = scenario((t, p) => {
      if (t === 1000) Object.assign(p, { cx: 25, cy: 25 });
    });
    const flicker = scenario((t, p) => {
      const phase = Math.floor(t / 17_000) % 4;
      if (phase === 0) Object.assign(p, { layer: 0, cx: 10, cy: 10 });
      else if (phase === 1) Object.assign(p, { layer: 0, cx: 14, cy: 10 });
      else if (phase === 2) Object.assign(p, { layer: -1, cx: 10, cy: 10 });
      else Object.assign(p, { layer: 0, cx: 12, cy: 13 });
    });
    const reference = always.hashes();
    const grown = always.manager.ensure(0, 10, 10).getObjectState(300);
    expect(grown?.growth).toBe(3);
    expect(awayAndBack.hashes()).toEqual(reference);
    expect(flicker.hashes()).toEqual(reference);
    // The histories differ, the frozen-tick tables too – only the content must agree.
    expect(awayAndBack.zone.save.serialize()).not.toEqual(always.zone.save.serialize());
  });

  it('a saved and restored zone continues identically (all chunks frozen after loading)', () => {
    const reference = scenario((t, p) => {
      if (t === 60_000) Object.assign(p, { cx: 20, cy: 20 });
    });
    const first = new Harness();
    first.run(1);
    first.plant();
    first.run(100_000, (t, p) => {
      if (t === 60_000) Object.assign(p, { cx: 20, cy: 20 });
    });
    // Save between two ticks: clock, zone participant, chunk changes.
    const clock = first.sim.participant('clock').serialize();
    const zoneData = JSON.parse(JSON.stringify(first.zone.save.serialize())) as unknown;
    const changes = first.manager.collectChanges();
    const second = new Harness();
    second.sim.participant('clock').deserialize(clock);
    second.manager.loadStored(changes.writes.flatMap((w) => (w.diff === null ? [] : [w.diff])));
    second.zone.save.deserialize(zoneData);
    expect(second.zone.size).toBe(0);
    second.player.cx = 20;
    second.player.cy = 20;
    second.run(END - 1);
    second.run(END, (_t, p) => Object.assign(p, { cx: 10, cy: 10 }));
    expect(second.hashes()).toEqual(reference.hashes());
  });
});

describe('loading keeps the hysteresis ring (ADR-0024)', () => {
  it('a zone saved with active chunks in its hysteresis ring continues exactly like the uninterrupted zone', () => {
    const path = (t: number, p: Position): void => {
      if (t === 3_000) p.cx = 11; // column 8 stays active: distance 3 = radius + hysteresis
      if (t === 6_000) p.cx = 13; // now columns 8 and 9 freeze
    };
    const whole = new Harness();
    whole.run(1);
    whole.plant();
    whole.run(8_000, path);

    const first = new Harness();
    first.run(1);
    first.plant();
    first.run(5_000, path);
    const data = JSON.parse(JSON.stringify(first.zone.save.serialize())) as { frozen: number[]; active: number[] };
    const active = new Set<string>();
    for (let k = 0; k < data.active.length; k += 3) active.add(`${data.active[k]}:${data.active[k + 1]}:${data.active[k + 2]}`);
    expect(active.size).toBe(30);
    expect(active.has('0:8:10')).toBe(true);
    const changes = first.manager.collectChanges();

    const second = new Harness();
    second.sim.participant('clock').deserialize(first.sim.participant('clock').serialize());
    second.manager.loadStored(changes.writes.flatMap((w) => (w.diff === null ? [] : [w.diff])));
    second.zone.save.deserialize(data);
    Object.assign(second.player, first.player);
    expect([second.zone.size, second.zone.resuming]).toEqual([0, 30]);
    expect(second.zone.save.serialize()).toEqual(data);
    second.run(8_000, path);
    // Columns 8 and 9 froze at tick 6 000 in both runs (without the saved active set, column 8 would
    // have been frozen at the save tick 5 000 in the loaded run).
    expect([second.zone.size, second.zone.isActive(0, 9, 10), second.zone.isActive(0, 10, 10)]).toEqual([30, false, true]);
    expect(second.zone.save.serialize()).toEqual(whole.zone.save.serialize());
    expect(second.hashes()).toEqual(whole.hashes());
  });

  it('pending chunks off the new focus stay frozen at their saved tick; freezeAll catches pending chunks up first', () => {
    const h = new Harness();
    h.run(100);
    const data = h.zone.save.serialize();
    const calls: string[] = [];
    const clock = { tick: 100 };
    const probe = new ActiveZone({
      chunks: fixtureManager().manager,
      catchUp: new CatchUpRegistry().register('probe', (chunk, from, to) => calls.push(`${chunk.key} ${from}→${to}`)).seal([{ id: 'probe', update: () => undefined }]),
      tick: () => clock.tick,
    });
    probe.save.deserialize(data);
    clock.tick = 150;
    probe.freezeAll();
    expect(calls).toHaveLength(25);
    expect(calls).toContain('0:10:10 100→150');
    expect(probe.resuming).toBe(0);
    const frozen = probe.save.serialize().frozen;
    for (let k = 0; k < frozen.length; k += 4) expect(frozen[k + 3]).toBe(150);
    expect(() => probe.save.deserialize({ frozen: [], active: [0, 1, 1, -1, 2, 2] })).toThrow(/one layer/);
    expect(() => probe.save.deserialize({ frozen: [], active: [0, 2, 2, 0, 1, 1] })).toThrow(/sorted/);
    expect(() => probe.save.deserialize({ frozen: [], active: [0, 99, 1] })).toThrow(/outside the world/);
  });
});

describe('participant world-chunks', () => {
  it('saves active chunks as frozen at the current tick and restores the table', () => {
    const h = new Harness();
    h.run(500);
    h.run(700, (_t, p) => (p.cx = 20));
    const data = h.zone.save.serialize();
    expect(h.zone.save.id).toBe(WORLD_CHUNKS_PARTICIPANT_ID);
    const entries: Array<[number, number, number, number]> = [];
    for (let k = 0; k < data.frozen.length; k += 4) entries.push(data.frozen.slice(k, k + 4) as [number, number, number, number]);
    const byChunk = new Map(entries.map(([l, x, y, t]) => [`${l}:${x}:${y}`, t]));
    expect(byChunk.get('0:10:10')).toBe(500); // frozen when the player left
    expect(byChunk.get('0:20:10')).toBe(700); // active: frozen at the save tick
    expect(entries.map(([l, x, y]) => packChunkId(l as Layer, x, y))).toEqual([...entries.map(([l, x, y]) => packChunkId(l as Layer, x, y))].sort((a, b) => a - b));

    const fresh = new Harness();
    fresh.zone.save.deserialize(structuredClone(data));
    expect(fresh.zone.save.serialize()).toEqual(data);
    const bad: unknown[] = [null, { frozen: [0, 1, 2] }, { frozen: [5, 1, 1, 10] }, { frozen: [0, 1, 1, 0] }, { frozen: [0, 2, 1, 10, 0, 1, 1, 10] }, { frozen: [0, 1, 1, 10], extra: 1 }];
    for (const b of bad) expect(() => fresh.zone.save.deserialize(b)).toThrow(TypeError);
  });
});
