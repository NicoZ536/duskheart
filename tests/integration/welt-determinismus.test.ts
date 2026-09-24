/**
 * M2-GATE, MASTERPROMPT §32 „Determinismus über 20 Seeds“ (§9.2 „gleicher Seed ⇒ identischer Hash
 * aller Chunk-Daten“, §31.1 „Weltgen-Hash-Snapshots“).
 *
 * For 20 seeds and every world size the world is generated twice – once in this thread, once in a
 * Node worker thread running the real world-worker module (its own isolate: no module state, cache or
 * JIT state is shared) – and the two must agree:
 * - the world hash (plan, places, roads, bridges, deposits, underground plan, validation report) in
 *   Klein, Mittel and Groß;
 * - for Klein additionally the chunk data: every 5th surface chunk and every 16th chunk of each
 *   underground layer, generated in opposite orders (row order here, reverse order in the worker).
 * Distinct seeds give distinct worlds, and every Klein world passes its validation.
 *
 * The world hashes are pinned as a snapshot: a platform or engine difference, or an unintended
 * generator change, fails here. A deliberate generator change bumps `WORLD_GEN_VERSION` (or
 * `PLAN_VERSION`) and updates the snapshot (`npx vitest run --project integration -u`).
 */
import { MessageChannel, Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorldSizePreset } from '../../src/content/balance';
import { createRpcClient, type RpcClient, type RpcPort } from '../../src/engine/workerBridge';
import { generateChunk } from '../../src/world/gen/chunk';
import { requestWorld, type WorldWorkerApi, type WorldWorkerEvents } from '../../src/world/gen/worker';
import { generateWorld, worldHash } from '../../src/world/gen/world';
import { chunkHash } from '../../src/world/model/chunk';
import type { Layer } from '../../src/world/model/coords';
import { worldDimensions } from '../../src/world/model/worldSize';

/** 20 seeds spread over the 32-bit range (none of them used by the unit tests). */
const SEEDS = Array.from({ length: 20 }, (_, i) => (97 + i * 214_748_357) >>> 0);
const SIZES: readonly WorldSizePreset[] = ['small', 'medium', 'large'];
/** Every how many surface chunks of a Klein world are compared (205 of 1 024, spread over rows and columns). */
const SURFACE_STEP = 5;
/** Every how many chunks of each underground layer are compared (64 of 1 024 per layer). */
const UNDERGROUND_STEP = 16;
const UNDERGROUND: readonly Layer[] = [-1, -2, -3];

/** The chunks compared for a Klein world: [layer, cx, cy]. */
function sampleChunks(): Array<readonly [Layer, number, number]> {
  const n = worldDimensions('small').chunks;
  const out: Array<readonly [Layer, number, number]> = [];
  for (let id = 0; id < n * n; id += SURFACE_STEP) out.push([0, id % n, Math.floor(id / n)]);
  for (const layer of UNDERGROUND) for (let id = 3; id < n * n; id += UNDERGROUND_STEP) out.push([layer, id % n, Math.floor(id / n)]);
  return out;
}

describe('Determinismus über 20 Seeds (Hauptthread = Worker-Thread)', () => {
  let worker: Worker;
  let channel: MessageChannel;
  let client: RpcClient<WorldWorkerApi, WorldWorkerEvents>;

  beforeAll(() => {
    channel = new MessageChannel();
    // The thread loads the real worker module through tsx (as the browser loads world.worker.ts through Vite).
    const entry = new URL('../../src/world/gen/worker.ts', import.meta.url).href;
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

  it('gleicher Seed ⇒ identische Welt in jeder Größe und identische Chunk-Daten (Klein), verschiedene Seeds ⇒ verschiedene Welten', async () => {
    const samples = sampleChunks();
    const hashes: Record<string, Record<WorldSizePreset, string>> = {};
    const all = new Set<string>();
    for (const seed of SEEDS) {
      const row = {} as Record<WorldSizePreset, string>;
      for (const size of SIZES) {
        // The worker generates while this thread generates the same world.
        const remote = requestWorld(client, seed, size);
        const local = generateWorld(seed, size);
        const h = worldHash(local);
        expect(worldHash(await remote), `Seed ${seed} ${size}: Welt-Hash Worker ≠ Hauptthread`).toBe(h);
        row[size] = h;
        all.add(h);
        if (size !== 'small') continue;
        expect(local.report.problems, `Seed ${seed}: Validierung`).toEqual([]);
        // Chunk data: row order here, reverse order in the worker (which holds the world it generated).
        const localChunks = samples.map(([layer, cx, cy]) => chunkHash(generateChunk(local, layer, cx, cy)));
        const remoteChunks: string[] = new Array<string>(samples.length);
        for (let i = samples.length - 1; i >= 0; i--) {
          const [layer, cx, cy] = samples[i] as readonly [Layer, number, number];
          remoteChunks[i] = (await client.call('load', { layer, cx, cy, diff: null })).hash;
        }
        expect(remoteChunks, `Seed ${seed}: Chunk-Hashes Worker ≠ Hauptthread`).toEqual(localChunks);
      }
      hashes[String(seed)] = row;
    }
    // 20 seeds × 3 sizes: 60 different worlds.
    expect(all.size).toBe(SEEDS.length * SIZES.length);
    expect(hashes).toMatchSnapshot();
  });
});
