/**
 * M7-151: `DropSystem.update` runs every tick over every dropped item in the zone. Per drop – pieces resting for E, small
 * items beyond the magnet's reach, items still settling – a tick allocates nothing: the loop body passes no fractional number
 * through a call (the flight through `dropFlightPointIn`, the pull through `magnetStepIn`, ADR-0274). What a tick costs
 * independent of the drops (the prologue's scalars, as V8's tier of the moment boxes them – ≈ 120 B in this harness) is
 * measured and reported with the loop body's share, not budgeted here (open, see the strand report).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation, type PathAllocation } from '../../../tools/bench/heap';
import { BALANCE } from '../../../src/content/balance';
import { newStack } from '../../../src/game/items/stack';
import { TILE_PX } from '../../../src/world/model/coords';
import { centre, field, gatherCatalog, gatherWorld, type GatherWorld } from './interaktion-testwelt';

const SAMPLING_INTERVAL = 32;
const COMPILER_PAUSE_MS = 200;
const MAX_WINDOWS = 4;
/** Ticks of a measured window. */
const TICKS = 1200;
/** Drops collected in the pickup window (one spawned every `PICKUP_EVERY` ticks: flight, settling and the pull take ≈ 1 s). */
const PICKUPS = 30;
const PICKUP_EVERY = 90;
const catalog = gatherCatalog();
const I = BALANCE.interaction;
const D = I.drops;
/** Ticks until a spawned drop has flown and settled. */
const LANDED_TICKS = Math.ceil((D.flightSeconds + D.settleSeconds) * BALANCE.time.tickHz) + 10;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/** Bytes allocated below `DropSystem.update` while `run` runs, best of up to `MAX_WINDOWS` windows (the optimising compiler needs a few). */
async function measure(run: () => void, divisor: number, accept: (per: number) => boolean): Promise<{ best: number; windows: string[] }> {
  const windows: Array<{ per: number; alloc: PathAllocation }> = [];
  do {
    if (windows.length > 0) await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
    run();
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'update' && /drops\/system/.test(f.url));
    windows.push({ per: alloc.inPath / divisor, alloc });
  } while (!accept((windows[windows.length - 1] as { per: number }).per) && windows.length < MAX_WINDOWS);
  return { best: Math.min(...windows.map((w) => w.per)), windows: windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(2)} B ${JSON.stringify(w.alloc.top)}`) };
}

function spawnAt(w: GatherWorld, item: string, count: number, x: number, y: number): number {
  return w.drops.spawn(w.sim, newStack(catalog.get(item), count), 0, x, y, x, y);
}

describe('DropSystem.update ohne Müll je Tick (M7-151)', { timeout: 60_000 }, () => {
  /** A world with `pieces` single pieces within reach and `small` small items beyond it, all landed and settled. */
  function restingWorld(pieces: number, small: number): GatherWorld {
    const w = gatherWorld(field(16, 16));
    w.place(8, 8);
    const p = centre(8, 8);
    const radius = I.magnetRadiusTiles * TILE_PX;
    // Each drop lands up to 1,25 tiles from its spot: spots 2,5 tiles apart (no landing merge), small items a flight beyond reach.
    for (let i = 0; i < pieces; i++) spawnAt(w, 'probe_speer', 1, p.x + (i - pieces / 2) * 40, p.y + 12 + 40 * Math.floor(i / 6));
    for (let i = 0; i < small; i++) spawnAt(w, 'feuerstein', 2, p.x + radius + 24 + (i % 6) * 40, p.y - 60 - 40 * Math.floor(i / 6));
    w.run(LANDED_TICKS);
    expect(w.drops.count).toBe(pieces + small);
    return w;
  }

  it('resting pieces for E and small items out of reach cost nothing per drop and tick (the loop body)', async () => {
    const few = restingWorld(4, 6);
    const many = restingWorld(12, 18);
    const runFew = (): void => {
      few.run(TICKS);
    };
    const runMany = (): void => {
      many.run(TICKS);
    };
    runFew();
    runFew();
    runMany();
    runMany();
    const a = await measure(runFew, TICKS, (per) => per < 1);
    const b = await measure(runMany, TICKS, (per) => per < 1);
    expect(few.drops.count).toBe(10);
    expect(many.drops.count).toBe(30);
    // 20 drops more: the loop body's share per drop and tick.
    const perDrop = (b.best - a.best) / 20;
    console.info(`DropSystem.update: ${a.best.toFixed(1)} B/Tick bei 10, ${b.best.toFixed(1)} B/Tick bei 30 Drops → ${perDrop.toFixed(2)} B je Drop und Tick`);
    expect(perDrop, `${a.windows.join('; ')} | ${b.windows.join('; ')}`).toBeLessThan(1);
  });

  it('a pulled drop flies, is pulled and collected within the cadence; its pickup emits the events of a pickup', () => {
    const w = gatherWorld(field(16, 16));
    w.place(8, 8);
    const p = centre(8, 8);
    let collected = 0;
    for (let k = 0; k < PICKUPS; k++) {
      spawnAt(w, 'feuerstein', 1, p.x + 4, p.y);
      const ev = w.run(PICKUP_EVERY);
      collected += (ev.get('dropPickedUp') ?? []).length;
    }
    expect(collected).toBe(PICKUPS);
    expect(w.drops.count).toBe(0);
    expect(w.inventory.count('feuerstein')).toBe(PICKUPS);
  });
});
