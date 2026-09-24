/**
 * Fixed step game loop (docs/ARCHITEKTUR.md "Loop", MASTERPROMPT §3.3).
 *
 * The simulation advances in fixed ticks (default 60 Hz) driven by an accumulator; rendering
 * runs once per frame with an interpolation factor `alpha`. Time source and frame scheduler are
 * injected (browser: `performance.now` + `requestAnimationFrame`; tests: call `advance()`).
 * Game speed (accessibility 50–100 %, debug fast forward) and pause act on the accumulator only.
 * Pause has named reasons (hidden tab, pause menu, debug `freezeTime` …): the simulation runs only
 * while no reason is active, so ending one pause never cancels another.
 */
import { FloatRing } from './pool';

/** Default simulation rate in ticks per second. */
export const DEFAULT_STEP_HZ = 60;
/** Default maximum number of simulation steps per frame before time is dropped. */
export const DEFAULT_MAX_CATCH_UP = 5;
/**
 * Largest accepted time scale: sleep runs time ×30 (§11.5, `BALANCE.sleep.timeScale`, checked by a test – the
 * engine does not read content) and debug fast forward goes up to this, too.
 */
export const MAX_TIME_SCALE = 32;
/** Number of frames the rolling frame time average covers. */
export const FRAME_STATS_WINDOW = 120;
/**
 * Accumulator tolerance in milliseconds. Frame times like 1000/60 are not exact in binary floating
 * point; without the tolerance a frame of exactly one step could occasionally run zero ticks.
 */
export const ACCUMULATOR_EPSILON_MS = 1e-6;
const MS_PER_SECOND = 1000;

/** Pause reason used when `pause()`/`resume()` are called without one. */
export const DEFAULT_PAUSE_REASON = 'manual';

/** Opaque handle returned by the injected scheduler. */
export type ScheduleHandle = unknown;

/** Options for `FixedStepLoop`. */
export interface FixedStepLoopOptions {
  /** Simulation ticks per second (default 60). */
  stepHz?: number;
  /** Maximum simulation steps per frame at time scale 1 (default 5); the rest is dropped. */
  maxCatchUp?: number;
  /** Monotonic time source in milliseconds. */
  now: () => number;
  /** Requests the next frame callback (e.g. `requestAnimationFrame`). */
  schedule: (cb: () => void) => ScheduleHandle;
  /** Cancels a pending frame callback. */
  cancel: (handle: ScheduleHandle) => void;
  /**
   * Called once at the start of every frame, before any simulation step (also while paused): the
   * place to translate this frame's input into commands (docs/ARCHITEKTUR.md "Datenfluss").
   */
  beginFrame?: (frameSeconds: number) => void;
  /** Advances the simulation by one fixed step. */
  update: (stepSeconds: number, tickIndex: number) => void;
  /** Draws a frame; `alpha` ∈ [0, 1) interpolates between the previous and the current tick. */
  render: (alpha: number, frameSeconds: number) => void;
}

/** Read only statistics of a running loop. */
export interface LoopStats {
  /** Total simulation ticks executed. */
  readonly ticks: number;
  /** Total frames (calls to `advance`). */
  readonly frames: number;
  /** Real time of the last frame in milliseconds. */
  readonly lastFrameMs: number;
  /** Rolling average of real frame time in milliseconds. */
  readonly avgFrameMs: number;
  /** Simulation steps executed in the last frame. */
  readonly lastSteps: number;
  /** Total scaled simulation time dropped because the catch-up cap was exceeded (ms). */
  readonly droppedMs: number;
  /** Number of frames that hit the catch-up cap. */
  readonly droppedFrames: number;
}

