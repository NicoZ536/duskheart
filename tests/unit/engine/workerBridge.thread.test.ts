/**
 * M2-02 acceptance: the same jobs through a real worker thread (Node `worker_threads`, entry
 * `workerBridgeFixture.worker.ts`) and through the in-thread fallback give identical results.
 */
import { MessageChannel, Worker, threadId } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobQueue, RpcError, createRpcClient, inThreadExecutor, workerExecutor, type RpcClient, type RpcPort } from '../../../src/engine/workerBridge';
import { chunkHash } from '../../../src/world/model/chunk';
import { diffChunk, type ChunkDiff } from '../../../src/world/stream/diff';
import { createChunkWorkerHandlers, type ChunkLoadRequest, type ChunkWorkerApi, type LoadedChunk } from '../../../src/world/stream/worker';
import { fixtureGenerate, type FixturePlan } from '../world/streamFixture';
import type { FixtureThreadApi, FixtureThreadEvents } from './workerBridgeFixture.worker';

const PLAN: FixturePlan = { seed: 11 };

let worker: Worker;
let channel: MessageChannel;
let client: RpcClient<FixtureThreadApi, FixtureThreadEvents>;

beforeAll(async () => {
  channel = new MessageChannel();
  // Node strips types natively but does not resolve extensionless TS imports: the thread loads the
  // entry through tsx's loader, as the browser loads it through Vite.
  const entry = new URL('./workerBridgeFixture.worker.ts', import.meta.url).href;
  const bootstrap = `import('tsx/esm/api').then((tsx) => tsx.tsImport(${JSON.stringify(entry)}, ${JSON.stringify(entry)}))`;
  worker = new Worker(bootstrap, { eval: true, workerData: { port: channel.port2 }, transferList: [channel.port2] });
  client = createRpcClient<FixtureThreadApi, FixtureThreadEvents>(channel.port1 as unknown as RpcPort);
  await client.call('init', PLAN);
}, 30_000);

afterAll(async () => {
  client.dispose();
  channel.port1.close();
  await worker.terminate();
});

/** A modified copy of a chunk as diff (so loads exercise diff application in both executors). */
function someDiff(cx: number, cy: number): ChunkDiff {
  const base = fixtureGenerate(PLAN, 0, cx, cy);
  const cur = base.clone();
  cur.ground.fill(2, 100, 180);
  cur.setObject(33, 777);
  cur.setObjectState(34, 1, 0.75, 5000);
  return diffChunk(base, cur) as ChunkDiff;
}

function requests(): ChunkLoadRequest[] {
  const out: ChunkLoadRequest[] = [];
  for (let i = 0; i < 40; i++) {
    const layer = i % 5 === 0 ? -2 : 0;
    const cx = (i * 7) % 32;
    const cy = (i * 3) % 32;
    out.push({ layer, cx, cy, diff: layer === 0 && i % 4 === 1 ? someDiff(cx, cy) : null });
  }
  return out;
}

function fingerprint(l: LoadedChunk): string {
  return [l.layer, l.cx, l.cy, l.hash, Buffer.from(l.tiles).toString('base64'), Buffer.from(l.baseline).toString('base64'), Array.from(l.objects).join(','), Array.from(l.baselineObjects).join(',')].join('|');
}

async function runAll(queue: JobQueue<ChunkWorkerApi<FixturePlan>>, list: readonly ChunkLoadRequest[]): Promise<string[]> {
  const out = new Array<string>(list.length);
  list.forEach((request, i) => queue.submit('load', [request], { priority: i, onDone: (l) => (out[i] = fingerprint(l)) }));
  await queue.drain(10_000);
  return out;
}

describe('worker thread vs in-thread', () => {
  it('runs in another thread', async () => {
    expect(await client.call('threadId')).not.toBe(threadId);
  });

  it('gives identical chunk loads (tiles, baseline, object states, hash)', async () => {
    const list = requests();
    const viaWorker = await runAll(new JobQueue(workerExecutor(client), { frameBudgetMs: 4, now: () => performance.now(), maxInFlight: 4 }), list);
    const handlers = createChunkWorkerHandlers(fixtureGenerate);
    handlers.init(PLAN);
    const inThread = await runAll(new JobQueue(inThreadExecutor(handlers), { frameBudgetMs: 4, now: () => performance.now() }), list);
    expect(viaWorker).toHaveLength(40);
    expect(viaWorker).toEqual(inThread);
    // And both equal generating directly in this thread.
    const direct = fixtureGenerate(PLAN, -2, 0, 0);
    expect(viaWorker[0]?.split('|')[3]).toBe(chunkHash(direct));
  }, 30_000);

  it('moves transferred result buffers into this thread', async () => {
    const loaded = await client.call('load', { layer: 0, cx: 3, cy: 4, diff: null });
    expect(loaded.tiles.byteLength).toBe(8192);
    expect(loaded.hash).toBe(chunkHash(fixtureGenerate(PLAN, 0, 3, 4)));
  });

  it('streams typed progress events of a long job', async () => {
    const seen: number[] = [];
    const off = client.on('progress', (p) => seen.push(p.done));
    const hashes = await client.call('sweep', 5, 64);
    off();
    expect(hashes).toHaveLength(64);
    expect(hashes[40]).toBe(chunkHash(fixtureGenerate({ seed: 5 }, 0, 8, 1)));
    expect(seen).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  });

  it('propagates errors across the thread boundary', async () => {
    const wrongAddress = someDiff(1, 1);
    const err = await client.call('load', { layer: 0, cx: 2, cy: 1, diff: wrongAddress }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).remoteName).toBe('RangeError');
    expect((err as RpcError).message).toContain('applyChunkDiff');
  });
});
