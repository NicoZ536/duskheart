/**
 * Headless-Simulationsszenarien (Node) für `npm run bench` (§30: Simulation ≤ 3 ms pro Tick,
 * keine Allokationen in Hot-Loops, kein Heap-Wachstum). Die Grenzwerte stehen in
 * `tools/bench/schwellwerte.json`. Allokationsmessungen brauchen `global.gc` (`node --expose-gc`,
 * so startet `npm run bench`).
 */
import { BALANCE } from '../../src/content/balance';
import { ColumnStore, Ecs, Query, type Entity } from '../../src/engine/ecs';
import { Rng } from '../../src/engine/rng';
import { SpatialHash } from '../../src/engine/spatialHash';
import { demoScript } from '../../src/game/headless';
import { ReplayPlayer } from '../../src/engine/commands';
import { createSimulation } from '../../src/game/setup';
import { BodyGrid, CollisionGrid, LAND_CREATURE_RULES, MOVE_HIT, moveCircles, type CircleBatch } from '../../src/world/collision';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_DEEP } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, TILE_PX, packChunkId, type Layer } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import type { Measurement } from './thresholds';
import { percentile, slope } from './stats';

export interface SimScenario {
  readonly name: string;
  run(): Measurement[];
}

const BYTES_PER_KB = 1024;

/** Erzwingt eine volle Speicherbereinigung; ohne `--expose-gc` ist keine Allokationsmessung möglich. */
function collectGarbage(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error('bench: Allokationsmessung braucht `node --expose-gc` (npm run bench startet so)');
  gc();
}

/** ECS-Grundlast: 6 000 Entitäten mit Position/Velocity bewegen und im Hash-Grid aktualisieren (§30 „bis 6 000 Sprites“). */
const ecsMovement: SimScenario = {
  name: 'sim:ecs-6000-bewegung',
  run(): Measurement[] {
    const ENTITIES = 6000;
    const WORLD = 4096;
    const SPEED = 40;
    const ecs = new Ecs();
    const pos = ecs.registerComponent('pos', new ColumnStore({ x: 'f32', y: 'f32', vx: 'f32', vy: 'f32' }, 8192));
    const grid = new SpatialHash(64);
    const rng = new Rng(42);
    for (let i = 0; i < ENTITIES; i++) {
      const row = pos.add(ecs.create());
      pos.columns.x[row] = rng.float(0, WORLD);
      pos.columns.y[row] = rng.float(0, WORLD);
      pos.columns.vx[row] = rng.float(-SPEED, SPEED);
      pos.columns.vy[row] = rng.float(-SPEED, SPEED);
    }
    const samples: number[] = [];
    const dt = 1 / 60;
    for (let tick = 0; tick < 600; tick++) {
      const t0 = performance.now();
      const { x, y, vx, vy } = pos.columns;
      const ents = pos.entities;
      for (let i = 0; i < pos.size; i++) {
        let nx = (x[i] ?? 0) + (vx[i] ?? 0) * dt;
        let ny = (y[i] ?? 0) + (vy[i] ?? 0) * dt;
        if (nx < 0 || nx > WORLD) vx[i] = -(vx[i] ?? 0);
        if (ny < 0 || ny > WORLD) vy[i] = -(vy[i] ?? 0);
        nx = Math.min(WORLD, Math.max(0, nx));
        ny = Math.min(WORLD, Math.max(0, ny));
        x[i] = nx;
        y[i] = ny;
        const e = ents[i] ?? 0;
        grid.upsert(e, nx - 4, ny - 4, nx + 4, ny + 4);
      }
      samples.push(performance.now() - t0);
    }
    return [{ scenario: this.name, metric: 'tick p95', value: percentile(samples.slice(60), 95), unit: 'ms' }];
  },
};