/** Host functions needed to drive a loop in the browser (injected, never read from globals). */
export interface AnimationFrameHost {
  performance: { now(): number };
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

/** Builds the `now`/`schedule`/`cancel` trio for `FixedStepLoop` from a browser window. */
export function animationFrameClock(host: AnimationFrameHost): Pick<FixedStepLoopOptions, 'now' | 'schedule' | 'cancel'> {
  return {
    now: () => host.performance.now(),
    // `cb` ignores the timestamp argument, so it is passed through directly (no closure per frame).
    schedule: (cb) => host.requestAnimationFrame(cb),
    cancel: (handle) => {
      if (typeof handle === 'number') host.cancelAnimationFrame(handle);
    },
  };
}

/** Fixed timestep loop with accumulator, catch-up cap, interpolation, pause and time scale. */
export class FixedStepLoop {
  /** Length of one simulation step in seconds. */
  readonly stepSeconds: number;
  /** Length of one simulation step in milliseconds. */
  readonly stepMs: number;
  /** Maximum steps per frame at time scale 1. */
  readonly maxCatchUp: number;

  private readonly opts: FixedStepLoopOptions;
  private readonly frameTimes = new FloatRing(FRAME_STATS_WINDOW);
  private readonly frameCallback: () => void;
  private handle: ScheduleHandle = null;
  private runningFlag = false;
  private readonly pauseReasons = new Set<string>();
  private scale = 1;
  private accumulatorMs = 0;
  private lastNowMs = 0;
  private hasLastNow = false;
  private tickIndex = 0;
  private frameCount = 0;
  private lastFrame = 0;
  private stepsLastFrame = 0;
  private dropped = 0;
  private droppedFrameCount = 0;
  private alphaValue = 0;

  constructor(options: FixedStepLoopOptions) {
    const stepHz = options.stepHz ?? DEFAULT_STEP_HZ;
    const maxCatchUp = options.maxCatchUp ?? DEFAULT_MAX_CATCH_UP;
    if (!(stepHz > 0) || !Number.isFinite(stepHz)) throw new RangeError(`stepHz must be > 0, got ${String(stepHz)}`);
    if (!Number.isInteger(maxCatchUp) || maxCatchUp < 1) throw new RangeError(`maxCatchUp must be an integer ≥ 1, got ${String(maxCatchUp)}`);
    this.opts = options;
    this.stepSeconds = 1 / stepHz;
    this.stepMs = MS_PER_SECOND / stepHz;
    this.maxCatchUp = maxCatchUp;
    this.frameCallback = () => {
      if (!this.runningFlag) return;
      this.handle = null;
      try {
        this.advance(this.opts.now());
      } catch (err) {
        // A throwing update/render must not leave a "running" loop without a scheduled frame:
        // stop cleanly so `start()` can restart it, then surface the error.
        this.runningFlag = false;
        this.hasLastNow = false;
        throw err;
      }
      if (this.runningFlag) this.handle = this.opts.schedule(this.frameCallback);
    };
  }

  /** Whether frames are being scheduled. */
  get running(): boolean {
    return this.runningFlag;
  }

  /** Whether the simulation is paused for at least one reason (rendering continues). */
  get paused(): boolean {
    return this.pauseReasons.size > 0;
  }

  /** Whether the simulation is paused for `reason`. */
  pausedFor(reason: string): boolean {
    return this.pauseReasons.has(reason);
  }

  /** Current time scale (1 = real time). */
  get timeScale(): number {
    return this.scale;
  }

  /** Index of the next tick to run (= number of ticks executed so far). */
  get tick(): number {
    return this.tickIndex;
  }

  /** Interpolation factor passed to the last `render` call. */
  get alpha(): number {
    return this.alphaValue;
  }

  /** Snapshot of the loop statistics. */
  get stats(): LoopStats {
    return {
      ticks: this.tickIndex,
      frames: this.frameCount,
      lastFrameMs: this.lastFrame,
      avgFrameMs: this.frameTimes.average(),
      lastSteps: this.stepsLastFrame,
      droppedMs: this.dropped,
      droppedFrames: this.droppedFrameCount,
    };
  }

