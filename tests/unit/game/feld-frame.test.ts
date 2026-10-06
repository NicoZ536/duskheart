/**
 * The field and fishing views in the frame path (docs/SPIEL.md §30 "ohne Allokation je Frame", ADR-0142, ADR-0203; M7-19 …
 * M7-24): in steady state `FarmView.draw` over a field of plots with crops, wet soil and a crow, and `FishingView.draw` over a
 * line in the fight with fish traps beside it, allocate nothing per frame – measured with the sampling heap profiler like
 * `kreatur-zustand.test.ts` (windows after a warm-up, each re-warmed after its forced collection as ADR-0203 requires, the
 * median), the presentation time running, the simulation standing.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { createFarmFrame, FarmView, type FeldSession } from '../../../src/render/game/farming';
import { createFishingFrame, FishingView } from '../../../src/render/game/fishing';
import { RenderScene } from '../../../src/render/scene';
import { TILE_PX } from '../../../src/world/model/coords';
import { angelWelt, type AngelWelt } from './angel-testwelt';
import { FeldWelt, X0, Y0 } from './feld-testwelt';
import { OFFSET } from './interaktion-testwelt';

/** Warm-up frames (pools at their size, the JIT settled), then `WINDOWS` windows of `FRAMES` frames (the median counts). */
const WARMUP = 3000;
const FRAMES = 500;
const WINDOWS = 5;
/**
 * After the forced collection before every window (ADR-0203: it can throw away optimised code whose embedded maps died, and
 * the next frames run in the baseline tier): `REWARM_FRAMES` frames unsampled, `COMPILER_PAUSE_MS` for the background
 * compiler, `INSTALL_FRAMES` frames to install its code – then the window is sampled.
 */
const REWARM_FRAMES = 3 * FRAMES;
const COMPILER_PAUSE_MS = 200;
const INSTALL_FRAMES = 100;
const SAMPLING_INTERVAL = 16;
/** Limit [B per frame]: one number or record formed every frame (16 B and more) exceeds it. */
const MAX_BYTES_PER_FRAME = 2;

function atlas(): AtlasData {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return { manifest: manifestFromGenerated(mod), image: null } as unknown as AtlasData;
}

/** A farm session over the field world: a row of six spring crops a few days grown on moist soil. */
function farmSession(): { session: FeldSession; left: number; top: number } {
  const w = new FeldWelt();
  const crops = ['karotte', 'kartoffel', 'zwiebel', 'salat', 'erbse', 'weizen'];
  crops.forEach((crop, k) => w.feld(X0 + 4 + k, Y0 + 6).saeen(X0 + 4 + k, Y0 + 6, crop));
  w.tage(6);
  const f = w.farming;
  const session = {
    sim: w.sim,
    sampleFarmChunk: (layer, cx, cy) => f.chunkAt(layer, cx, cy),
    farmCrop: (index) => f.cropAt(index),
    sampleFishing: (out) => out,
    sampleFishTraps: () => [],
    sampleIceHoles: () => new Map(),
  } as FeldSession;
  return { session, left: X0 * TILE_PX, top: Y0 * TILE_PX };
}

/** A fishing session over the lake world: a line in the fight, two fish traps in the water. */
function fishingSession(): { session: FeldSession; w: AngelWelt } {
  const w = angelWelt();
  w.spawn(7, 5);
  w.inventory.give(w.sim, 'reuse', 2);
  w.hold('reuse');
  for (const [x, y] of [
    [8, 3],
    [9, 7],
  ] as const) {
    w.place(x, y + 1);
    w.run(1, [{ type: 'fishing.placeTrap', from: { bereich: 'schnellleiste', index: 0 }, tx: OFFSET + x, ty: OFFSET + y }]);
  }
  const holes = new Map();
  const session = {
    sim: w.sim,
    sampleFarmChunk: () => undefined,
    farmCrop: () => null,
    sampleFishing: (out) => w.fishing.sample(out),
    sampleFishTraps: (layer, cx, cy) => w.fishing.trapsIn(layer, cx, cy),
    sampleIceHoles: () => holes,
  } as FeldSession;
  return { session, w };
}

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

/** Bytes per frame of `frames` in steady state: the median of the windows, with their top allocation sites. */
async function bytesPerFrame(frames: (n: number, from: number) => void, test: RegExp): Promise<{ median: number; windows: string }> {
  frames(WARMUP, 0);
  const perFrame: number[] = [];
  const tops: string[] = [];
  // The presentation time runs on from window to window.
  let t = WARMUP;
  for (let w = 1; w <= WINDOWS; w++) {
    await inspector.post('HeapProfiler.collectGarbage');
    frames(REWARM_FRAMES, t);
    t += REWARM_FRAMES;
    await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
    frames(INSTALL_FRAMES, t);
    t += INSTALL_FRAMES;
    await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    frames(FRAMES, t);
    t += FRAMES;
    const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'frames' && test.test(f.url));
    perFrame.push(alloc.inPath / FRAMES);
    tops.push(JSON.stringify(alloc.top));
  }
  const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
  return { median, windows: `${perFrame.map((b) => b.toFixed(2)).join(' / ')}: ${tops.join(' | ')}` };
}

describe('Feld und Angel im Frame-Pfad ohne Allokation (§30, ADR-0142)', { timeout: 60_000 }, () => {
  it('FarmView: Pflanzen, feuchter Acker und Schädlinge kosten je Frame nichts', async () => {
    const { session, left, top } = farmSession();
    const view = new FarmView();
    const scene = new RenderScene();
    const f = createFarmFrame({ left, top, right: left + 30 * TILE_PX, bottom: top + 17 * TILE_PX });
    const a = atlas();
    const frames = (n: number, from: number): void => {
      for (let i = 0; i < n; i++) {
        scene.beginFrame(0);
        f.time = (from + i) / 60;
        view.draw(scene, a, session, f);
      }
    };
    const result = await bytesPerFrame(frames, /feld-frame\.test/);
    expect(view.drawn).toBeGreaterThanOrEqual(5);
    expect(result.median, result.windows).toBeLessThan(MAX_BYTES_PER_FRAME);
  });

  it('FishingView: Rute, Schnur, Pose im Drill und Reusen kosten je Frame nichts', async () => {
    const { session, w } = fishingSession();
    // Cast, bite and strike: the fight runs (the simulation then stands, the presentation time runs).
    w.spawn(7, 5);
    w.hold('angel_holz');
    const at = w.px(13, 5);
    w.run(1, [{ type: 'fishing.cast', x: at.x, y: at.y }]);
    for (let k = 0; k < 20 * 60 && w.fishing.phase !== 'biss'; k++) w.run(1);
    w.run(2, [{ type: 'fishing.reel', on: true }]);
    expect(w.fishing.phase).toBe('drill');
    const view = new FishingView();
    const scene = new RenderScene();
    const feet = w.px(7, 5);
    const rect = { left: feet.x - 15 * TILE_PX, top: feet.y - 9 * TILE_PX, right: feet.x + 15 * TILE_PX, bottom: feet.y + 9 * TILE_PX };
    const f = createFishingFrame(rect, { x: feet.x, y: feet.y, heightBase: 0 });
    f.hasFigure = true;
    const a = atlas();
    const frames = (n: number, from: number): void => {
      for (let i = 0; i < n; i++) {
        scene.beginFrame(0);
        f.time = (from + i) / 60;
        view.draw(scene, a, session, f);
      }
    };
    const result = await bytesPerFrame(frames, /feld-frame\.test/);
    expect(view.dots).toBeGreaterThan(10);
    expect(result.median, result.windows).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
