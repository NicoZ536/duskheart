/**
 * The frame-path bench in a Node process of its own (M7-87; ADR-0203 „eingeschwungener Zustand“). `render.ts` starts it
 * (`runFramePath`) before the browser session and waits for its answer: the measured process has run nothing but the
 * frame path – no simulation bench before it (their worlds on the heap, their object shapes and compiled code in the same
 * isolate), no dev server and no Chromium starting beside it: what the windows see is the frame path's own steady state,
 * not the leftovers of what ran before.
 *
 * The 54 KB per frame that `sprites-5000` once measured in the process of `npm run bench` were not an effect of that order
 * alone: in a process of its own the scene measured 53–136 KB in three runs of seven, with its `compose` optimised by
 * TurboFan – compiled while `clipFrameAt` and `glowStep` were still calls, every fractional argument and result a new number
 * object. The scene now hands no fractional number through a call (registers, ADR-0222; src/render/scenes/sprites5000.ts):
 * 386–1 207 B in every run since.
 *
 * The process loads the frame path through a dev server of its own without HTTP server and dependency scan (Vite's SSR
 * loader: the renderer's modules use `import.meta.glob`), measures the scenes of `FRAME_PATH_BENCH` with the sampling heap profiler of `node:inspector` and
 * sends the measurements to its parent over the IPC channel of `fork`.
 */
import { Session } from 'node:inspector/promises';
import { createServer } from 'vite';
import type { FramePathMeasurement, measureFramePath } from './framePath';
import { heapProfileOf, type HeapProfile } from './heap';
import { FRAME_PATH_BENCH, HEAP_SAMPLING_INTERVAL } from './render';

/** The measurements of every scene of `FRAME_PATH_BENCH` (sampled in this process). */
async function measure(): Promise<FramePathMeasurement[]> {
  // No HTTP server and no client: no dependency scan of the page's entries either (esbuild beside the measured frames).
  const server = await createServer({ logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, entries: [] } });
  const inspector = new Session();
  inspector.connect();
  try {
    const mod = (await server.ssrLoadModule('/tools/bench/framePath.ts')) as { measureFramePath: typeof measureFramePath };
    await inspector.post('HeapProfiler.enable');
    const collectGarbage = async (): Promise<void> => {
      await inspector.post('HeapProfiler.collectGarbage');
    };
    const profile = async (run: () => void): Promise<HeapProfile> => {
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: HEAP_SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      run();
      return heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    };
    return await mod.measureFramePath({
      root: process.cwd(),
      scenes: FRAME_PATH_BENCH.scenes,
      warmup: FRAME_PATH_BENCH.warmup,
      frames: FRAME_PATH_BENCH.frames,
      profile,
      collectGarbage,
      windows: FRAME_PATH_BENCH.windows,
    });
  } finally {
    inspector.disconnect();
    await server.close();
  }
}

const send = process.send?.bind(process);
if (send === undefined) {
  console.error('bench: Frame-Pfad läuft nur als Kindprozess der Render-Bench (tools/bench/render.ts)');
  process.exit(2);
}
try {
  const results = await measure();
  send(results, () => process.exit(0));
} catch (err) {
  console.error(`bench: Frame-Pfad: ${(err as Error).stack ?? String(err)}`);
  process.exit(1);
}