/**
 * M0-06 Mikro-Bench: eine Query über 100 000 Entitäten mit Position und Velocity (Integration
 * p += v·dt) in < 2 ms, ohne Allokation (gemessen als Heap-Zuwachs über 300 Iterationen nach voller
 * Speicherbereinigung). Die Iterationszeit ist der Median über 200 Läufe: einzelne Ausreißer
 * stammen vom Scheduler geteilter Maschinen, nicht von der Iteration.
 */
const ecsIteration: SimScenario = {
  name: 'sim:ecs-100k-iteration',
  run(): Measurement[] {
    const ENTITIES = 100_000;
    const TIMED = 200;
    const ALLOC_ITERATIONS = 300;
    const ecs = new Ecs();
    const pos = ecs.registerComponent('position', new ColumnStore({ x: 'f32', y: 'f32' }, ENTITIES));
    const vel = ecs.registerComponent('velocity', new ColumnStore({ vx: 'f32', vy: 'f32' }, ENTITIES));
    const rng = new Rng(7);
    for (let i = 0; i < ENTITIES; i++) {
      const e = ecs.create();
      const p = pos.add(e);
      pos.columns.x[p] = rng.float(0, 1000);
      pos.columns.y[p] = rng.float(0, 1000);
      const v = vel.add(e);
      vel.columns.vx[v] = rng.float(-1, 1);
      vel.columns.vy[v] = rng.float(-1, 1);
    }
    const query = new Query([vel, pos]);
    const dt = 1 / 60;
    // Columns and callback are set up once per system update (no adds during the iteration).
    const { x, y } = pos.columns;
    const { vx, vy } = vel.columns;
    const integrate = (_e: Entity, rows: Int32Array): void => {
      const v = rows[0] as number;
      const p = rows[1] as number;
      x[p] = (x[p] as number) + (vx[v] as number) * dt;
      y[p] = (y[p] as number) + (vy[v] as number) * dt;
    };
    // Warm-up until the optimizing compiler has compiled the loop and the callback.
    for (let i = 0; i < 100; i++) query.eachRow(integrate);
    const samples: number[] = [];
    for (let i = 0; i < TIMED; i++) {
      const t0 = performance.now();
      query.eachRow(integrate);
      samples.push(performance.now() - t0);
    }
    collectGarbage();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ALLOC_ITERATIONS; i++) query.eachRow(integrate);
    const allocated = Math.max(0, process.memoryUsage().heapUsed - before);
    return [
      { scenario: this.name, metric: 'iteration median', value: percentile(samples, 50), unit: 'ms' },
      { scenario: this.name, metric: 'Allokation je Entität', value: allocated / (ALLOC_ITERATIONS * ENTITIES), unit: 'B' },
    ];
  },
};

/**
 * Die echte Simulation (alle Systeme) mit dem Demo-Skript: Tick-Zeit und Heap-Trend über zehn
 * Echtminuten Spielzeit (36 000 Ticks = 10 Spielstunden). Der Heap wird je Echtminute nach einer
 * vollen Speicherbereinigung gemessen; die Tick-Zeiten landen in einem vorab angelegten Puffer,
 * damit die Messung selbst den Heap nicht wachsen lässt.
 */
const headlessDemo: SimScenario = {
  name: 'sim:headless-demo',
  run(): Measurement[] {
    const TICKS = 36_000;
    const SAMPLE_EVERY = 3_600;
    const sim = createSimulation({ seed: 30 });
    const player = new ReplayPlayer(demoScript({ ticks: TICKS, seed: 31 }));
    const drop = (): void => undefined;
    const tickMs = new Float64Array(TICKS);
    const heapKb = new Float64Array(TICKS / SAMPLE_EVERY);
    for (let t = 0; t < TICKS; t++) {
      player.feed(sim.tick, sim.commands);
      const t0 = performance.now();
      sim.step();
      tickMs[t] = performance.now() - t0;
      sim.events.drain(drop);
      if ((t + 1) % SAMPLE_EVERY === 0) {
        collectGarbage();
        heapKb[(t + 1) / SAMPLE_EVERY - 1] = process.memoryUsage().heapUsed / BYTES_PER_KB;
      }
    }
    // The first sample includes JIT warm-up; the trend is measured over the remaining minutes.
    return [
      { scenario: this.name, metric: 'tick p95', value: percentile(Array.from(tickMs.subarray(SAMPLE_EVERY)), 95), unit: 'ms' },
      { scenario: this.name, metric: 'Heap-Trend', value: Math.max(0, slope(Array.from(heapKb.subarray(1)))), unit: 'KB/min' },
    ];
  },
};

