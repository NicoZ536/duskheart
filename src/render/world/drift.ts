/**
 * Fields the wind carries across the view – cloud shadows, fog banks, caustics, the small wind waves – move by an
 * offset that is **integrated** over the presentation clock (offset += velocity · Δt), never velocity × total time: a
 * change of the wind (a weather blend, a new weather period, a region border, reduced motion switched on) changes how
 * fast a field moves on, not where it is. Each offset is kept modulo its field's period (the tile of its noise, the
 * wavelength of its wave), so it stays small and exact in the shaders' 32-bit floats however long the game runs – the
 * field's noise repeats with that period, so the wrap shows no seam.
 *
 * The offset starts over at the closed form velocity · time (wrapped) when the clock jumps: before the first frame, when
 * the clock runs back (another session, a loaded game on a fresh clock), after a gap longer than the game loop ever
 * advances the clock in one frame (`DRIFT_MAX_GAP_SECONDS`: the field was not shown in between, e.g. underground), and
 * in a still picture whose world moved on – the clock frozen for a screenshot while a scenario steps the simulation
 * (`key` changed, time did not): from then on, as long as the clock stands, every frame takes the closed form, so the
 * picture shows the drift of its presentation time under the wind it ends with (also when the wind is computed a frame
 * after the step), the same in every run. At a frame rate above the tick rate the clock also stands between frames, but
 * the simulation does too (the loop advances both in one step), so the key does not change and nothing jumps.
 *
 * **Whole numbers (§30 "keine Allokation im Frame-Pfad"):** code that runs once a frame stays in V8's baseline tier for
 * a long time, where every float it computes is a new heap number. So a frame computes one float – the clock in
 * `DRIFT_CLOCK_HZ` ticks (`driftClock`) – and integrates in small integers: velocities in `DRIFT_UNITS` per px per
 * second (rounded when they change, `setVelocity`), offsets in those units; the shaders divide by `DRIFT_UNITS`.
 *
 * The offset handed out lies in [−period/2, period/2): a field that has drifted less than half its period sits where
 * velocity × time puts it, in either direction.
 */
import { BALANCE } from '../../content/balance';
import { MAX_TIME_SCALE } from '../../engine/loop';

/** Steps per px of a drift offset (the shaders divide by it). */
export const DRIFT_UNITS = 16;
/** Ticks per second of the drift clock (a power of two: the integration divides by shifting). */
const CLOCK_SHIFT = 10;
export const DRIFT_CLOCK_HZ = 1 << CLOCK_SHIFT;
/** Largest period in units × clock ticks (small integers of V8: 31 bits with sign). */
const MAX_PERIOD_Q = 2 ** 30;

/**
 * Longest step of the presentation clock between two frames that is still integrated [s]: the loop runs at most
 * `maxCatchUpSteps` × ⌈time scale⌉ ticks per frame (sleep and fast forward up to ×32), each a tick long.
 */
export const DRIFT_MAX_GAP_SECONDS = (BALANCE.time.maxCatchUpSteps * MAX_TIME_SCALE) / BALANCE.time.tickHz;
const MAX_GAP_TICKS = Math.ceil(DRIFT_MAX_GAP_SECONDS * DRIFT_CLOCK_HZ);

/**
 * Presentation time `time` [s] as ticks of the drift clock: a whole number (a small integer of V8 for the first 2²⁰ s
 * of a session; the one float a frame computes).
 */
export function driftClock(time: number): number {
  return Math.floor(time * DRIFT_CLOCK_HZ);
}

/** `v` modulo `period` in [0, period), as a small integer (the closed form's product may be a float); period 0: `v`. */
function wrapPeriod(v: number, period: number): number {
  if (period === 0 || (v >= 0 && v < period)) return v;
  const r = v % period;
  return (r < 0 ? r + period : r) | 0;
}

/**
 * An offset that drifts with a velocity (× a fixed scale) and wraps modulo a period per axis – in whole `DRIFT_UNITS`
 * (x, y), integrated in units × clock ticks.
 */
export class DriftOffset {
  /** The offset of the last frame [1/DRIFT_UNITS px, whole numbers], within [−period/2, period/2) per axis. */
  x = 0;
  y = 0;
  /** The offset in units × clock ticks, and the velocity in units per second (whole numbers). */
  private qx = 0;
  private qy = 0;
  private vx = 0;
  private vy = 0;
  /** Periods in units × clock ticks (whole numbers; 0: an axis that does not drift), and in units with their halves. */
  private readonly periodQX: number;
  private readonly periodQY: number;
  private readonly periodUX: number;
  private readonly periodUY: number;
  private readonly halfUX: number;
  private readonly halfUY: number;
  private started = false;
  private lastClock = 0;
  private lastKey = 0;
  /** The clock stands while the world moved on (a still picture): every frame takes the closed form. */
  private still = false;

