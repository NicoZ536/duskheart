/**
 * M2-30 „flüssiges Laufen" and the E2E part of M2-22 in the real game: the figure runs for 60 s from
 * the start beach towards the island's centre at 20 tiles/s – across more than 20 chunk borders and
 * several biome borders – while the game view follows it, the world worker streams the chunks around
 * the camera and the active zone moves with the figure (catch-up on activation).
 *
 * Frame time in headless Chromium (ADR-0014, ADR-0026, ADR-0027): the page's own time per frame – the
 * CPU of every game frame (`__dh.call('frameLog')`: input, simulation ticks, UI signals, render
 * preparation) and every task of the page's main thread, taken from the browser's own trace (category
 * `toplevel`: frame callbacks with style, layout and commit, worker results, GC, timers). The interval between two animation frames measures SwiftShader, the CPU
 * rasteriser standing in for the GPU (≈ 80–120 ms per frame for every scene with the §6 light pass,
 * the M1 title clearing included); it is reported, not judged – GPU time is checked in the F3 overlay
 * on target hardware (§30). With 5 catch-up steps per frame the simulation then runs slower than real
 * time, so the route is checked against the ticks that ran (20 tiles per simulated second).
 *
 * - M2-30: p99 of the frame time ≤ 20 ms – of the frame CPU and of the longest main-thread task per
 *   frame (at most 1 % of the frames may hold a longer task); no chunk in
 *   view is ever missing (sampled every 10th frame), and screenshots during the run show no reload gaps.
 * - M2-22: 20 chunk borders without a frame over 25 ms: the frame CPU of every frame and the CPU time
 *   of every main-thread task stay under 25 ms, no long task of the page (the browser's own measure of
 *   blocking, ≥ 50 ms), and the active zone never generated a chunk on the main thread.
 * The zero-delay timer probe of the main thread (gaps ≥ 8 ms) is reported, not judged: besides the
 * page's own work it measures when the thread gets its turn next to SwiftShader on four cores – gaps
 * of 25–85 ms without any task of the page behind them (ADR-0026 control runs; ADR-0027: one verify run
 * had 6 such gaps, traced runs show no task of the page over 15 ms). The trace's thread time of a
 * task excludes such waiting, its wall time does not.
 */
import { expect, test } from '@playwright/test';

/** A trace event of Chromium's `toplevel` category (times in µs; `tdur` = thread time). */
interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly dur?: number;
  readonly tdur?: number;
  readonly args?: { readonly name?: string };
}

/**
 * Main-thread tasks of the page from a trace [ms]: count, the p99 per frame of their wall time (the
 * ⌈1 % of `frames`⌉-th longest task – at most 1 % of the frames may contain a longer one; the many tiny
 * timer tasks of the probe do not dilute it), the longest wall and thread time, and the tasks whose
 * thread time reaches 25 ms.
 */