/** Chunks per edge of the collision bench world (8 × 8 chunks = 256² tiles, larger than an active zone). */
const COLLISION_WORLD_CHUNKS = 8;

/**
 * Deterministic test landscape for the collision bench: meadow with sparse scatter, forest chunks
 * (a third, 8 % trees plus bushes and rocks), a plateau one level up with cliff faces on its north
 * and south edge and a ramp every chunk, and a pond of deep water.
 */
function collisionBenchWorld(rng: Rng): Map<number, ChunkData> {
  const ids = contentWorldIdTables();
  const gras = ids.terrain.runtimeId('gras');
  const tree = ids.objects.runtimeId('baum_eiche');
  const bush = ids.objects.runtimeId('busch_beeren');
  const rock = ids.objects.runtimeId('fels_klein_gruenhain');
  const chunks = new Map<number, ChunkData>();
  for (let cy = 0; cy < COLLISION_WORLD_CHUNKS; cy++) {
    for (let cx = 0; cx < COLLISION_WORLD_CHUNKS; cx++) {
      const c = new ChunkData(0, cx, cy);
      c.ground.fill(gras);
      chunks.set(packChunkId(0, cx, cy), c);
    }
  }
  const tiles = COLLISION_WORLD_CHUNKS * CHUNK_SIZE;
  const plateau = { top: 96, bottom: 160 };
  const ramp = { from: 14, to: 18 };
  const pond = { x: 200, y: 60, r2: 144 };
  const forestEvery = 3;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const c = chunks.get(packChunkId(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT)) as ChunkData;
      const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
      const forest = ((tx >> CHUNK_SHIFT) + (ty >> CHUNK_SHIFT)) % forestEvery === 0;
      const v = rng.next();
      if (v < (forest ? 0.08 : 0.01)) c.object[i] = tree;
      else if (v < (forest ? 0.1 : 0.015)) c.object[i] = bush;
      else if (v < (forest ? 0.105 : 0.02)) c.object[i] = rock;
      if (ty >= plateau.top && ty < plateau.bottom) c.height[i] = 1;
      const local = tx & CHUNK_MASK;
      if ((ty === plateau.top - 1 || ty === plateau.top || ty === plateau.bottom - 1 || ty === plateau.bottom) && local >= ramp.from && local < ramp.to) c.flags[i] = (c.flags[i] as number) | TILE_FLAG_RAMP;
      const px = tx - pond.x;
      const py = ty - pond.y;
      if (px * px + py * py < pond.r2) {
        c.water[i] = WATER_DEPTH_DEEP;
        c.object[i] = 0;
      }
    }
  }
  return chunks;
}

/**
 * M2-23 Mikro-Bench: Kollision für 2 000 Entitäten je Tick ≤ 0,5 ms – Kreise (r 5 px) mit bis zu
 * 7 Tiles/s je Achse gegen das Tile-Raster (`moveCircles`, Speicher der Tile-Ableitungen an), das
 * Hash-Grid der Körper neu aufgebaut und alle überlappenden Paare gesucht. Die Bewegungsabsicht
 * (v · dt) und das Abprallen an Hindernissen liegen außerhalb der Messung (Spiellogik). Gemessen wird
 * der Median je Tick (einzelne Ausreißer stammen vom Scheduler geteilter Maschinen) und die
 * Allokation im eingeschwungenen Zustand.
 */
