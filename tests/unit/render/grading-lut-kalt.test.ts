/**
 * M7-131: the grading LUT build from cold. The first build of a page trains the two inner functions of the build
 * (`lutCurveNode`, `lutTexel`) past V8's optimisation count with every branch taken; from then on a build allocates nothing
 * even when the grade brings a term the builds before did not have – a walk across biomes switches saturation, split toning
 * and contrast on and off. Before, every such switch deoptimised the build and cost thousands of interpreted texels: on the
 * route of fluessiges-laufen.spec.ts 3,1 MB per 55 s survived the scavenger from the build. Measured in a module of its own
 * (this file loads grading.ts cold): the builds after the first, in windows of a route-like grade sequence.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { createGrading, generateGradingLut, GRADING_INDEX, GRADING_LUT_BYTES, GRADING_LUT_SIZE } from '../../../src/render/post/grading';

const SAMPLING_INTERVAL = 64;
const COMPILER_PAUSE_MS = 200;
const INSTALL_BUILDS = 10;
/**
 * Rounds of pause and install builds at most, until the loading screen's builds allocate nothing (the background compiler's
 * lag grows with the machine's load; the probe measures the builds of the loading screen's own grade, which trains no
 * branch the warm-up did not train – a build without the warm-up would still deoptimise in the first window).
 */
const SETTLE_ROUNDS = 10;
/** Builds per window, windows measured. */
const WINDOW_BUILDS = 20;
const WINDOWS = 4;
/** Limit [B per build] in every window after the first build: one interpreted texel costs ≈ 500 B, a deoptimised build ≈ 190 KB. */
const MAX_BYTES_PER_BUILD = 1024;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/** The builds of the running sample (`route` is the frame the profile is read below). */
let routeBody: () => void = () => undefined;
function route(): void {
  routeBody();
}

/** Bytes per build allocated below `route` while `body` runs its `builds` builds. */
async function sampled(body: () => void, builds: number): Promise<{ per: number; top: unknown }> {
  routeBody = body;
  await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
  route();
  const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
  const alloc = pathAllocation(profile, (f) => f.functionName === 'route' && /grading-lut-kalt/.test(f.url));
  return { per: alloc.inPath / builds, top: alloc.top };
}

/** The grade of build `k` on a walk across biomes: saturation, split toning, contrast and the channel terms come and go. */
function routeGrade(k: number): Float32Array {
  const p = createGrading();
  const I = GRADING_INDEX;
  const phase = k % 6;
  if (phase === 1 || phase === 4) p[I.saturation] = 0.9 + 0.01 * (k % 7);
  if (phase === 2 || phase === 4) {
    p[I.shadowR] = 0.05;
    p[I.shadowB] = 0.2;
    p[I.shadowAmount] = 0.3 + 0.001 * k;
    p[I.highlightG] = 0.2;
    p[I.highlightAmount] = 0.2;
  }
  if (phase === 3 || phase === 5) p[I.contrast] = 1.05 + 0.001 * k;
  if (phase === 5) {
    p[I.gammaG] = 0.95;
    p[I.liftR] = 0.02;
    p[I.exposure] = 0.1 + 0.001 * k;
    p[I.temperature] = 0.2;
  }
  return p;
}

describe('Grading-LUT von kalt (M7-131)', () => {
  it('after the first build (the warm-up) every build of a walk across biomes allocates nothing, whatever terms it brings', async () => {
    const out = new Uint8Array(GRADING_LUT_BYTES);
    // The grades of the walk, drawn before the measurement (the windows measure the builds alone).
    const grades: Float32Array[] = [];
    for (let k = 0; k <= WINDOWS * WINDOW_BUILDS; k++) grades.push(routeGrade(k));
    // The first build of the page: the warm-up runs inside it (interpreted calls of the inner functions, once). Then the
    // pause for the background compiler and the builds that install its code (ADR-0203), repeated until the loading
    // screen's builds allocate nothing – in the game, frames of the loading screen's one grade pass between the first build
    // and the walk.
    const loading = grades[0] as Float32Array;
    generateGradingLut(loading, out, GRADING_LUT_SIZE);
    let settleRounds = 0;
    let settled = false;
    while (!settled && settleRounds < SETTLE_ROUNDS) {
      settleRounds++;
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      for (let k = 0; k < INSTALL_BUILDS; k++) generateGradingLut(loading, out, GRADING_LUT_SIZE);
      const probe = await sampled(() => {
        for (let k = 0; k < INSTALL_BUILDS; k++) generateGradingLut(loading, out, GRADING_LUT_SIZE);
      }, INSTALL_BUILDS);
      settled = probe.per === 0;
    }
    let build = 1;
    const windows: Array<{ per: number; top: unknown }> = [];
    for (let w = 0; w < WINDOWS; w++) {
      const from = build;
      windows.push(
        await sampled(() => {
          for (; build < from + WINDOW_BUILDS; build++) generateGradingLut(grades[build] as Float32Array, out, GRADING_LUT_SIZE);
        }, WINDOW_BUILDS),
      );
    }
    const report = `settled after ${settleRounds} round(s); ${windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(0)} B/build ${JSON.stringify(w.top)}`).join('; ')}`;
    for (const w of windows) expect(w.per, report).toBeLessThan(MAX_BYTES_PER_BUILD);
  });
});
