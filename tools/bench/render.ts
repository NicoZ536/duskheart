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
import { STRESS_PARTICLES } from '../../src/render/scenes/ids';
import { openGame, startBrowserSession, type BrowserSession } from '../lib/browser';
import type { FramePathMeasurement, FramePathSceneId, measureFramePath } from './framePath';
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
  readonly expect?: { readonly sprites?: number; readonly lights?: number; readonly particles?: number };
}

/** Frames measured after the scenario reports ready (2 s at 60 Hz: p95 over 120 samples). */
const BENCH_FRAMES = 120;
/**
 * Animated frames rendered and discarded before the measurement (2 s at 60 Hz): the first frames
 * after loading still run the frame path in V8's lower tiers (Ignition, Sparkplug, Maglev) and
 * upload the atlas; the budgets of §30 are about the steady state – as in the frame-path bench.
 */
const WARMUP_FRAMES = 120;
/**
 * Measured windows per scenario. The page's JS times are wall time: next to SwiftShader on four cores the main
 * thread sometimes waits for a core, and a single window's p95 then carries that wait (M4 gate: `sprites-5000`
 * render prep p95 1.4 / 2.7 / 1.7 / 1.6 / 4.0 ms in five verify runs of the same code). The time budgets judge
 * the median of the windows' p95 – a slower frame path shifts every window, a burst of contention one; counts
 * (draw calls, heap, sprites and lights shown) judge the worst window. Every window is reported.
 */
const BENCH_WINDOWS = 3;
/**
 * Frames rendered and discarded right before each measured window (M6-81). `benchRender` starts the frozen scenario's clock
 * anew with every call, so the first frame of a window steps back by the length of the window before it (two seconds). A
 * pass with a state over time takes that for a jump and starts over – the GPU particles simulate their prewarm in that one
 * frame (five seconds: ten feedback passes of 15 sub-steps each over every particle; in `partikel-20000` 8–15 ms render
 * preparation and 40 instead of 31 draw calls, and the passes queued in the software rasteriser behind it) –, work that no
 * frame of the steady state does. The discarded frame takes the jump; the window continues from its time.
 */
const SETTLE_FRAMES = 1;
/** Point lights of the night camp in `hoch-gruenhain-nacht`: camp fire, torch on its stake, torch in the hand. */
const CAMP_LIGHTS = 3;

/** One `benchRender` call of a scenario: `frames` frames, measured (a window) or rendered and discarded. */
export interface BenchCall {
  readonly frames: number;
  readonly measured: boolean;
}

/**
 * The `benchRender` calls of a scenario with `frames` frames per window, in order: the warm-up, then each measured window
 * after its settling frame (`SETTLE_FRAMES`).
 */
export function benchCalls(frames: number): readonly BenchCall[] {
  const calls: BenchCall[] = [{ frames: WARMUP_FRAMES, measured: false }];
  for (let i = 0; i < BENCH_WINDOWS; i++) calls.push({ frames: SETTLE_FRAMES, measured: false }, { frames, measured: true });
  return calls;
}

export const RENDER_SCENARIOS: readonly RenderScenario[] = [
  { name: 'render:testszene', scenario: 'testszene', frames: BENCH_FRAMES },
  // M1-24: 5 000 animated sprites + 32 point lights (the stress scene of M1-12 at night).
  { name: 'render:sprites-5000', scenario: 'sprites-5000', frames: BENCH_FRAMES, expect: { sprites: 5000, lights: 32 } },
  // M2-29/M2-30: the game view on the session's world (the picture behind the title, streamed chunks, y-sorted objects).
  { name: 'render:spiel', scenario: 'spiel-titel', frames: BENCH_FRAMES },
  // M5-11: ≥ 20 000 GPU particles at once (four lumen storms, camp fire, torches, fireflies on the night clearing).
  { name: 'render:partikel-20000', scenario: 'partikel-20000', frames: BENCH_FRAMES, expect: { particles: STRESS_PARTICLES } },
  // M5-30: the full M5 pipeline at quality "Hoch" – Grünhain at night by the lake, camp fire, a torch on its stake and one in the hand.
  { name: 'render:hoch-gruenhain-nacht', scenario: 'hoch-gruenhain-nacht', frames: BENCH_FRAMES, expect: { lights: CAMP_LIGHTS } },
];

/**
 * M1-12 „Heap-Profil zeigt keine Allokation im Frame-Pfad“: the renderer's frame path per scene in
 * Node (`framePath.ts`), sampled with the heap profiler of `node:inspector`. `spiel-kampf` is the game
 * view in a night fight with 53 creatures (`FIGHT_SCENE`, `FIGHT_GROUPS`; M6 gate): creatures,
 * carcasses, telegraphs, projectiles and damage numbers on screen, a simulation tick before each frame.
 */
export const FRAME_PATH_BENCH = {
  name: 'render:frame-pfad',
  scenes: ['sprites-5000', 'gruenhain', 'welt-ui', 'normalmap-licht', 'palette', 'gruenhain-tag', 'ebene-1-roh', 'spiel', 'spiel-kampf', 'partikel-20000'] as const satisfies readonly FramePathSceneId[],
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
      // The page generates the session's world in the world worker at boot: measure once it is done.
      await page.waitForFunction(() => (window as unknown as { __dh: { state(): { sim: { world: { ready: boolean } } } } }).__dh.state().sim.world.ready, undefined, { timeout: 90_000 });
      const windows = await page.evaluate(async (calls) => {
        const dh = (window as unknown as { __dh: { call(name: 'benchRender', n: number): Promise<RenderBenchResult> } }).__dh;
        const out: RenderBenchResult[] = [];
        for (const c of calls) {
          const r = await dh.call('benchRender', c.frames);
          if (c.measured) out.push(r);
        }
        return out;
      }, benchCalls(s.frames));
      const r = combineWindows(windows);
      console.log(`bench: ${s.name} je Fenster – render prep p95 ${windows.map((w) => w.prepMsP95.toFixed(2)).join(' / ')} ms, frame CPU p95 ${windows.map((w) => w.frameMsP95.toFixed(2)).join(' / ')} ms (bewertet: Median)`);
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
      if (s.expect?.particles !== undefined) out.push({ scenario: s.name, metric: 'particles missing', value: Math.max(0, s.expect.particles - r.particlesMax), unit: '' });
      if (errors.length > 0) console.error(errors.join('\n'));
      await page.close();
    }
  } finally {
    await session.close();
  }
  return out;
}

/** Median of `values` (the middle one of an odd count, the mean of the two middle ones of an even count). */
function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

/** One result of the measured windows: times as the median of the windows' p95, counts from the worst window. */
export function combineWindows(windows: readonly RenderBenchResult[]): RenderBenchResult {
  if (windows.length === 0) throw new RangeError('combineWindows: no measured window');
  const max = (f: (w: RenderBenchResult) => number): number => Math.max(...windows.map(f));
  const min = (f: (w: RenderBenchResult) => number): number => Math.min(...windows.map(f));
  return {
    frames: windows.reduce((n, w) => n + w.frames, 0),
    drawCallsMax: max((w) => w.drawCallsMax),
    spriteDrawCallsMax: max((w) => w.spriteDrawCallsMax),
    spritesMax: min((w) => w.spritesMax),
    lightsMax: min((w) => w.lightsMax),
    particlesMax: min((w) => w.particlesMax),
    prepMsP95: median(windows.map((w) => w.prepMsP95)),
    frameMsP95: median(windows.map((w) => w.frameMsP95)),
    heapMb: max((w) => w.heapMb),
  };
}

