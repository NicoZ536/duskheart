/**
 * M2-14 acceptance: world generation in the worker with progress, determinism hash.
 * - Same seed ⇒ identical world hash and identical hash of all chunk data (every surface chunk of a
 *   Klein world, generated in two different orders from two separately generated worlds; samples of
 *   every underground layer).
 * - 20 seeds ⇒ every validation green (report without problems).
 * - The world worker (Node worker thread with the real handlers) returns the same world and the same
 *   chunks as the in-thread generator and reports the steps in order.
 * - Duration of a new Mittel world up to playable (world + the chunks around the spawn), budget 8 s (§30).
 */
import { MessageChannel, Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRpcClient, type RpcClient, type RpcPort } from '../../../src/engine/workerBridge';
import { chunkHash } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { generateChunk } from '../../../src/world/gen/chunk';
import { generateUndergroundChunk } from '../../../src/world/gen/underground/index';
import { requestWorld, type WorldWorkerApi, type WorldWorkerEvents } from '../../../src/world/gen/worker';
import { generateWorld, surfaceChunksHash, worldHash, WORLD_GEN_STEPS, type GeneratedWorld, type WorldGenProgress } from '../../../src/world/gen/world';

/** Seeds of the validation sweep (Klein). */
const SEEDS = Array.from({ length: 20 }, (_, i) => 31 + i * 104_729);
/** §30: "neue Welt Mittel spielbar ≤ 8 s". */
const PLAYABLE_BUDGET_MS = 8000;
/** Every how many chunks the structured clone of a world is compared chunk by chunk. */
const CLONE_SAMPLE_STEP = 17;
/** Chunk radius around the spawn that must exist before play starts (streaming radius 4, ADR-0020). */
const START_RADIUS_CHUNKS = 4;

describe('Determinismus', () => {
  it('gleicher Seed ⇒ identischer Welt-Hash (alle Größen), anderer Seed ⇒ anderer', () => {
    for (const preset of ['small', 'medium', 'large'] as const) {
      const a = generateWorld(4711, preset);
      const b = generateWorld(4711, preset);
      expect(worldHash(a)).toBe(worldHash(b));
      expect(worldHash(generateWorld(4712, preset))).not.toBe(worldHash(a));
    }
  }, 30_000);

  it('gleicher Seed ⇒ identischer Hash aller Oberflächen-Chunks, unabhängig von der Reihenfolge', () => {
    const a = generateWorld(99, 'small');
    const b = generateWorld(99, 'small');
    const chunks = a.plan.grid.tiles / CHUNK_SIZE;
    const reversed = Array.from({ length: chunks * chunks }, (_, i) => chunks * chunks - 1 - i);
    const ha = surfaceChunksHash(a);
    expect(surfaceChunksHash(b, reversed)).toBe(ha);
    // A structured clone (what the worker hands over) builds its own caches and still agrees
    // (every 17th chunk: spread over rows and columns).
    const clone = structuredClone(a);
    for (let id = 0; id < chunks * chunks; id += CLONE_SAMPLE_STEP) {
      const cx = id % chunks;
      const cy = Math.floor(id / chunks);
      expect(chunkHash(generateChunk(clone, 0, cx, cy))).toBe(chunkHash(generateChunk(a, 0, cx, cy)));
    }
  }, 60_000);

  it('Untergrund-Chunks: gleicher Seed ⇒ identische Chunks, delegiert an den Höhlengenerator', () => {
    const a = generateWorld(99, 'small');
    const b = generateWorld(99, 'small');
    const chunks = a.plan.grid.tiles / CHUNK_SIZE;
    for (const layer of [-1, -2, -3] as const) {
      for (let k = 0; k < 12; k++) {
        const cx = (k * 7 + 3) % chunks;
        const cy = (k * 11 + 5) % chunks;
        const h = chunkHash(generateChunk(a, layer, cx, cy));
        expect(chunkHash(generateChunk(b, layer, cx, cy))).toBe(h);
        expect(chunkHash(generateUndergroundChunk(a.underground, layer, cx, cy))).toBe(h);
      }
    }
  }, 30_000);
});

