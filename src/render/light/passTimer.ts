/**
 * Time of the light strand's passes (docs/RENDER.md §4 "GPU-Zeiten der eigenen Pässe per Timer-Query im F3 (wo
 * verfügbar, sonst CPU-Zeit der Vorbereitung)"; M5-01): each pass's GPU time through `EXT_disjoint_timer_query_webgl2`
 * – read a few frames late from a small ring of queries, never waiting on the GPU – and the CPU time of its
 * preparation and submission. Values are smoothed (a moving average over about `SMOOTH_FRAMES` frames).
 *
 * Timing runs on demand (`TimingGate`): only for `TIMING_WINDOW_FRAMES` frames after someone asked for the times (the F3
 * overlay each frame, `__dh.call('lightTimings')`) – the clock reads and the smoothing are no work of a frame nobody
 * looks at (§30: no allocation in the frame path).
 *
 * The queries are GL objects outside the resource registry: after a context loss (the registry's restore count moves
 * on) the timer drops them without deleting, enables the extension on the restored context again (its enums are
 * invalid until then) and creates new queries. Without the extension (SwiftShader, Firefox) only the CPU time is
 * measured; `gpuMs` stays null.
 */
import type { GpuResourceRegistry } from '../gl/resources';
import type { PassSetup, RenderContext, RenderPass } from '../passes/registry';

/** Frames the timers keep measuring after the last request for their times (the F3 overlay asks every frame). */
export const TIMING_WINDOW_FRAMES = 120;

/** Whether the timers of a pipeline measure: open for a window of frames after each request (`request`). */
export class TimingGate {
  private remaining = 0;

  /** Someone reads the times: measure the next `TIMING_WINDOW_FRAMES` frames. */
  request(): void {
    this.remaining = TIMING_WINDOW_FRAMES;
  }

  /** Whether this frame is measured (the first timer of the frame counts the window down). */
  open(countDown: boolean): boolean {
    if (this.remaining <= 0) return false;
    if (countDown) this.remaining--;
    return true;
  }
}

/** Queries in flight per pass (results arrive a few frames late). */
const RING = 4;
/** Frames the moving average spans (weight of a new sample 1 / SMOOTH_FRAMES). */
const SMOOTH_FRAMES = 20;
const NS_PER_MS = 1e6;

/** The constants of `EXT_disjoint_timer_query_webgl2`. */
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** The monotonic clock of the page (render layer: presentation, not simulation). */
function now(): number {
  return performance.now();
}

export class PassTimer {
  /** Smoothed GPU time of the pass [ms], null without timer queries. */
  gpuMs: number | null = null;
  /** Smoothed CPU time of the pass's preparation and submission [ms]. */
  cpuMs = 0;
  private gl: WebGL2RenderingContext | null = null;
  private ext: TimerQueryExt | null = null;
  private resources: GpuResourceRegistry | null = null;
  private epoch = -1;
  private readonly queries: Array<WebGLQuery | null> = new Array<WebGLQuery | null>(RING).fill(null);
  private readonly pending: boolean[] = new Array<boolean>(RING).fill(false);
  private next = 0;
  private active = -1;
  private started = 0;
  private measuring = false;

  /**
   * @param gate when the timer measures (none: always)
   * @param countsFrames the first timer of a frame counts the gate's window down
   */
  constructor(
    private readonly gate: TimingGate | null = null,
    private readonly countsFrames = false,
  ) {}

  /** Looks for the timer query extension of `gl` (the pass's `init`). */
  init(gl: WebGL2RenderingContext, resources: GpuResourceRegistry): void {
    this.gl = gl;
    this.resources = resources;
    this.epoch = resources.restoreCount;
    this.acquire(gl);
  }

  /** Starts timing a pass (before its `execute`). */
  begin(gl: WebGL2RenderingContext): void {
    this.active = -1;
    this.measuring = this.gate === null || this.gate.open(this.countsFrames);
    if (!this.measuring) return;
    this.started = now();
    if (this.gl !== gl) return;
    const epoch = this.resources?.restoreCount ?? 0;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.acquire(gl);
    }
    const ext = this.ext;
    if (ext === null) return;
    this.collect(gl, ext);
    const i = this.next;
    const q = this.queries[i];
    if (q === null || q === undefined || this.pending[i] === true) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.active = i;
  }

  /** Ends timing a pass (after its `execute`). */
  end(gl: WebGL2RenderingContext): void {
    if (!this.measuring) return;
    this.cpuMs += (now() - this.started - this.cpuMs) / SMOOTH_FRAMES;
    const ext = this.ext;
    if (ext === null || this.active < 0) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending[this.active] = true;
    this.next = (this.active + 1) % RING;
    this.active = -1;
  }

  /**
   * Enables the extension on the context and creates the queries – at `init` and after a context loss (a restored
   * context starts without extensions, and the old handles died with the old context).
   */
  private acquire(gl: WebGL2RenderingContext): void {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    this.active = -1;
    this.next = 0;
    for (let i = 0; i < RING; i++) {
      this.queries[i] = this.ext === null ? null : gl.createQuery();
      this.pending[i] = false;
    }
  }

  /** Reads the finished queries (oldest first); a disjoint frame's results are dropped. The GPU is never waited for. */
  private collect(gl: WebGL2RenderingContext, ext: TimerQueryExt): void {
    let disjoint: boolean | null = null;
    for (let k = 0; k < RING; k++) {
      const i = (this.next + k) % RING;
      const q = this.queries[i];
      if (this.pending[i] !== true || q === null || q === undefined) continue;
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) !== true) continue;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending[i] = false;
      disjoint ??= gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
      if (disjoint) continue;
      const ms = ns / NS_PER_MS;
      this.gpuMs = this.gpuMs === null ? ms : this.gpuMs + (ms - this.gpuMs) / SMOOTH_FRAMES;
    }
  }
}

/** Times of the light strand's passes (the F3 overlay, `__dh.call('lightTimings')`). */
export interface LightPassTimings {
  /** Per pass [ms]: GPU (null without timer queries) and CPU. */
  readonly passes: ReadonlyArray<{ name: string; gpuMs: number | null; cpuMs: number }>;
  /** Sum of the passes' GPU times, null without timer queries. */
  gpuMs: number | null;
  /** Sum of the passes' CPU times. */
  cpuMs: number;
}

/**
 * Times `pass` with `timer` (once, at installation, before the pass is registered: no allocation per frame): its
 * `init` also initialises the timer, its `execute` runs between `begin` and `end`.
 */
export function timePass(pass: RenderPass, timer: PassTimer): void {
  const init = pass.init?.bind(pass);
  pass.init = (setup: PassSetup): void => {
    init?.(setup);
    timer.init(setup.gl, setup.resources);
  };
  const run = pass.execute.bind(pass);
  pass.execute = (ctx: RenderContext): void => {
    timer.begin(ctx.gl);
    try {
      run(ctx);
    } finally {
      timer.end(ctx.gl);
    }
  };
}
