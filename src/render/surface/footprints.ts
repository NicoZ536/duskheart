/**
 * Footprints in the snow (MASTERPROMPT §6.2 "verblassende Fußspuren im Schnee", M5-19): a walking figure leaves a
 * print every few pixels, left and right foot beside its path; each print fades over game time, faster while fresh
 * snow falls into it. The prints are world-fixed (they stay where they were made when the camera moves) and drawn
 * into the interaction texture, from where the terrain shader presses them into the snow.
 *
 * A ring buffer of typed arrays: no allocation while walking.
 */
import { SURFACE_PARAMS } from './params';
import type { SurfaceState } from './state';

const P = SURFACE_PARAMS.footprints;

export class FootprintTrail {
  readonly capacity: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly made: Float64Array;
  private readonly snowAtMade: Float64Array;
  private readonly side: Int8Array;
  private head = 0;
  private count = 0;
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private travelled = 0;
  private nextSide = 1;
  /** Snow that fell since the trail began, in minutes of fill (`fillPerSnowMinute` per snowing minute). */
  private snowFill = 0;
  private lastMinute = Number.NaN;

  constructor(capacity: number = P.capacity) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.x = new Float32Array(this.capacity);
    this.y = new Float32Array(this.capacity);
    this.made = new Float64Array(this.capacity);
    this.snowAtMade = new Float64Array(this.capacity);
    this.side = new Int8Array(this.capacity);
  }

  /** Prints held (fading ones included). */
  get size(): number {
    return this.count;
  }

  /** Forgets every print (another world, another layer). */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.lastX = Number.NaN;
    this.lastY = Number.NaN;
    this.travelled = 0;
  }

  /**
   * One frame: the figure's feet at (x, y) at game minute `minute`; `onSnow` = the ground there takes prints;
   * `snowing` = fresh snow is falling (it fills the prints). A figure that stands still leaves nothing new.
   */
  update(x: number, y: number, minute: number, onSnow: boolean, snowing: boolean): void {
    const lastMinute = this.lastMinute;
    if (minute !== lastMinute) {
      if (snowing && minute > lastMinute) this.snowFill += (minute - lastMinute) * P.fillPerSnowMinute;
      this.lastMinute = minute;
    }
    // A figure standing where it stood walks no distance (every frame of a still picture): no step is formed (§30).
    if (x === this.lastX && y === this.lastY) {
      if (!onSnow) this.travelled = 0;
      return;
    }
    if (!Number.isFinite(this.lastX)) {
      this.lastX = x;
      this.lastY = y;
      return;
    }
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const d = Math.sqrt(dx * dx + dy * dy);
    this.lastX = x;
    this.lastY = y;
    // A jump (teleport, respawn) starts a new trail.
    if (d > P.stridePx * 8) {
      this.travelled = 0;
      return;
    }
    if (!onSnow) {
      this.travelled = 0;
      return;
    }
    this.travelled += d;
    if (this.travelled < P.stridePx || d === 0) return;
    this.travelled -= P.stridePx;
    // Beside the path, perpendicular to the direction of travel.
    const nx = -dy / d;
    const ny = dx / d;
    const side = this.nextSide;
    this.nextSide = -side;
    this.push(Math.round(x + nx * side * P.sidePx), Math.round(y + ny * side * P.sidePx), minute, side);
  }

  /**
   * One frame whose figure stands where the last `update` saw it, at the same game minute (the caller knows it from
   * whole numbers: §30, no float of the feet is read): what `update` would do with the same feet and minute.
   */
  stand(onSnow: boolean): void {
    if (!onSnow) this.travelled = 0;
  }

  private push(x: number, y: number, minute: number, side: number): void {
    const i = this.head;
    this.x[i] = x;
    this.y[i] = y;
    this.made[i] = minute;
    this.snowAtMade[i] = this.snowFill;
    this.side[i] = side;
    this.head = (i + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Strength 0…1 of print `k` (0 = oldest held) at game minute `minute`. */
  strengthOf(k: number, minute: number): number {
    const i = (this.head - this.count + k + this.capacity * 2) % this.capacity;
    const age = minute - (this.made[i] as number) + (this.snowFill - (this.snowAtMade[i] as number));
    return Math.max(0, Math.min(1, 1 - age / P.fadeMinutes));
  }

  /** Hands the visible prints of game minute `minute` to the frame's surface (faded-out ones are skipped). */
  emit(state: SurfaceState, minute: number): void {
    for (let k = 0; k < this.count; k++) {
      const s = this.strengthOf(k, minute);
      if (s <= 0) continue;
      const i = (this.head - this.count + k + this.capacity * 2) % this.capacity;
      state.addFootprint(this.x[i] as number, this.y[i] as number, s, this.side[i] as number);
    }
  }
}