  /**
   * @param periodX period of the field along x [px] (a whole number of 1/`DRIFT_UNITS` px; 0: the axis does not drift)
   * @param periodY period along y [px]
   * @param scale factor of every velocity handed to `setVelocity` (a layer's share of the wind, a drift speed)
   */
  constructor(
    periodX: number,
    periodY: number,
    readonly scale = 1,
  ) {
    this.periodQX = periodOf(periodX);
    this.periodQY = periodOf(periodY);
    this.periodUX = this.periodQX >> CLOCK_SHIFT;
    this.periodUY = this.periodQY >> CLOCK_SHIFT;
    this.halfUX = this.periodUX >> 1;
    this.halfUY = this.periodUY >> 1;
  }

  /** The offset of the last frame along x and y [px]. */
  get xPx(): number {
    return this.x / DRIFT_UNITS;
  }
  get yPx(): number {
    return this.y / DRIFT_UNITS;
  }

  /**
   * Sets the velocity (`vx`, `vy`) × `scale` [px/s], rounded to whole units per second – called when it changes. (`| 0`:
   * a rounded −0 would be a float and make every sum a float.)
   */
  setVelocity(vx: number, vy: number): void {
    this.vx = this.periodQX === 0 ? 0 : Math.round(vx * this.scale * DRIFT_UNITS) | 0;
    this.vy = this.periodQY === 0 ? 0 : Math.round(vy * this.scale * DRIFT_UNITS) | 0;
  }

  /**
   * Moves on to drift clock `clock` (`driftClock` of the presentation time). `key` identifies the state that sets the
   * velocity (the simulation tick; a constant where only the clock moves the field): a frame whose clock stands still
   * while the key changed takes the closed form, and so does every frame after it until the clock moves again.
   */
  advance(clock: number, key: number): void {
    const dt = clock - this.lastClock;
    if (this.started && dt === 0 && key !== this.lastKey) this.still = true;
    else if (dt !== 0) this.still = false;
    if (!this.started || dt < 0 || dt > MAX_GAP_TICKS || this.still) {
      this.qx = wrapPeriod(this.vx * clock, this.periodQX);
      this.qy = wrapPeriod(this.vy * clock, this.periodQY);
    } else if (dt > 0) {
      this.qx = wrapPeriod(this.qx + this.vx * dt, this.periodQX);
      this.qy = wrapPeriod(this.qy + this.vy * dt, this.periodQY);
    }
    const x = this.qx >> CLOCK_SHIFT;
    const y = this.qy >> CLOCK_SHIFT;
    this.x = x >= this.halfUX && this.periodUX > 0 ? x - this.periodUX : x;
    this.y = y >= this.halfUY && this.periodUY > 0 ? y - this.periodUY : y;
    this.started = true;
    this.lastClock = clock;
    this.lastKey = key;
  }

  /** Writes the offset [units] into `out` at `index` (x) and `index + 1` (y). */
  store(out: Float32Array, index: number): void {
    out[index] = this.x;
    out[index + 1] = this.y;
  }

  /** Writes the offset's x [units] into `out` at `index` (a field drifting along one axis). */
  storeX(out: Float32Array, index: number): void {
    out[index] = this.x;
  }

  /** Forgets the clock: the next `advance` starts over at the closed form. */
  reset(): void {
    this.started = false;
    this.still = false;
  }
}

/** A period of `px` px in units × clock ticks (0: none); throws for one that is no whole number of units or too long. */
function periodOf(px: number): number {
  if (px === 0) return 0;
  const units = px * DRIFT_UNITS;
  const whole = Math.round(units);
  if (!(whole > 0) || Math.abs(units - whole) > 1e-6) throw new Error(`Drift: Periode ${px} px ist kein ganzes Vielfaches von 1/${DRIFT_UNITS} px`);
  const q = whole * DRIFT_CLOCK_HZ;
  if (q > MAX_PERIOD_Q) throw new Error(`Drift: Periode ${px} px ist zu lang (höchstens ${MAX_PERIOD_Q / DRIFT_CLOCK_HZ / DRIFT_UNITS} px)`);
  return q;
}
