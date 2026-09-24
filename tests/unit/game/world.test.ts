/**
 * The world wired into the simulation (src/game/world.ts, src/game/setup.ts; docs/ARCHITEKTUR.md
 * "Simulation", "Aktive Zone"): lazy materialisation, the active zone following the controlled
 * entity, handed-in worlds, `hashState()` over the world state, save → load → continue with chunk
 * changes, catch-up coverage of late systems, temperature field and the world cache.
 * Small worlds keep the file fast (one world ≈ 0,3–0,6 s).
 */
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../src/game/session';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { MotionSystem } from '../../../src/game/systems/motion';
import { planFor, worldFor } from '../../../src/game/worldCache';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../../src/save/world';
import { generateWorld, worldHash } from '../../../src/world/gen/world';
import { CHUNK_SIZE, TILE_PX, chunkKey, tileToChunk } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const SEED = 20260924;
const CONFIG = { seed: SEED, worldSize: 'small', dayLengthMinutes: 12 } as const;
const BUILD = '0.1.0';
const TIMEOUT_MS = 30_000;
/** Ticks between two world ticks (60 Hz / 1 Hz). */
const WORLD_TICK = 60;

/** Spawns the controlled entity at the centre of tile (tx, ty) in the next tick. */
function spawnAt(sim: Simulation, tx: number, ty: number): void {
  sim.commands.push({ type: 'spawnDebugMover', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2, controlled: true });
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    sim.events.clear();
  }
}

