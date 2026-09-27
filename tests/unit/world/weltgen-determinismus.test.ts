/**
 * M2-14 acceptance: world generation in the worker with progress. The determinism hashes (same seed ⇒
 * identical world and chunk hashes) and the 20-seed validation sweep run in the integration project
 * (`tests/integration/weltgen-determinismus.test.ts`, M4-37, ADR-0036).
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
import { requestWorld, type WorldWorkerApi, type WorldWorkerEvents } from '../../../src/world/gen/worker';
import { generateWorld, worldHash, WORLD_GEN_STEPS, type GeneratedWorld, type WorldGenProgress } from '../../../src/world/gen/world';

/** §30: "neue Welt Mittel spielbar ≤ 8 s". */
const PLAYABLE_BUDGET_MS = 8000;
/** Chunk radius around the spawn that must exist before play starts (streaming radius 4, ADR-0020). */
const START_RADIUS_CHUNKS = 4;

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