const collision2000: SimScenario = {
  name: 'sim:kollision-2000',
  run(): Measurement[] {
    const ENTITIES = 2000;
    const RADIUS_PX = 5;
    const TICKS = 1200;
    const WARMUP = 300;
    const ALLOC_TICKS = 300;
    const rng = new Rng(23);
    const chunks = collisionBenchWorld(rng);
    let tick = 0;
    const grid = new CollisionGrid({
      chunks: { get: (layer: Layer, cx: number, cy: number) => chunks.get(packChunkId(layer, cx, cy)) },
      worldTiles: COLLISION_WORLD_CHUNKS * CHUNK_SIZE,
      epoch: () => tick,
      memo: true,
    });
    const bodies = new BodyGrid();
    const maxSpeed = BALANCE.motion.debugMoverMaxAxisSpeedTilesPerSecond * TILE_PX;
    const edge = COLLISION_WORLD_CHUNKS * CHUNK_SIZE * TILE_PX;
    const vx = new Float32Array(ENTITIES);
    const vy = new Float32Array(ENTITIES);
    const ids = new Int32Array(ENTITIES);
    const batch: CircleBatch = {
      count: ENTITIES,
      x: new Float32Array(ENTITIES),
      y: new Float32Array(ENTITIES),
      dx: new Float32Array(ENTITIES),
      dy: new Float32Array(ENTITIES),
      r: new Float32Array(ENTITIES).fill(RADIUS_PX),
      result: new Int32Array(ENTITIES),
      normalX: new Float32Array(ENTITIES),
      normalY: new Float32Array(ENTITIES),
    };
    for (let i = 0; i < ENTITIES; i++) {
      batch.x[i] = rng.float(TILE_PX, edge - TILE_PX);
      batch.y[i] = rng.float(TILE_PX, edge - TILE_PX);
      vx[i] = rng.float(-maxSpeed, maxSpeed);
      vy[i] = rng.float(-maxSpeed, maxSpeed);
      ids[i] = i + 1;
    }
    const pairs = new Int32Array(ENTITIES * 2);
    const dt = 1 / BALANCE.time.tickHz;
    const collide = (): void => {
      moveCircles(grid, 0, batch, LAND_CREATURE_RULES);
      bodies.clear();
      bodies.addColumns(ENTITIES, ids, 0, batch.x, batch.y, batch.r);
      bodies.build();
      bodies.overlapPairs(pairs);
    };
    const steer = (): void => {
      for (let i = 0; i < ENTITIES; i++) {
        batch.dx[i] = (vx[i] as number) * dt;
        batch.dy[i] = (vy[i] as number) * dt;
      }
    };
    const bounce = (): void => {
      for (let i = 0; i < ENTITIES; i++) {
        if (((batch.result[i] as number) & MOVE_HIT) === 0) continue;
        if (batch.normalX?.[i] !== 0) vx[i] = -(vx[i] as number);
        if (batch.normalY?.[i] !== 0) vy[i] = -(vy[i] as number);
      }
    };
    const tickMs = new Float64Array(TICKS);
    for (; tick < TICKS; tick++) {
      steer();
      const t0 = performance.now();
      collide();
      tickMs[tick] = performance.now() - t0;
      bounce();
    }
    collectGarbage();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < ALLOC_TICKS; k++, tick++) {
      steer();
      collide();
      bounce();
    }
    const allocated = Math.max(0, process.memoryUsage().heapUsed - before);
    return [
      { scenario: this.name, metric: 'tick median', value: percentile(Array.from(tickMs.subarray(WARMUP)), 50), unit: 'ms' },
      { scenario: this.name, metric: 'Allokation je Entität', value: allocated / (ALLOC_TICKS * ENTITIES), unit: 'B' },
    ];
  },
};

export const SIM_SCENARIOS: readonly SimScenario[] = [ecsMovement, ecsIteration, headlessDemo, collision2000];
