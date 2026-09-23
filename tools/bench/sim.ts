/**
 * Headless-Simulationsszenarien (Node) für `npm run bench` (§30: Simulation ≤ 3 ms pro Tick,
 * keine Allokationen in Hot-Loops, kein Heap-Wachstum). Die Grenzwerte stehen in
 * `tools/bench/schwellwerte.json`. Allokationsmessungen brauchen `global.gc` (`node --expose-gc`,
 * so startet `npm run bench`).
 */
import { ColumnStore, Ecs, Query, type Entity } from '../../src/engine/ecs';
import { Rng } from '../../src/engine/rng';
import { SpatialHash } from '../../src/engine/spatialHash';
import { demoScript } from '../../src/game/headless';
import { ReplayPlayer } from '../../src/engine/commands';
import { createSimulation } from '../../src/game/setup';
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

export const SIM_SCENARIOS: readonly SimScenario[] = [ecsMovement, ecsIteration, headlessDemo];
