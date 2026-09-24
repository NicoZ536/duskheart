/**
 * Render benchmarks (MASTERPROMPT §30): draw calls, JS render preparation and whole frame CPU time,
 * heap and console errors of screenshot scenarios in Chromium, plus the allocation of the renderer's
 * frame path in Node (`framePath.ts`).
 *
 * Under headless Chromium the WebGL commands run on SwiftShader, a CPU rasteriser in the GPU process:
 * GPU times and the frame rate say nothing about real hardware (§30 checks GPU times in the F3
 * overlay). The WebGL calls themselves are queued asynchronously to that process, so the JS times of
 * the page – render preparation and frame CPU – are measured as on a real GPU.
 */
import { Session } from 'node:inspector/promises';
import type { RenderSceneId } from '../../src/render/scenes/ids';
import { openGame, startBrowserSession, type BrowserSession } from '../lib/browser';
import type { FramePathMeasurement, measureFramePath } from './framePath';
import { heapProfileOf, type HeapProfile } from './heap';
import type { Measurement } from './thresholds';

export interface RenderBenchResult {
  frames: number;
  drawCallsMax: number;
  spriteDrawCallsMax: number;
  spritesMax: number;
  lightsMax: number;
  particlesMax: number;
  prepMsP95: number;
  frameMsP95: number;
  heapMb: number;
}

export interface RenderScenario {
  /** Scenario name in the report and the threshold file. */
  readonly name: string;
  /** Screenshot scenario loaded in the page (`?scenario=`). */
  readonly scenario: string;
  readonly frames: number;
  /**
   * Content the scenario must show (sprites, point lights). Measured as the shortfall (`… missing`,
   * budget 0), so a scene that silently draws less cannot pass the time budgets.
   */
  readonly expect?: { readonly sprites?: number; readonly lights?: number };
}

/** Frames measured after the scenario reports ready (2 s at 60 Hz: p95 over 120 samples). */
const BENCH_FRAMES = 120;
/**
 * Animated frames rendered and discarded before the measurement (2 s at 60 Hz): the first frames
 * after loading still run the frame path in V8's lower tiers (Ignition, Sparkplug, Maglev) and
 * upload the atlas; the budgets of §30 are about the steady state – as in the frame-path bench.
 */
const WARMUP_FRAMES = 120;

export const RENDER_SCENARIOS: readonly RenderScenario[] = [
  { name: 'render:testszene', scenario: 'testszene', frames: BENCH_FRAMES },
  // M1-24: 5 000 animated sprites + 32 point lights (the stress scene of M1-12 at night).
  { name: 'render:sprites-5000', scenario: 'sprites-5000', frames: BENCH_FRAMES, expect: { sprites: 5000, lights: 32 } },
];

/**
 * M1-12 „Heap-Profil zeigt keine Allokation im Frame-Pfad“: the renderer's frame path per scene in
 * Node (`framePath.ts`), sampled with the heap profiler of `node:inspector`.
 */
export const FRAME_PATH_BENCH = {
  name: 'render:frame-pfad',
  scenes: ['sprites-5000', 'gruenhain', 'welt-ui', 'normalmap-licht', 'palette'] as const satisfies readonly RenderSceneId[],
  /** At least 600 frames and 2 s per scene before sampling (pools grown, JIT settled), at most 20 000 frames. */
  warmup: { frames: 600, ms: 2000, maxFrames: 20_000 },
  /** Sampled frames per scene (5 s at 60 Hz). */
  frames: 300,
} as const;

/** Mean bytes between two samples of the heap profiler (small: almost every allocation is seen). */
const HEAP_SAMPLING_INTERVAL = 16;

/** The metric name of the frame-path allocation of `scene`. */
export function framePathMetric(scene: string): string {
  return `Allokation je Frame (${scene})`;
}

async function runFramePath(session: BrowserSession): Promise<Measurement[]> {
  const mod = (await session.server.ssrLoadModule('/tools/bench/framePath.ts')) as { measureFramePath: typeof measureFramePath };
  const inspector = new Session();
  inspector.connect();
  try {
    await inspector.post('HeapProfiler.enable');
    const profile = async (run: () => void): Promise<HeapProfile> => {
      await inspector.post('HeapProfiler.collectGarbage');
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: HEAP_SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      run();
      return heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    };
    const results: FramePathMeasurement[] = await mod.measureFramePath({ root: process.cwd(), scenes: FRAME_PATH_BENCH.scenes, warmup: FRAME_PATH_BENCH.warmup, frames: FRAME_PATH_BENCH.frames, profile });
    for (const r of results) {
      const hot = r.top.map((t) => `${t.frame} ${Math.round(t.bytes / r.frames)} B`).join(', ');
      console.log(`bench: Frame-Pfad ${r.scene} (${r.sprites} Sprites, ${r.lights} Lichter, ${r.worldUi} Welt-UI): ${r.bytesPerFrame.toFixed(0)} B je Frame${hot ? ` – ${hot}` : ''}`);
    }
    return results.map((r) => ({ scenario: FRAME_PATH_BENCH.name, metric: framePathMetric(r.scene), value: r.bytesPerFrame, unit: 'B' }));
  } finally {
    inspector.disconnect();
  }
}

export async function runRenderScenarios(list: readonly RenderScenario[]): Promise<Measurement[]> {
  const out: Measurement[] = [];
  const session = await startBrowserSession();
  try {
    out.push(...(await runFramePath(session)));
    for (const s of list) {
      const { page, errors } = await openGame(session, `scenario=${s.scenario}`, { width: 1920, height: 1080 });
      await page.waitForFunction(() => (window as unknown as { __dh: { call(name: 'scenarioReady'): boolean } }).__dh.call('scenarioReady') === true, undefined, { timeout: 90_000 });
      const r = await page.evaluate(
        async ([warmup, frames]) => {
          const dh = (window as unknown as { __dh: { call(name: 'benchRender', n: number): Promise<RenderBenchResult> } }).__dh;
          await dh.call('benchRender', warmup);
          return dh.call('benchRender', frames);
        },
        [WARMUP_FRAMES, s.frames] as const,
      );
      out.push(
        { scenario: s.name, metric: 'draw calls (max)', value: r.drawCallsMax, unit: '' },
        { scenario: s.name, metric: 'render prep p95', value: r.prepMsP95, unit: 'ms' },
        { scenario: s.name, metric: 'frame CPU p95', value: r.frameMsP95, unit: 'ms' },
        { scenario: s.name, metric: 'JS heap', value: r.heapMb, unit: 'MB' },
        { scenario: s.name, metric: 'console errors', value: errors.length, unit: '' },
      );
      if (s.expect?.sprites !== undefined) {
        out.push(
          { scenario: s.name, metric: 'sprite draw calls (max)', value: r.spriteDrawCallsMax, unit: '' },
          { scenario: s.name, metric: 'sprites missing', value: Math.max(0, s.expect.sprites - r.spritesMax), unit: '' },
        );
      }
      if (s.expect?.lights !== undefined) out.push({ scenario: s.name, metric: 'lights missing', value: Math.max(0, s.expect.lights - r.lightsMax), unit: '' });
      if (errors.length > 0) console.error(errors.join('\n'));
      await page.close();
    }
  } finally {
    await session.close();
  }
  return out;
}