describe('SimWorld in the simulation', () => {
  it('builds nothing of the world until the simulation needs it (plan at the first world tick)', () => {
    const sim = createSimulation(CONFIG);
    expect([sim.world.planned, sim.world.materialized]).toEqual([false, false]);
    run(sim, WORLD_TICK - 1);
    expect([sim.world.planned, sim.world.materialized]).toEqual([false, false]);
    run(sim, 1);
    expect([sim.world.planned, sim.world.materialized]).toEqual([true, false]);
    // The calendar needs no world.
    expect(sim.world.calendar.season).toBe('fruehling');
  });

  it(
    'the active zone follows the controlled entity; chunks it froze are released and keep their tick',
    () => {
      const sim = createSimulation(CONFIG);
      const { spawn } = sim.world.generated;
      spawnAt(sim, spawn.x, spawn.y);
      run(sim, 1);
      const zone = sim.world.zone;
      expect(zone.layer).toBe(0);
      expect(zone.size).toBe(25);
      expect(zone.isTileActive(0, spawn.x, spawn.y)).toBe(true);
      // No camera streams in a headless simulation: exactly the zone is resident.
      expect(sim.world.chunks.residentCount).toBe(25);
      // Jump far away: a new controlled entity on the other side of the island.
      const far = { x: spawn.x > 512 ? spawn.x - 320 : spawn.x + 320, y: spawn.y };
      spawnAt(sim, far.x, far.y);
      run(sim, 5);
      const jumpTick = sim.tick - 5;
      expect(zone.isTileActive(0, far.x, far.y)).toBe(true);
      expect(zone.isTileActive(0, spawn.x, spawn.y)).toBe(false);
      expect(sim.world.chunks.residentCount).toBe(25);
      const frozen = sim.world.zone.save.serialize().frozen;
      const ticks = new Map<string, number>();
      for (let k = 0; k < frozen.length; k += 4) ticks.set(chunkKey(frozen[k] as 0, frozen[k + 1] as number, frozen[k + 2] as number), frozen[k + 3] as number);
      expect(ticks.get(chunkKey(0, tileToChunk(spawn.x), tileToChunk(spawn.y)))).toBe(jumpTick);
      // Without focus the zone freezes completely.
      sim.step([{ type: 'despawn', entity: (sim.system('motion') as MotionSystem).controlled }]);
      run(sim, 1);
      expect(zone.size).toBe(0);
      expect(sim.world.chunks.residentCount).toBe(0);
    },
    TIMEOUT_MS,
  );

  it('uses a world handed in and refuses a world of another seed or size', () => {
    const world = worldFor(SEED, 'small');
    const sim = createSimulation(CONFIG, { world });
    expect(sim.world.generated).toBe(world);
    expect(() => createSimulation({ ...CONFIG, seed: SEED + 1 }, { world })).toThrow(RangeError);
    expect(() => createSimulation({ ...CONFIG, worldSize: 'medium' }, { world })).toThrow(RangeError);
    // The browser session hands in the world from the world worker the same way.
    expect(new GameSession({ config: CONFIG, simulation: { world } }).sim.world.generated).toBe(world);
    // Before the simulation needs it, a world can still be provided.
    const late = createSimulation(CONFIG);
    late.world.provide(world);
    expect(late.world.generated).toBe(world);
  });

  it(
    'hashState covers chunk changes, weather, calendar and zone',
    () => {
      const a = createSimulation(CONFIG);
      const b = createSimulation(CONFIG);
      const { spawn } = a.world.generated;
      for (const s of [a, b]) {
        spawnAt(s, spawn.x, spawn.y);
        run(s, WORLD_TICK + 1);
      }
      expect(a.hashState()).toBe(b.hashState());
      // A dug tile (systems write chunk arrays directly; the chunk store notices by content).
      const chunk = a.world.chunks.ensure(0, tileToChunk(spawn.x), tileToChunk(spawn.y));
      const i = (spawn.y % CHUNK_SIZE) * CHUNK_SIZE + (spawn.x % CHUNK_SIZE);
      const before = chunk.ground[i] as number;
      chunk.ground[i] = contentWorldIdTables().terrain.runtimeId(before === contentWorldIdTables().terrain.runtimeId('erde') ? 'sand' : 'erde');
      expect(a.hashState()).not.toBe(b.hashState());
      chunk.ground[i] = before;
      expect(a.hashState()).toBe(b.hashState());
      a.world.weather.force(0, 'gewitter');
      expect(a.hashState()).not.toBe(b.hashState());
      b.world.weather.force(0, 'gewitter');
      expect(a.hashState()).toBe(b.hashState());
      a.world.calendar.setSeasonLength(3);
      expect(a.hashState()).not.toBe(b.hashState());
      b.world.calendar.setSeasonLength(3);
      expect(a.hashState()).toBe(b.hashState());
      // Different zone history, same everything else.
      a.world.zone.freezeAll();
      expect(a.hashState()).not.toBe(b.hashState());
    },
    TIMEOUT_MS,
  );

  it(
    'save → load → continue keeps chunk changes, zone and weather; only changed chunks are written',
    async () => {
      const script = (sim: Simulation, from: number, to: number): void => {
        for (let t = from; t < to; t++) {
          if (t % 200 === 0) sim.commands.push({ type: 'move', dx: t % 400 === 0 ? 1 : 0, dy: t % 400 === 0 ? 0 : -1 });
          sim.step();
          sim.events.clear();
        }
      };
      const edit = (sim: Simulation): string[] => {
        const { spawn } = sim.world.generated;
        const near = sim.world.chunks.ensure(0, tileToChunk(spawn.x), tileToChunk(spawn.y));
        near.ground[3] = contentWorldIdTables().terrain.runtimeId('sand');
        // A chunk outside the zone: resident until the next zone change, then its diff waits in memory.
        const far = sim.world.chunks.ensure(0, 1, 1);
        far.object[7] = 0;
        far.ground[7] = contentWorldIdTables().terrain.runtimeId('erde');
        return [near.key, far.key].sort();
      };
      const start = (): Simulation => {
        const sim = createSimulation(CONFIG);
        const { spawn } = sim.world.generated;
        spawnAt(sim, spawn.x, spawn.y);
        return sim;
      };
      const whole = start();
      script(whole, 0, 300);
      const keys = edit(whole);
      script(whole, 300, 2400);

      const part = start();
      script(part, 0, 300);
      edit(part);
      script(part, 300, 900);
      const store = new MemorySaveStore();
      await saveWorld(store, part, { worldId: 'w', name: 'W', now: 1, gameVersion: BUILD });
      expect(await store.listChunkKeys('w')).toEqual(keys);
      const loaded = await loadWorld(store, 'w');
      expect(loaded.hashState()).toBe(part.hashState());
      script(loaded, 900, 2400);
      expect(loaded.hashState()).toBe(whole.hashState());
      // Saving again without further changes writes no chunk record.
      await saveWorld(store, loaded, { worldId: 'w', name: 'W', now: 2, gameVersion: BUILD });
      expect(await store.listChunkKeys('w')).toEqual(keys);
      store.close();
    },
    TIMEOUT_MS,
  );

  it('refuses time-dependent systems added after createSimulation unless they are global', () => {
    const sim = createSimulation(CONFIG);
    sim.addSystem({ id: 'wetterfahne', timeScope: 'global', worldTick: () => undefined });
    run(sim, 1);
    sim.addSystem({ id: 'fackeln', worldTick: () => undefined });
    expect(() => sim.step()).toThrow(/"fackeln" was added after createSimulation/);
  });

  it('the temperature field reads plan regions, weather and resident chunks', () => {
    const sim = createSimulation(CONFIG);
    const { spawn } = sim.world.generated;
    spawnAt(sim, spawn.x, spawn.y);
    run(sim, WORLD_TICK);
    const t = sim.world.temperature;
    // Grünhain start beach, spring morning (§9.3: 16 °C spring day, ±6 °C day curve).
    const here = t.temperatureAt(0, spawn.x, spawn.y);
    expect(here).toBeGreaterThan(4);
    expect(here).toBeLessThan(24);
    // Open sea in the corner has no weather region.
    expect(t.weatherOffsetAt(0, 0)).toBe(0);
    sim.world.weather.force(-1, 'schneesturm');
    run(sim, WORLD_TICK);
    expect(t.temperatureAt(0, spawn.x, spawn.y)).toBeLessThan(here);
  });
});

describe('world cache', () => {
  it(
    'shares worlds per (seed, size); a plan built for the weather feeds the world generation',
    () => {
      const seed = 4711;
      const plan = planFor(seed, 'small');
      expect(planFor(seed, 'small')).toBe(plan);
      const world = worldFor(seed, 'small');
      expect(worldFor(seed, 'small')).toBe(world);
      expect(world.plan.regions).toBe(plan.regions);
      expect(worldHash(world)).toBe(worldHash(generateWorld(seed, 'small')));
    },
    TIMEOUT_MS,
  );
});
