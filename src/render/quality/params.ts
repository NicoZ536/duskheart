/**
 * Numbers of the quality strand (M5-25 … M5-27, M5-30; MASTERPROMPT §6.3, §30): the first-start benchmark, the
 * dynamic halving of the light buffer and the pass timing of the F3 overlay. Every threshold carries its reason.
 */

/** §30: 60 FPS stable on "Hoch" – the frame period the game aims at [ms]. */
export const TARGET_FRAME_MS = 1000 / 60;

/**
 * First-start benchmark (§6.3 "Automatische Voreinstellung per kurzem Benchmark beim ersten Start"): the levels are
 * tried from the lowest up on the scene behind the title, each frame timed from the start of its preparation until
 * the GPU has finished it (a one-pixel read of the canvas waits for it).
 */
export const AUTO_PRESET = {
  /**
   * Frames rendered after switching to a level before its frames count: the first frames compile programs, fill
   * pools and re-seed effects (particle prewarm, water field) – a one-time cost, not the level's.
   */
  warmupFrames: 3,
  /** Frames measured per level; the median judges (one hitch of the browser does not decide). */
  sampleFrames: 5,
  /**
   * A level passes when its median frame (CPU preparation + GPU) stays within this [ms]: half the 60-Hz frame. The
   * title's beach by day is a light scene (few point lights, no fog); night scenes with torches and camp fires cost
   * more, so a level needs twice the headroom here to hold 60 FPS there (§30: GPU ≤ 10 ms on "Hoch").
   */
  budgetMs: TARGET_FRAME_MS / 2,
  /** Longest wait for the title scene to be complete (world generated, atlas loaded) before measuring [ms]. */
  readyTimeoutMs: 60_000,
  /**
   * The end of a measured frame's GPU work is seen by a fence (no read-back: a synchronous `readPixels` stalls the GPU
   * and makes Chrome warn). The fence is polled from the next task on without pause for this long [ms] – twice the
   * budget, where the time decides –, then every `slowPollMs` (a slow device is over the budget anyway).
   */
  spinMs: TARGET_FRAME_MS,
  slowPollMs: 4,
  /** A frame whose fence has not signalled after this long counts with this time [ms] (far over any budget). */
  gpuTimeoutMs: 2_000,
} as const;

/**
 * Dynamic halving of the light buffer (§6.3 "bei Frame-Einbrüchen dynamisch Lichtpuffer halbieren"): the light pass
 * renders at half the internal resolution per axis while frames drop, and returns to full resolution with hysteresis.
 */
export const LIGHT_BUFFER_GOVERNOR = {
  /** Weight of a new frame interval in the moving average (≈ the last 20 frames, a third of a second). */
  smoothing: 1 / 20,
  /** A frame counts as dropped when the average interval exceeds the target by this factor (a missed vsync is ×2). */
  dropFactor: 1.25,
  /** Frames the average must stay above the drop threshold before the buffer is halved (≈ ½ s at 60 Hz). */
  dropFrames: 30,
  /** With the halved buffer, frames count as healthy below this factor of the target (hysteresis band 1.1 … 1.25). */
  healthyFactor: 1.1,
  /** Healthy time with the halved buffer before the full buffer is tried again [ms]. */
  restoreAfterMs: 5_000,
  /** A drop within this time after going back to the full buffer counts as a failed attempt [ms]. */
  retryWindowMs: 3_000,
  /** Each failed attempt doubles the healthy time needed before the next one, up to this [ms]. */
  maxRestoreAfterMs: 60_000,
  /**
   * Intervals longer than this are pauses, not frame drops [ms]: a hidden tab, a paused loop, a debugger stop. They
   * reset the average instead of counting.
   */
  pauseMs: 1_000,
  /** One interval counts at most this multiple of the target (a single hitch cannot fill the average alone). */
  maxSampleFactor: 4,
} as const;

/** Division of the light buffer's resolution per axis while it is halved (§6.3). */
export const HALF_LIGHT_BUFFER_DIVISOR = 2;

/** Pass timing of the F3 overlay (§30 "GPU-Zeiten werden zusätzlich im F3-Overlay geprüft"). */
export const PASS_PROFILER = {
  /** Frames the timers keep measuring after the last request for their times (the overlay asks every frame). */
  windowFrames: 120,
  /** How often the overlay refreshes its pass table [ms] (4 × per second: readable, no work per frame). */
  refreshMs: 250,
} as const;
