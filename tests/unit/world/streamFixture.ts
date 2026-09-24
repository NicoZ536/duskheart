/**
 * Deterministic test world for the streaming tests (unit, Node worker thread, browser E2E). It
 * stands in for the real chunk generator (src/world/gen/chunk.ts) behind the same contract
 * `(plan, layer, cx, cy) → ChunkData`: seeded simplex fBm for height and ground, hashed objects,
 * a few generated object states. Order independent like the real one (only plan + address).
 * No test framework imports: the browser and worker threads load this module too.
 */
import { JobQueue, inThreadExecutor } from '../../../src/engine/workerBridge';
import { createSimplex2, fbm, type Noise2 } from '../../../src/engine/noise';
import { hash3 } from '../../../src/engine/rng';
import { ChunkData, WATER_DEPTH_DEEP, WATER_SEA } from '../../../src/world/model/chunk';
import { CHUNK_AREA, CHUNK_SIZE, layerIndex, localX, localY, type Layer } from '../../../src/world/model/coords';
import { worldDimensions, type WorldDimensions } from '../../../src/world/model/worldSize';
import { ChunkManager } from '../../../src/world/stream/chunkManager';
import type { StreamConfig } from '../../../src/world/stream/config';
import { createChunkWorkerHandlers, type ChunkWorkerApi } from '../../../src/world/stream/worker';

/** The "world plan" of the test world. */
export interface FixturePlan {
  readonly seed: number;
}

/** Number of distinct ground ids the fixture uses (1…5). */
export const FIXTURE_GROUND_KINDS = 5;
/** Largest object id the fixture places. */
export const FIXTURE_OBJECT_KINDS = 300;
const NOISE_SCALE = 1 / 48;
const OBJECT_ODDS = 23;
const STATE_ODDS = 211;

const noiseCache = new Map<number, Noise2>();
function noiseFor(seed: number): Noise2 {
  let n = noiseCache.get(seed);
  if (n === undefined) {
    n = createSimplex2(seed);
    noiseCache.set(seed, n);
  }
  return n;
}

/** Generates one chunk of the test world. */
export function fixtureGenerate(plan: FixturePlan, layer: Layer, cx: number, cy: number): ChunkData {
  const chunk = new ChunkData(layer, cx, cy);
  const noise = noiseFor(plan.seed * 4 + layerIndex(layer));
  for (let i = 0; i < CHUNK_AREA; i++) {
    const wx = cx * CHUNK_SIZE + localX(i);
    const wy = cy * CHUNK_SIZE + localY(i);
    const v = fbm(noise, wx * NOISE_SCALE, wy * NOISE_SCALE, { octaves: 4 });
    const level = Math.max(0, Math.min(FIXTURE_GROUND_KINDS - 1, Math.floor((v + 1) * 2.5)));
    chunk.ground[i] = 1 + level;
    chunk.height[i] = layer === 0 ? level : 0;
    chunk.biome[i] = 1 + ((((cx >> 2) + (cy >> 2)) & 3) >>> 0);
    if (layer === 0 && level === 0) chunk.water[i] = WATER_SEA | WATER_DEPTH_DEEP;
    if (layer !== 0 && level >= 3) chunk.solid[i] = level;
    const h = hash3(wx, wy, layer, plan.seed);
    if (level > 0 && h % OBJECT_ODDS === 0) {
      chunk.object[i] = 1 + ((h >>> 8) % FIXTURE_OBJECT_KINDS);
      if ((h >>> 4) % STATE_ODDS === 0) chunk.setObjectState(i, 3, 0.25);
    }
  }
  return chunk;
}

/** World extent of the fixture tests (Klein: 32² chunks). */
export const FIXTURE_WORLD: WorldDimensions = worldDimensions('small');

/** A manual millisecond clock for budget tests. */
export interface ManualClock {
  ms: number;
  readonly now: () => number;
}

export function manualClock(): ManualClock {
  const c = { ms: 0, now: () => c.ms };
  return c;
}

/** In-thread chunk worker handlers of the fixture world. */
export function fixtureHandlers(): ChunkWorkerApi<FixturePlan> {
  return createChunkWorkerHandlers(fixtureGenerate);
}

/** A chunk manager on the fixture world with an in-thread job queue (Node fallback). */
export function fixtureManager(
  options: { readonly seed?: number; readonly budgetMs?: number; readonly clock?: ManualClock; readonly config?: Partial<StreamConfig>; readonly jobs?: JobQueue<ChunkWorkerApi<FixturePlan>> } = {},
): { manager: ChunkManager<FixturePlan>; jobs: JobQueue<ChunkWorkerApi<FixturePlan>>; clock: ManualClock } {
  const clock = options.clock ?? manualClock();
  const jobs = options.jobs ?? new JobQueue(inThreadExecutor(fixtureHandlers()), { frameBudgetMs: options.budgetMs ?? 1000, now: clock.now });
  const manager = new ChunkManager({ plan: { seed: options.seed ?? 7 }, generate: fixtureGenerate, jobs, world: FIXTURE_WORLD, config: options.config });
  return { manager, jobs, clock };
}

/** Runs `update` until nothing is loading any more (at most `maxFrames`). */
export function settle(manager: ChunkManager<FixturePlan>, layer: Layer, cx: number, cy: number, maxFrames = 1000): number {
  for (let f = 1; f <= maxFrames; f++) {
    manager.update(layer, cx, cy);
    if (manager.loadingCount === 0) return f;
  }
  throw new Error(`fixture: still loading after ${maxFrames} frames`);
}
