/**
 * Time of every render pass (MASTERPROMPT §30 "GPU-Zeiten werden zusätzlich im F3-Overlay geprüft", M5-30): the GPU
 * time of each pass through `EXT_disjoint_timer_query_webgl2` where the context has it – read a few frames late, never
 * waiting for the GPU – and the CPU time of its preparation and submission, for the F3 overlay and
 * `__dh.call('passTimings')`. The renderer brackets each pass it runs (`begin`/`end`), plus the sprite upload before
 * the passes (`sprites`) and the presentation after them (`praesentation`).
 *
 * The light strand's passes time themselves (`LightPipeline.timers`, M5-01): the profiler leaves them alone – one
 * timer query at a time is all WebGL allows – and reports their timers' values in its table.
 *
 * Timing runs on demand, like the light strand's: only for `PASS_PROFILER.windowFrames` frames after the last request
 * for the times (§30: no work and no allocation in a frame nobody looks at). A timer per pass is created on the first
 * measured frame that runs it; after a context loss each timer enables the extension again and makes new queries
 * (`PassTimer`).
 *
 * Under a software rasteriser (SwiftShader in headless Chromium, `softwareRenderer`) the extension exists, but its
 * times are CPU rasterisation, not a GPU's: the overlay marks them as such.
 */
import type { GpuResourceRegistry } from '../gl/resources';
import { PassTimer, TimingGate } from '../light/passTimer';

/** Name of the pseudo pass that uploads the frame's sprite instances before the passes. */
export const SPRITES_TIMING = 'sprites';
/** Name of the pseudo pass that scales the final image (or the debugger's buffer) to the canvas. */
export const PRESENT_TIMING = 'praesentation';

/** Time of one pass [ms]: GPU (null without a result of the timer queries) and CPU. */
export interface PassTiming {
  readonly name: string;
  readonly gpuMs: number | null;
  readonly cpuMs: number;
}

/** The pass table of the last measured frames. */
export interface PassTimings {
  /** Every pass that ran in a measured frame, in the order it ran. */
  readonly passes: readonly PassTiming[];
  /** Sum of the GPU times (null while no pass has a GPU time). */
  readonly gpuMs: number | null;
  /** Sum of the CPU times. */
  readonly cpuMs: number;
  /** The context offers timer queries (`EXT_disjoint_timer_query_webgl2`). */
  readonly gpuTimers: boolean;
  /** The context renders on a software rasteriser (SwiftShader, llvmpipe): GPU times are CPU times of the rasteriser. */
  readonly softwareRenderer: boolean;
  /** Name of the renderer as the browser reports it (empty where it hides it). */
  readonly renderer: string;
}

/** Timers a pass brings along (the light strand's), by pass name. */
export interface SelfTimedPasses {
  readonly timers: ReadonlyArray<{ readonly name: string; readonly timer: PassTimer }>;
  /** Asks the pass's own timers to measure (their gate opens for a window of frames). */
  timings(): unknown;
}

/** The renderer string of browsers that hide the real one behind it. */
const MASKED_RENDERER = /^webkit webgl$/i;
/** Renderer strings of software rasterisers. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software/i;

export class PassProfiler {
  private readonly gate = new TimingGate();
  private measuring = false;
  private gl: WebGL2RenderingContext | null = null;
  private resources: GpuResourceRegistry | null = null;
  private readonly timers = new Map<string, PassTimer>();
  private readonly selfTimed = new Map<string, PassTimer>();
  private selfSource: SelfTimedPasses | null = null;
  private gpuTimers = false;
  private software = false;
  private rendererName = '';

  /** Looks at the context once (renderer name, timer queries); passes are timed from the first request on. */
  init(gl: WebGL2RenderingContext, resources: GpuResourceRegistry): void {
    this.gl = gl;
    this.resources = resources;
    this.gpuTimers = gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null;
    // Firefox names the real renderer in RENDERER (and warns when the debug extension is asked for); Chrome and Safari
    // answer "WebKit WebGL" there and name it through `WEBGL_debug_renderer_info`.
    const plain: unknown = gl.getParameter(gl.RENDERER);
    let name = typeof plain === 'string' ? plain : '';
    if (name === '' || MASKED_RENDERER.test(name)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
      const unmasked: unknown = info !== null ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
      if (typeof unmasked === 'string') name = unmasked;
    }
    this.rendererName = name;
    this.software = SOFTWARE_RENDERER.test(this.rendererName);
  }

  /** Passes with timers of their own (the light pipeline): reported from those, never bracketed a second time. */
  useSelfTimed(source: SelfTimedPasses): void {
    this.selfSource = source;
    this.selfTimed.clear();
    for (const t of source.timers) this.selfTimed.set(t.name, t.timer);
  }

  /** Start of a frame: whether it is measured (someone asked for the times within the window). */
  beginFrame(): void {
    this.measuring = this.gate.open(true);
  }

  /** Before pass `name` runs (no work while not measuring). */
  begin(gl: WebGL2RenderingContext, name: string): void {
    if (!this.measuring || this.selfTimed.has(name)) return;
    let timer = this.timers.get(name);
    if (timer === undefined) {
      if (this.resources === null) return;
      timer = new PassTimer();
      timer.init(gl, this.resources);
      this.timers.set(name, timer);
    }
    timer.begin(gl);
  }

  /** After pass `name` ran. */
  end(gl: WebGL2RenderingContext, name: string): void {
    if (!this.measuring || this.selfTimed.has(name)) return;
    this.timers.get(name)?.end(gl);
  }

  /**
   * The pass table (smoothed times of the measured frames), in the order of `names` – the renderer's passes as they
   * run – with the pseudo passes around them. Asking keeps the timers measuring for the next frames (the first answer
   * after a pause is the last one measured).
   */
  timings(names: readonly string[]): PassTimings {
    this.gate.request();
    this.selfSource?.timings();
    const passes: PassTiming[] = [];
    let gpu: number | null = null;
    let cpu = 0;
    const add = (name: string): void => {
      const timer = this.selfTimed.get(name) ?? this.timers.get(name);
      if (timer === undefined) return;
      passes.push({ name, gpuMs: timer.gpuMs, cpuMs: timer.cpuMs });
      if (timer.gpuMs !== null) gpu = (gpu ?? 0) + timer.gpuMs;
      cpu += timer.cpuMs;
    };
    add(SPRITES_TIMING);
    for (const n of names) add(n);
    add(PRESENT_TIMING);
    return { passes, gpuMs: gpu, cpuMs: cpu, gpuTimers: this.gpuTimers, softwareRenderer: this.software, renderer: this.rendererName };
  }

  /** Names of the passes timed by the profiler itself so far (tests, diagnostics). */
  timedNames(): readonly string[] {
    return [...this.timers.keys()];
  }

  /** The context the profiler was set up with (null before `init`). */
  get context(): WebGL2RenderingContext | null {
    return this.gl;
  }
}
