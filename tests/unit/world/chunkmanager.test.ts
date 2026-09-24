/**
 * Chunk streaming (docs/WORLD.md §5, M2-22): loading around the camera, unloading with hysteresis
 * per layer, synchronous `ensure`, worker/in-thread equality, budget per frame, changes surviving
 * unload/reload.
 */
import { describe, expect, it } from 'vitest';
import { JobQueue, createInProcessChannel, createRpcClient, createRpcServer, inThreadExecutor, workerExecutor } from '../../../src/engine/workerBridge';
import { chunkHash } from '../../../src/world/model/chunk';
import { packChunkId, type Layer } from '../../../src/world/model/coords';
import { ChunkManager } from '../../../src/world/stream/chunkManager';
import { STREAM_DEFAULTS, chunkDistance, resolveStreamConfig } from '../../../src/world/stream/config';
import { createChunkWorkerHandlers, type ChunkGenerateFn, type ChunkWorkerApi } from '../../../src/world/stream/worker';
import { FIXTURE_WORLD, fixtureGenerate, fixtureManager, manualClock, settle, type FixturePlan, type ManualClock } from './streamFixture';

/** Generator that counts calls per address and optionally costs time on a manual clock. */
function counting(clock?: ManualClock, costMs = 0): { generate: ChunkGenerateFn<FixturePlan>; calls: Map<string, number>; total: () => number } {
  const calls = new Map<string, number>();
  const generate: ChunkGenerateFn<FixturePlan> = (plan, layer, cx, cy) => {
    const key = `${layer}:${cx}:${cy}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    if (clock !== undefined) clock.ms += costMs;
    return fixtureGenerate(plan, layer, cx, cy);
  };
  return { generate, calls, total: () => [...calls.values()].reduce((a, b) => a + b, 0) };
}

function managerWith(generate: ChunkGenerateFn<FixturePlan>, options: { budgetMs?: number; clock?: ManualClock } = {}): ChunkManager<FixturePlan> {
  const clock = options.clock ?? manualClock();
  const jobs = new JobQueue(inThreadExecutor(createChunkWorkerHandlers(generate)), { frameBudgetMs: options.budgetMs ?? 1000, now: clock.now });
  return new ChunkManager({ plan: { seed: 7 }, generate, jobs, world: FIXTURE_WORLD });
}

function residentKeys(m: ChunkManager<FixturePlan>, layer?: Layer): string[] {
  const out: string[] = [];
  m.forEachResident((c) => {
    if (layer === undefined || c.layer === layer) out.push(c.key);
  });
  return out.sort();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('ChunkManager: loading around the camera', () => {
  it('loads the load square nearest first and stays inside the world', () => {
    const { generate, calls } = counting();
    const m = managerWith(generate, { budgetMs: 0 });
    const order: number[] = [];
    let frames = 0;
    while (frames === 0 || m.loadingCount > 0) {
      const before = new Set(residentKeys(m));
      m.update(0, 10, 10);
      for (const k of residentKeys(m)) {
        if (before.has(k)) continue;
        const [, x, y] = k.split(':').map(Number) as [number, number, number];
        order.push((x - 10) ** 2 + (y - 10) ** 2);
      }
      frames++;
    }
    expect(m.residentCount).toBe(81);
    expect(order).toHaveLength(81);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // One chunk per frame with a zero budget, after the init job.
    expect(frames).toBe(82);
    expect(Math.max(...calls.values())).toBe(1);

    const corner = managerWith(counting().generate);
    settle(corner, 0, 0, 0);
    expect(corner.residentCount).toBe(25);
    corner.forEachResident((c) => {
      expect(c.cx).toBeGreaterThanOrEqual(0);
      expect(c.cy).toBeGreaterThanOrEqual(0);
    });
  });

  it('unloads only beyond the hysteresis ring; walking back and forth reloads nothing', () => {
    const { generate, total } = counting();
    const m = managerWith(generate);
    settle(m, 0, 10, 10);
    expect(total()).toBe(81);
    settle(m, 0, 11, 10);
    expect(m.residentCount).toBe(90); // column x = 6 is at distance 5 = load radius + hysteresis: kept
    for (let i = 0; i < 6; i++) {
      settle(m, 0, 10, 10);
      settle(m, 0, 11, 10);
    }
    expect(total()).toBe(90);
    const s = m.update(0, 12, 10);
    expect(s.unloaded).toBe(9);
    m.forEachResident((c) => expect(chunkDistance(c.cx, c.cy, 12, 10)).toBeLessThanOrEqual(5));
  });

  it('uses per-layer radii and keeps the most recently left layer', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 10, 10);
    expect(m.residentOn(0)).toBe(81);
    settle(m, -1, 10, 10);
    expect(m.residentOn(-1)).toBe(49);
    expect(m.residentOn(0)).toBe(81);
    settle(m, -2, 10, 10);
    expect([m.residentOn(0), m.residentOn(-1), m.residentOn(-2)]).toEqual([0, 49, 49]);
    settle(m, 0, 10, 10);
    expect([m.residentOn(0), m.residentOn(-1), m.residentOn(-2)]).toEqual([81, 0, 49]);
  });

  it('cancels loads that fell out of the unload ring when the camera jumps', () => {
    const { manager: m } = fixtureManager({ budgetMs: 0 });
    m.update(0, 10, 10);
    expect(m.loadingCount).toBe(81);
    const s = m.update(0, 29, 29);
    expect(s.cancelled).toBe(81);
    expect(s.requested).toBe(49); // 29 ± 4 clipped to the 32-chunk world: 7 × 7
    settle(m, 0, 29, 29);
    expect(m.residentCount).toBe(49);
    m.forEachResident((c) => expect(chunkDistance(c.cx, c.cy, 29, 29)).toBeLessThanOrEqual(4));
  });

  it('never unloads pinned chunks; unpinned ones go with the next update', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 5, 5);
    const pinned = m.ensure(0, 5, 5);
    m.pin(pinned);
    settle(m, 0, 25, 25);
    expect(m.get(0, 5, 5)).toBe(pinned);
    expect(m.get(0, 5, 6)).toBeUndefined();
    m.unpin(pinned);
    m.update(0, 25, 25);
    expect(m.get(0, 5, 5)).toBeUndefined();
    expect(() => m.pin(pinned)).toThrow(/not resident/);
  });
});

describe('ChunkManager: synchronous ensure and executors', () => {
  it('ensure() loads in this thread, identical to the streamed chunk, and cancels its job', () => {
    const streamed = fixtureManager().manager;
    settle(streamed, 0, 10, 10);
    const { manager: m } = fixtureManager({ budgetMs: 0 });
    m.update(0, 10, 10); // init only; 81 loads queued
    expect(m.isLoading(0, 11, 12)).toBe(true);
    const c = m.ensure(0, 11, 12);
    expect(m.isLoading(0, 11, 12)).toBe(false);
    expect(m.syncLoads).toBe(1);
    expect(chunkHash(c)).toBe(chunkHash(streamed.get(0, 11, 12) as NonNullable<ReturnType<typeof streamed.get>>));
    settle(m, 0, 10, 10);
    expect(m.get(0, 11, 12)).toBe(c);
    expect(m.ensure(0, 11, 12)).toBe(c);
    expect(m.syncLoads).toBe(1);
    expect(() => m.ensure(0, 40, 0)).toThrow(/outside the world/);
  });

  it('streams identical chunks through a worker port and in-thread, in any order', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer(createChunkWorkerHandlers(fixtureGenerate), serverPort);
    const client = createRpcClient<ChunkWorkerApi<FixturePlan>>(clientPort);
    const jobs = new JobQueue(workerExecutor(client), { frameBudgetMs: 1, now: () => 0, maxInFlight: 3 });
    const viaWorker = new ChunkManager({ plan: { seed: 7 }, generate: fixtureGenerate, jobs, world: FIXTURE_WORLD });
    for (let f = 0; f < 400 && (f === 0 || viaWorker.loadingCount > 0); f++) {
      viaWorker.update(0, 20, 7);
      await flush();
    }
    expect(viaWorker.residentCount).toBe(81);
    const inThread = fixtureManager().manager;
    settle(inThread, 0, 16, 7); // different camera path: different load order
    settle(inThread, 0, 20, 7);
    viaWorker.forEachResident((c) => {
      const other = inThread.get(c.layer, c.cx, c.cy);
      expect(other).toBeDefined();
      expect(chunkHash(c)).toBe(chunkHash(other as typeof c));
    });
  });

  it('spends at most the frame budget (plus one job) per update', () => {
    const clock = manualClock();
    const { generate } = counting(clock, 3);
    const m = managerWith(generate, { budgetMs: 8, clock });
    const perFrame: number[] = [];
    for (let f = 0; f === 0 || m.loadingCount > 0; f++) {
      const s = m.update(0, 10, 10);
      perFrame.push(s.integrated);
      expect(s.jobMs).toBeLessThanOrEqual(8 + 3);
    }
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(3);
    expect(perFrame.reduce((a, b) => a + b, 0)).toBe(81);
  });

  it('reports a failing generator with the chunk address', () => {
    const generate: ChunkGenerateFn<FixturePlan> = (plan, layer, cx, cy) => {
      if (cx === 3 && cy === 4) throw new Error('Felsen im Weg');
      return fixtureGenerate(plan, layer, cx, cy);
    };
    const m = managerWith(generate);
    expect(() => m.update(0, 3, 3)).toThrow(/Loading chunk 0:3:4 failed: Felsen im Weg/);
    expect(() => m.update(0, 3, 3)).not.toThrow();
  });
});

describe('ChunkManager: changes across unloading', () => {
  it('keeps changes and frozen ticks of unloaded chunks in memory and restores them on reload', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 5, 5);
    const c = m.get(0, 5, 5) as NonNullable<ReturnType<typeof m.get>>;
    c.ground[10] = 5;
    c.setObject(11, 250);
    c.setObjectState(12, 1, 0.5, 777);
    c.frozenAtTick = 4321;
    const hash = chunkHash(c);
    const untouched = chunkHash(m.get(0, 6, 5) as typeof c);
    settle(m, 0, 25, 25);
    expect(m.get(0, 5, 5)).toBeUndefined();
    expect(m.unsavedUnloaded).toBe(1);
    settle(m, 0, 5, 5);
    const back = m.get(0, 5, 5) as typeof c;
    expect(back).not.toBe(c);
    expect(chunkHash(back)).toBe(hash);
    expect(back.frozenAtTick).toBe(4321);
    expect(chunkHash(m.get(0, 6, 5) as typeof c)).toBe(untouched);
    expect(m.unsavedUnloaded).toBe(0);
  });

  it('a chunk changed back to its generated state leaves nothing behind', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 5, 5);
    const c = m.get(0, 5, 5) as NonNullable<ReturnType<typeof m.get>>;
    const old = c.ground[10] as number;
    c.ground[10] = old + 1;
    c.ground[10] = old;
    settle(m, 0, 25, 25);
    expect(m.unsavedUnloaded).toBe(0);
    expect(m.collectChanges().writes).toEqual([]);
  });

  it('forgetStorage: a save into a store without this world lists every change – seeded, unloaded and resident', () => {
    const first = fixtureManager().manager;
    settle(first, 0, 5, 5);
    (first.get(0, 5, 5) as NonNullable<ReturnType<typeof first.get>>).ground[3] = 7;
    (first.get(0, 6, 5) as NonNullable<ReturnType<typeof first.get>>).ground[4] = 8;
    const saved = first.collectChanges();
    first.markSaved(saved);
    expect(saved.writes.map((w) => w.key)).toEqual(['0:5:5', '0:6:5']);
    const diffs = saved.writes.map((w) => w.diff as NonNullable<typeof w.diff>);
    // Seeded with that save, resident around the saved chunks, one more change on 7,5 (unloaded again).
    const m = fixtureManager().manager;
    m.loadStored(diffs);
    settle(m, 0, 5, 5);
    (m.get(0, 7, 5) as NonNullable<ReturnType<typeof m.get>>).ground[5] = 9;
    settle(m, 0, 25, 25);
    settle(m, 0, 5, 5);
    expect(m.collectChanges().writes.map((w) => w.key)).toEqual(['0:7:5']);
    m.forgetStorage();
    const all = m.collectChanges();
    expect(all.writes.map((w) => w.key)).toEqual(['0:5:5', '0:6:5', '0:7:5']);
    expect(all.writes.every((w) => w.diff !== null)).toBe(true);
    m.markSaved(all);
    expect(m.collectChanges().writes).toEqual([]);
    // Seeded and never near the saved chunks: their diffs are written from the seed.
    const far = fixtureManager().manager;
    far.loadStored(diffs);
    settle(far, 0, 25, 25);
    expect(far.collectChanges().writes).toEqual([]);
    far.forgetStorage();
    expect(far.collectChanges().writes.map((w) => w.key)).toEqual(['0:5:5', '0:6:5']);
    expect(far.contentHash()).toBe(first.contentHash());
  });

  it('content hash depends on the changes, not on residency or load order', () => {
    const a = fixtureManager().manager;
    const b = fixtureManager().manager;
    settle(a, 0, 5, 5);
    settle(b, 0, 8, 8);
    settle(b, 0, 5, 5);
    const pristine = a.contentHash();
    expect(b.contentHash()).toBe(pristine);
    for (const m of [a, b]) (m.get(0, 6, 6) as NonNullable<ReturnType<typeof m.get>>).ground[0] = 5;
    expect(a.contentHash()).not.toBe(pristine);
    expect(b.contentHash()).toBe(a.contentHash());
    settle(b, 0, 25, 25); // the changed chunk of b is unloaded now
    expect(b.get(0, 6, 6)).toBeUndefined();
    expect(b.contentHash()).toBe(a.contentHash());
  });
});

describe('stream config', () => {
  it('defaults put the active zone inside every load square', () => {
    const c = resolveStreamConfig();
    expect(c).toEqual(STREAM_DEFAULTS);
    for (const r of c.loadRadius) expect(r).toBeGreaterThanOrEqual(c.activeRadius + 1);
    expect(packChunkId(0, 0, 0)).toBe(packChunkId(0, 0, 0));
  });

  it('rejects inconsistent values', () => {
    expect(() => resolveStreamConfig({ loadRadius: [2, 3, 3, 3] })).toThrow(/activeRadius \+ 1/);
    expect(() => resolveStreamConfig({ loadRadius: [4, 3, 3] })).toThrow(/one value per layer/);
    expect(() => resolveStreamConfig({ activeRadius: -1 })).toThrow(RangeError);
    expect(() => resolveStreamConfig({ retainedLayers: 4 })).toThrow(RangeError);
    expect(() => resolveStreamConfig({ jobFrameBudgetMs: Number.NaN })).toThrow(RangeError);
    expect(() => resolveStreamConfig({ maxJobsInFlight: 0 })).toThrow(RangeError);
  });
});