describe('20 Seeds ⇒ alle Validierungen grün', () => {
  it.each(SEEDS)('Seed %i (Klein)', (seed) => {
    const w = generateWorld(seed, 'small');
    expect(w.report.problems).toEqual([]);
    expect(w.report.reachability.unreachableAfter).toBe(0);
    expect(w.report.roads.connected).toBe(true);
  });
});

describe('Fortschritt und Dauer', () => {
  it('meldet jeden Schritt genau einmal in fester Reihenfolge', () => {
    const steps: WorldGenProgress[] = [];
    generateWorld(5, 'small', (p) => steps.push(p));
    expect(steps.map((p) => p.step)).toEqual([...WORLD_GEN_STEPS]);
    expect(steps.map((p) => p.index)).toEqual(WORLD_GEN_STEPS.map((_, i) => i));
    expect(steps.every((p) => p.count === WORLD_GEN_STEPS.length)).toBe(true);
  });

  it(`neue Welt Mittel spielbar in ≤ ${PLAYABLE_BUDGET_MS / 1000} s (Welt + Chunks um den Start)`, () => {
    const t0 = performance.now();
    const w = generateWorld(20260924, 'medium');
    const tWorld = performance.now() - t0;
    const scx = Math.floor(w.spawn.x / CHUNK_SIZE);
    const scy = Math.floor(w.spawn.y / CHUNK_SIZE);
    let n = 0;
    for (let cy = scy - START_RADIUS_CHUNKS; cy <= scy + START_RADIUS_CHUNKS; cy++) {
      for (let cx = scx - START_RADIUS_CHUNKS; cx <= scx + START_RADIUS_CHUNKS; cx++) {
        generateChunk(w, 0, cx, cy);
        n++;
      }
    }
    const total = performance.now() - t0;
    console.info(`Welt Mittel: ${tWorld.toFixed(0)} ms, + ${n} Chunks: ${total.toFixed(0)} ms`);
    expect(total).toBeLessThan(PLAYABLE_BUDGET_MS);
  }, 30_000);
});

describe('Weltgenerierung im Worker', () => {
  let worker: Worker;
  let channel: MessageChannel;
  let client: RpcClient<WorldWorkerApi, WorldWorkerEvents>;

  beforeAll(() => {
    channel = new MessageChannel();
    // The thread loads the real worker module through tsx (as the browser loads world.worker.ts through Vite).
    const entry = new URL('../../../src/world/gen/worker.ts', import.meta.url).href;
    const bootstrap = `import('tsx/esm/api').then(async (tsx) => {
      const m = await tsx.tsImport(${JSON.stringify(entry)}, ${JSON.stringify(entry)});
      const wt = await import('node:worker_threads');
      m.serveWorldWorker(wt.workerData.port);
    })`;
    worker = new Worker(bootstrap, { eval: true, workerData: { port: channel.port2 }, transferList: [channel.port2] });
    client = createRpcClient<WorldWorkerApi, WorldWorkerEvents>(channel.port1 as unknown as RpcPort);
  });

  afterAll(async () => {
    client.dispose();
    channel.port1.close();
    await worker.terminate();
  });

  it('liefert dieselbe Welt und dieselben Chunks wie der Hauptthread und meldet den Fortschritt', async () => {
    const steps: string[] = [];
    const remote: GeneratedWorld = await requestWorld(client, 1234, 'small', (p) => steps.push(p.step));
    const local = generateWorld(1234, 'small');
    expect(worldHash(remote)).toBe(worldHash(local));
    expect(steps).toEqual([...WORLD_GEN_STEPS]);
    for (const [layer, cx, cy] of [
      [0, 10, 12],
      [0, 16, 16],
      [-1, 12, 9],
      [-3, 20, 18],
    ] as const) {
      const loaded = await client.call('load', { layer, cx, cy, diff: null });
      expect(loaded.hash).toBe(chunkHash(generateChunk(local, layer, cx, cy)));
    }
  }, 60_000);
});