  /** Starts scheduling frames. The first frame measures time from this call. */
  start(): void {
    if (this.runningFlag) return;
    this.runningFlag = true;
    this.lastNowMs = this.opts.now();
    this.hasLastNow = true;
    this.handle = this.opts.schedule(this.frameCallback);
  }

  /** Stops scheduling frames. Accumulated time is kept; `start()` resumes without a time jump. */
  stop(): void {
    if (!this.runningFlag) return;
    this.runningFlag = false;
    if (this.handle !== null) this.opts.cancel(this.handle);
    this.handle = null;
    this.hasLastNow = false;
  }

  /** Freezes the simulation for `reason`; frames keep rendering with a constant alpha. */
  pause(reason: string = DEFAULT_PAUSE_REASON): void {
    this.pauseReasons.add(reason);
  }

  /**
   * Ends the pause for `reason`. The simulation runs again once no reason is left; time that
   * passed while paused is not simulated.
   */
  resume(reason: string = DEFAULT_PAUSE_REASON): void {
    this.pauseReasons.delete(reason);
  }

  /**
   * Sets the simulation speed: 0.5–1 for the accessibility setting, 0..`MAX_TIME_SCALE` for debug
   * speed. The per-frame step cap grows with the scale so fast forward is not eaten by the cap.
   */
  setTimeScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 0 || scale > MAX_TIME_SCALE) {
      throw new RangeError(`time scale must be in [0, ${MAX_TIME_SCALE}], got ${String(scale)}`);
    }
    this.scale = scale;
  }

  /** Discards accumulated partial step time (e.g. after loading a save). */
  resetAccumulator(): void {
    this.accumulatorMs = 0;
    this.alphaValue = 0;
  }

  /** Sets the tick counter (e.g. after loading a save that stores the tick). */
  setTick(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick must be an integer ≥ 0, got ${String(tick)}`);
    this.tickIndex = tick;
  }

  /**
   * Processes one frame at time `nowMs`: runs as many fixed steps as the accumulator allows
   * (capped), then renders. Public so tests and headless drivers can step deterministically.
   * The first call only establishes the time base (0 ms frame).
   */
  advance(nowMs: number): void {
    const frameMs = this.hasLastNow ? Math.max(0, nowMs - this.lastNowMs) : 0;
    this.lastNowMs = nowMs;
    this.hasLastNow = true;
    this.frameCount++;
    this.lastFrame = frameMs;
    this.frameTimes.push(frameMs);
    this.opts.beginFrame?.(frameMs / MS_PER_SECOND);

    let steps = 0;
    if (this.pauseReasons.size === 0) {
      this.accumulatorMs += frameMs * this.scale;
      const cap = this.maxCatchUp * Math.max(1, Math.ceil(this.scale));
      while (this.accumulatorMs + ACCUMULATOR_EPSILON_MS >= this.stepMs && steps < cap) {
        this.opts.update(this.stepSeconds, this.tickIndex);
        this.tickIndex++;
        this.accumulatorMs -= this.stepMs;
        steps++;
      }
      if (this.accumulatorMs < 0) this.accumulatorMs = 0;
      if (this.accumulatorMs + ACCUMULATOR_EPSILON_MS >= this.stepMs) {
        // Catch-up cap hit: keep the fractional part for smooth interpolation, drop whole steps.
        let keep = this.accumulatorMs % this.stepMs;
        // Step lengths like 1000/60 are not exact, so `%` can yield "one step minus rounding
        // noise" where the true remainder is 0; keeping it would run an extra tick next frame.
        if (keep + ACCUMULATOR_EPSILON_MS >= this.stepMs) keep = 0;
        this.dropped += this.accumulatorMs - keep;
        this.droppedFrameCount++;
        this.accumulatorMs = keep;
      }
      const a = this.accumulatorMs / this.stepMs;
      this.alphaValue = a < 0 ? 0 : a < 1 ? a : 0;
    }
    this.stepsLastFrame = steps;
    this.opts.render(this.alphaValue, frameMs / MS_PER_SECOND);
  }
}