function mainThreadTasks(events: readonly TraceEvent[], frames: number): { count: number; wallP99: number; wallMax: number; cpuMax: number; over25: number[] } {
  const threads = new Set(events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
  const tasks = events.filter((e) => e.ph === 'X' && e.name === 'ThreadControllerImpl::RunTask' && threads.has(`${e.pid}:${e.tid}`));
  const wall = tasks.map((t) => (t.dur ?? 0) / 1000).sort((a, b) => a - b);
  const cpu = tasks.map((t) => (t.tdur ?? t.dur ?? 0) / 1000);
  return {
    count: tasks.length,
    wallP99: wall[Math.max(0, wall.length - Math.ceil(frames * 0.01))] ?? 0,
    wallMax: wall[wall.length - 1] ?? 0,
    cpuMax: Math.max(0, ...cpu),
    over25: cpu.filter((ms) => ms >= 25),
  };
}

interface RunResult {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  maxStallMs: number;
  stallP99: number;
  stallsOver25: number;
  longTasks: number;
  cpuMax: number;
  cpuP99: number;
  prepP95: number;
  bordersCrossed: number;
  biomes: string[];
  biomeChanges: number;
  missingMax: number;
  partialFrames: number;
  samples: number;
  syncLoads: number;
  distanceTiles: number;
  ticks: number;
}

test.use({ viewport: { width: 1920, height: 1080 } });

/** Length of the run [ms]. */
const RUN_MS = 60_000;
/**
 * Running speed [tiles/s]: a fast run (sprint is 7 tiles/s, §11.4) that crosses > 20 chunk borders
 * in 60 s even when SwiftShader's frame rate slows the simulation (5 catch-up ticks per frame).
 */
const SPEED_TILES = 20;
const TILE_PX = 16;
/** Frame time budget of M2-30 (p99) and the longest frame of M2-22 [ms]. */
const P99_BUDGET_MS = 20;
const MAX_FRAME_MS = 25;
/** Timer gaps recorded as stalls [ms] (zero-delay timers run ≈ 4 ms apart after the nesting clamp). */
const STALL_MIN_MS = 8;
const WORLD_TILES: Readonly<Record<string, number>> = { small: 1024, medium: 1536, large: 2048 };

test('flüssiges Laufen: 60 s über Chunk- und Biomgrenzen, p99 ≤ 20 ms, keine Nachlade-Lücken, kein Frame > 25 ms', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: { ready: boolean } }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: { call(n: string): { sceneReady: boolean } } }).__dh.call('renderInfo').sceneReady, undefined, { timeout: 60_000 });

  // The figure starts on the start beach and runs towards the island's centre.
  const setup = await page.evaluate(
    ({ speedPx, tilePx, sizes }) => {
      type Dh = { command(c: unknown): unknown; state(): { sim: { worldSize: string } }; call(n: string): unknown };
      const dh = (window as unknown as { __dh: Dh }).__dh;
      const points = dh.call('worldPoints') as { spawn: { tx: number; ty: number } };
      const tiles = sizes[dh.state().sim.worldSize] as number;
      const dx = tiles / 2 - points.spawn.tx;
      const dy = tiles / 2 - points.spawn.ty;
      const len = Math.hypot(dx, dy);
      const vx = (dx / len) * speedPx;
      const vy = (dy / len) * speedPx;
      dh.command({ type: 'spawnDebugMover', x: points.spawn.tx * tilePx + tilePx / 2, y: points.spawn.ty * tilePx + tilePx / 2, vx, vy, controlled: true });
      return { spawn: points.spawn, vx, vy };
    },
    { speedPx: SPEED_TILES * TILE_PX, tilePx: TILE_PX, sizes: WORLD_TILES },
  );
  await page.waitForFunction(() => (window as unknown as { __dh: { state(): { sim: { controlled: unknown } } } }).__dh.state().sim.controlled !== null);

  // The browser's own trace of the run: every task of the page's main thread.
  await browser.startTracing(page, { categories: ['toplevel'] });
  const r: RunResult = await page.evaluate(
    async ({ runMs, tilePx, stallMinMs, maxFrameMs }) => {
      type Info = { terrain: { missing: number; partial: number }; syncLoads: number; figure: [number, number] | null };
      type State = { sim: { tick: number; world: { focus: { tx: number; ty: number } | null; biome: string | null } } };
      type Dh = { call(n: string, ...a: unknown[]): unknown; state(): State };
      const dh = (window as unknown as { __dh: Dh }).__dh;
      const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

      // Main-thread stall probe: a chain of zero-delay timers (≈ 4 ms apart once the nesting clamp
      // applies). A MessageChannel ping loop would post a MessageEvent per task turn – thousands per
      // second of Blink garbage whose sweeping tasks then show up as the very stalls it measures.
      const stalls: Array<[number, number]> = [];
      let probing = true;
      let lastPing = performance.now();
      const ping = (): void => {
        const now = performance.now();
        if (now - lastPing >= stallMinMs) stalls.push([lastPing, now]);
        lastPing = now;
        if (probing) setTimeout(ping, 0);
      };
      setTimeout(ping, 0);
      let longTasks = 0;
      const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask' });

      const startInfo = dh.call('worldInfo') as Info;
      const start = startInfo.figure ?? [0, 0];
      const startTick = dh.state().sim.tick;
      dh.call('frameLog', 'start');
      const stamps: number[] = [await nextFrame()];
      let missingMax = 0;
      let partialFrames = 0;
      let samples = 0;
      let lastChunk: [number, number] | null = null;
      let borders = 0;
      const biomes: string[] = [];
      let biomeChanges = 0;
      /** Focus chunk and biome of the figure: chunk borders crossed since the last sample, biome changes. */
      const sampleFocus = (): void => {
        const w = dh.state().sim.world;
        if (w.focus !== null) {
          const c: [number, number] = [w.focus.tx >> 5, w.focus.ty >> 5];
          if (lastChunk !== null) borders += Math.abs(c[0] - lastChunk[0]) + Math.abs(c[1] - lastChunk[1]);
          lastChunk = c;
        }
        if (w.biome !== null && w.biome !== biomes[biomes.length - 1]) {
          if (biomes.length > 0) biomeChanges++;
          biomes.push(w.biome);
        }
      };
      sampleFocus();
      const t0 = stamps[0] as number;
      let frame = 0;
      while ((stamps[stamps.length - 1] as number) - t0 < runMs) {
        stamps.push(await nextFrame());
        frame++;
        if (frame % 10 === 0) {
          const info = dh.call('worldInfo') as Info;
          missingMax = Math.max(missingMax, info.terrain.missing);
          if (info.terrain.partial > 0) partialFrames++;
          samples++;
        }
        if (frame % 15 === 0) sampleFocus();
      }
      sampleFocus();
      const log = dh.call('frameLog', 'stop') as { cpu: number[]; prep: number[] };
      const endInfo = dh.call('worldInfo') as Info;
      const endTick = dh.state().sim.tick;
      probing = false;
      await new Promise((resolve) => setTimeout(resolve, 20));
      observer.disconnect();

      const intervals = stamps.slice(1).map((t, i) => t - (stamps[i] as number));
      const sorted = [...intervals].sort((a, b) => a - b);
      const pct = (arr: number[], q: number): number => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] ?? 0;
      const stallMs = stalls.map(([a, b]) => b - a).sort((a, b) => a - b);
      const cpu = [...log.cpu].sort((a, b) => a - b);
      const prep = [...log.prep].sort((a, b) => a - b);
      const end = endInfo.figure ?? start;
      return {
        frames: intervals.length,
        p50: pct(sorted, 0.5),
        p95: pct(sorted, 0.95),
        p99: pct(sorted, 0.99),
        max: sorted[sorted.length - 1] ?? 0,
        maxStallMs: stallMs[stallMs.length - 1] ?? 0,
        stallsOver25: stallMs.filter((ms) => ms >= maxFrameMs).length,
        // Stalls per frame: the p99 over all frames (a frame without a stall ≥ 4 ms counts as 0).
        stallP99: stallMs.length === 0 ? 0 : (stallMs[Math.max(0, stallMs.length - Math.ceil(intervals.length * 0.01))] as number),
        longTasks,
        cpuMax: cpu[cpu.length - 1] ?? 0,
        cpuP99: pct(cpu, 0.99),
        prepP95: pct(prep, 0.95),
        bordersCrossed: borders,
        biomes,
        biomeChanges,
        missingMax,
        partialFrames,
        samples,
        syncLoads: endInfo.syncLoads - startInfo.syncLoads,
        distanceTiles: Math.hypot(end[0] - start[0], end[1] - start[1]) / tilePx,
        ticks: endTick - startTick,
      };
    },
    { runMs: RUN_MS, tilePx: TILE_PX, stallMinMs: STALL_MIN_MS, maxFrameMs: MAX_FRAME_MS },
  );

  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
  const tasks = mainThreadTasks(trace.traceEvents, r.frames);

  // Screenshots while the figure keeps running: every visible chunk drawn, no reload gaps.
  for (let i = 0; i < 3; i++) {
    const shot = testInfo.outputPath(`lauf-${i}.png`);
    await page.screenshot({ path: shot });
    await testInfo.attach(`lauf-${i}`, { path: shot, contentType: 'image/png' });
    const info = await page.evaluate(() => (window as unknown as { __dh: { call(n: string): { terrain: { missing: number } } } }).__dh.call('worldInfo'));
    expect(info.terrain.missing).toBe(0);
    await page.waitForTimeout(1500);
  }

  console.info('flüssiges Laufen', JSON.stringify({ ...r, tasks, setup }));
  // The run covered the route the simulation ran (20 tiles per simulated second), more than 20 chunk borders, several biomes.
  expect(r.distanceTiles).toBeGreaterThan(0.95 * SPEED_TILES * (r.ticks / 60));
  expect(r.bordersCrossed).toBeGreaterThanOrEqual(20);
  expect(r.biomeChanges).toBeGreaterThanOrEqual(2);
  // M2-30: frame time p99 ≤ 20 ms (frame CPU and main-thread tasks); no hole in the picture at any sampled frame.
  expect(tasks.count).toBeGreaterThan(r.frames);
  expect(r.cpuP99).toBeLessThanOrEqual(P99_BUDGET_MS);
  expect(tasks.wallP99).toBeLessThanOrEqual(P99_BUDGET_MS);
  expect(r.missingMax).toBe(0);
  expect(r.samples).toBeGreaterThanOrEqual(r.frames / 10 - 1);
  // M2-22: no frame over 25 ms, no blocking task of the page.
  expect(r.cpuMax).toBeLessThan(MAX_FRAME_MS);
  expect(tasks.over25).toEqual([]);
  expect(r.longTasks).toBe(0);
  // The worker kept ahead of the figure: the active zone never generated a chunk on the main thread.
  expect(r.syncLoads).toBe(0);
  expect(errors).toEqual([]);
});
