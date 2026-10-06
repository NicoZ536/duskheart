/**
 * Frame rate limit of the loop (MASTERPROMPT §29 "Grafik: … FPS-Limit, VSync"; docs/SPIEL.md §25 "Einstellungen"; M7-55).
 *
 * A browser cannot switch VSync: `requestAnimationFrame` always runs at the display's refresh rate. So the setting
 * `graphics.fpsLimit` takes VSync's place – 0 couples the frames to the refresh rate (every animation frame runs the
 * loop), a cap n lets the loop run only on animation frames at least 1000/n ms after the last one it ran (a small tolerance
 * catches the jitter of the display clock; the phase is kept, so 30 on a 60 Hz display is every second frame, not a drift).
 * Skipped animation frames do nothing but ask for the next one: the simulation catches up by its fixed steps on the next
 * frame that runs, so the cap changes how often the picture is drawn, never how fast the world goes.
 *
 * `limitedAnimationFrameClock` gives the `now`/`schedule`/`cancel` trio of `FixedStepLoop` (src/engine/loop.ts) with the
 * limit read on every animation frame (a settings change applies at once). No allocation per frame.
 */
import type { AnimationFrameHost, FixedStepLoopOptions } from './loop';

/** Milliseconds per second. */
const MS_PER_SECOND = 1000;
/**
 * Tolerance against the jitter of the animation frame clock [ms]: a frame up to this much early still counts (a 60 Hz
 * display ticks every 16,67 ms, so 30 FPS is reached by every second frame – 33,3 ms – even when one arrives at 32,9 ms).
 */
export const FRAME_LIMIT_TOLERANCE_MS = 2;

/** Statistics of a limited clock (debug, E2E). */
export interface FrameLimitStats {
  /** Animation frames the browser delivered. */
  animationFrames: number;
  /** Frames the loop ran. */
  delivered: number;
}

/** A frame clock for `FixedStepLoop` that keeps the loop at most at `limit()` frames per second (0 = every animation frame). */
export interface LimitedFrameClock extends Pick<FixedStepLoopOptions, 'now' | 'schedule' | 'cancel'> {
  readonly stats: Readonly<FrameLimitStats>;
}

export function limitedAnimationFrameClock(host: AnimationFrameHost, limit: () => number): LimitedFrameClock {
  const stats: FrameLimitStats = { animationFrames: 0, delivered: 0 };
  let pending: (() => void) | null = null;
  let handle = 0;
  let last = Number.NEGATIVE_INFINITY;
  // The animation-frame callback is a property, so it keeps its name through the minifier (as the loop's `frameCallback`
  // does): a trace of the page names the game's frames by it (`FunctionCall` "limitedFrameCallback" – only the outermost
  // function of an animation frame shows there; tests/e2e/fluessiges-laufen.spec.ts).
  const callbacks = {
    limitedFrameCallback: (): void => {
      handle = 0;
      stats.animationFrames++;
      const cb = pending;
      if (cb === null) return;
      const fps = limit();
      if (fps > 0) {
        const interval = MS_PER_SECOND / fps;
        const now = host.performance.now();
        const elapsed = now - last;
        if (elapsed < interval - FRAME_LIMIT_TOLERANCE_MS) {
          handle = host.requestAnimationFrame(callbacks.limitedFrameCallback);
          return;
        }
        // Keep the phase: the next frame is due one interval after the ideal time of this one, not after its late arrival
        // (no drift); after a stall of more than two intervals the clock starts afresh.
        last = elapsed <= 2 * interval ? last + interval : now;
      } else last = host.performance.now();
      pending = null;
      stats.delivered++;
      cb();
    },
  };
  const onFrame = callbacks.limitedFrameCallback;
  return {
    stats,
    now: () => host.performance.now(),
    schedule: (cb) => {
      pending = cb;
      if (handle === 0) handle = host.requestAnimationFrame(onFrame);
      return handle;
    },
    cancel: () => {
      pending = null;
      if (handle !== 0) host.cancelAnimationFrame(handle);
      handle = 0;
    },
  };
}
