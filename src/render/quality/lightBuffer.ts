/**
 * Dynamic halving of the light buffer (MASTERPROMPT §6.3 "bei Frame-Einbrüchen dynamisch Lichtpuffer halbieren",
 * M5-26): watches the intervals between presented frames and decides whether the light pass renders at half the
 * internal resolution. A pure state machine – the page feeds it one interval per frame, the tests feed it series.
 *
 * - **Drop detection:** a moving average of the frame interval (single intervals clamped to a few frames, so one
 *   hitch – a collection, a streamed chunk – cannot fill it alone); the buffer is halved once the average stays above
 *   `dropFactor` × the target for `dropFrames` frames in a row.
 * - **Hysteresis:** back to the full buffer only after `restoreAfterMs` of frames below the lower `healthyFactor`
 *   threshold; a drop within `retryWindowMs` after going back counts as a failed attempt and doubles the healthy time
 *   the next attempt needs (up to `maxRestoreAfterMs`) – the buffer never flips back and forth; a full buffer that
 *   holds past the window resets it.
 * - **Pauses:** an interval longer than `pauseMs` (hidden tab, paused loop) is no drop: it restarts the average.
 */
import { LIGHT_BUFFER_GOVERNOR, TARGET_FRAME_MS } from './params';

export type LightBufferGovernorParams = typeof LIGHT_BUFFER_GOVERNOR;

/** What the governor knows after the last frame (F3 overlay, `__dh.call('lightBuffer')`). */
export interface LightBufferVerdict {
  /** The governor asks for the halved buffer. */
  readonly halved: boolean;
  /** Moving average of the frame interval [ms] (0 before the first frame). */
  readonly averageMs: number;
  /** Frame period the game aims at [ms]. */
  readonly targetMs: number;
  /** Frames in a row above the drop threshold (full buffer). */
  readonly overFrames: number;
  /** Healthy time with the halved buffer so far [ms]. */
  readonly healthyMs: number;
  /** Healthy time the next return to the full buffer needs [ms]. */
  readonly restoreAfterMs: number;
  /** Times the buffer was halved. */
  readonly halvings: number;
}

export class LightBufferGovernor {
  private average = 0;
  private started = false;
  private over = 0;
  private halvedValue = false;
  private healthy = 0;
  private restoreAfter: number;
  /** Time of the frames seen so far [ms] (the governor's own clock: the sum of the intervals). */
  private clock = 0;
  /** Clock at the last return to the full buffer (−∞: none yet). */
  private restoredAt = Number.NEGATIVE_INFINITY;
  private halvings = 0;
  private target: number;

  constructor(
    private readonly params: LightBufferGovernorParams = LIGHT_BUFFER_GOVERNOR,
    targetMs: number = TARGET_FRAME_MS,
  ) {
    this.target = targetMs;
    this.restoreAfter = params.restoreAfterMs;
  }

  /** Whether the light buffer is halved. */
  get halved(): boolean {
    return this.halvedValue;
  }

  /** The frame period the game aims at [ms] (an FPS limit below 60 lowers the bar). */
  setTarget(targetMs: number): void {
    if (targetMs > 0 && Number.isFinite(targetMs)) this.target = targetMs;
  }

  /** One presented frame `intervalMs` after the previous one; returns whether the buffer is halved after it. */
  frame(intervalMs: number): boolean {
    const p = this.params;
    if (!(intervalMs >= 0) || intervalMs > p.pauseMs) {
      this.started = false;
      this.over = 0;
      return this.halvedValue;
    }
    this.clock += intervalMs;
    const sample = Math.min(intervalMs, this.target * p.maxSampleFactor);
    this.average = this.started ? this.average + (sample - this.average) * p.smoothing : sample;
    this.started = true;
    const ratio = this.average / this.target;
    if (!this.halvedValue) {
      if (this.clock - this.restoredAt > p.retryWindowMs) this.restoreAfter = p.restoreAfterMs;
      this.over = ratio > p.dropFactor ? this.over + 1 : 0;
      if (this.over >= p.dropFrames) this.halve();
    } else {
      this.healthy = ratio < p.healthyFactor ? this.healthy + intervalMs : 0;
      if (this.healthy >= this.restoreAfter) this.restore();
    }
    return this.halvedValue;
  }

  /** Back to the start: full buffer, no history (a new scene, a changed setting). */
  reset(): void {
    this.average = 0;
    this.started = false;
    this.over = 0;
    this.halvedValue = false;
    this.healthy = 0;
    this.restoreAfter = this.params.restoreAfterMs;
    this.restoredAt = Number.NEGATIVE_INFINITY;
  }

  verdict(): LightBufferVerdict {
    return {
      halved: this.halvedValue,
      averageMs: this.average,
      targetMs: this.target,
      overFrames: this.over,
      healthyMs: this.healthy,
      restoreAfterMs: this.restoreAfter,
      halvings: this.halvings,
    };
  }

  private halve(): void {
    const p = this.params;
    // Dropped again soon after the last return: that attempt failed – wait longer before the next one.
    if (this.clock - this.restoredAt <= p.retryWindowMs) this.restoreAfter = Math.min(p.maxRestoreAfterMs, this.restoreAfter * 2);
    this.halvedValue = true;
    this.over = 0;
    this.healthy = 0;
    this.halvings++;
  }

  private restore(): void {
    this.halvedValue = false;
    this.healthy = 0;
    this.over = 0;
    this.restoredAt = this.clock;
  }
}
