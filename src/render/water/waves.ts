/**
 * The interactive wave field (MASTERPROMPT §6.1 pass 7 "Wellengleichung in Ping-Pong-Textur um die Kamera"): the
 * discrete wave equation on a world-anchored grid of `WAVES.texelPx` px per texel,
 *
 *   h' = (2h − h⁻ + c² · ∇²h) · damping (+ impulses),   ∇²h = (4 · (h_N + h_S + h_E + h_W) + h_NE + h_NW + h_SE + h_SW − 20h) / 6,
 *
 * the isotropic nine-point Laplacian (the five-point one squares a ring off along the axes),
 * with the height held at 0 on land (the shore reflects, `shoreDamping` beside it swallows the ring). The GPU keeps
 * the field in two RGBA8 textures (current and previous height as 16-bit fixed point, `packHeight`) and steps it in
 * `water_wave.frag`; this module is its exact CPU mirror – the functions the shader implements line by line (the
 * unit test evaluates the GLSL against them) and `WaveField`, which runs the same steps on typed arrays.
 */
import { WAVES } from './params';

/**
 * One step of the wave equation at one texel (`waveStep` in water.glsl): `edges` is the sum of the four side
 * neighbours, `corners` the sum of the four diagonal ones (the isotropic nine-point Laplacian keeps a ring round).
 */
export function waveStep(h: number, prev: number, edges: number, corners: number, damping: number): number {
  return (2 * h - prev + (WAVES.speed2 * (4 * edges + corners - 20 * h)) / 6) * damping;
}

/**
 * Shape of an impulse: 1 at its centre, 0 with zero slope at `radius` [texels] – at least `WAVES.minImpulseTexels`, so no
 * kick excites the grid's own checkerboard (`impulseProfile` in water.glsl).
 */
export function impulseProfile(d: number, radius: number): number {
  const x = d / Math.max(radius, WAVES.minImpulseTexels);
  if (x >= 1) return 0;
  const k = 1 - x * x;
  return k * k;
}

/** Fixed-point steps of a packed height (16 bit over ±`WAVES.range`). */
export const PACK_STEPS = 65535;
const BYTE = 256;

/** A height as two bytes (hi, lo) of a 16-bit fixed-point value over ±`WAVES.range` (`packHeight` in water.glsl). */
export function packHeight(v: number, out: [number, number] = [0, 0]): [number, number] {
  const t = Math.min(1, Math.max(0, v / WAVES.range / 2 + 0.5));
  const u = Math.floor(t * PACK_STEPS + 0.5);
  const hi = Math.floor(u / BYTE);
  out[0] = hi;
  out[1] = u - hi * BYTE;
  return out;
}

/** The height of two packed bytes (`unpackHeight` in water.glsl). */
export function unpackHeight(hi: number, lo: number): number {
  return ((hi * BYTE + lo) / PACK_STEPS - 0.5) * 2 * WAVES.range;
}

/** One impulse for `WaveField.step`: centre and radius in texels, strength in height units. */
export interface FieldImpulse {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

/**
 * The CPU wave field: `width` × `height` texels, row 0 = north, heights stored as the GPU stores them (packed, so
 * rounding is the same). `land[i]` = 1 holds a texel at 0. Used by the unit tests; the game steps the GPU field.
 */
export class WaveField {
  private h: Float32Array;
  private prev: Float32Array;
  private next: Float32Array;
  readonly land: Uint8Array;
  private readonly packed: [number, number] = [0, 0];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.h = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
    this.land = new Uint8Array(n);
  }

  /** Height at texel (x, y); 0 outside the field and on land. */
  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const i = y * this.width + x;
    return this.land[i] === 1 ? 0 : (this.h[i] ?? 0);
  }

  private prevAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.prev[y * this.width + x] ?? 0;
  }

  /** Whether a texel is water with land beside it (4-neighbourhood). */
  private shore(x: number, y: number): boolean {
    const l = this.land;
    const w = this.width;
    const isLand = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < w && yy < this.height && l[yy * w + xx] === 1;
    return isLand(x + 1, y) || isLand(x - 1, y) || isLand(x, y + 1) || isLand(x, y - 1);
  }

  /** Rounds like the GPU storage (16-bit fixed point). */
  private stored(v: number): number {
    const p = packHeight(v, this.packed);
    return unpackHeight(p[0], p[1]);
  }

  /**
   * One step; the field's content moves by (`shiftX`, `shiftY`) texels first (the camera moved: texel p of the new
   * field is texel p + shift of the old one, what enters from outside is still water), impulses are added after it.
   */
  step(impulses: readonly FieldImpulse[] = [], shiftX = 0, shiftY = 0): void {
    const { width: w, height: hgt } = this;
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.land[i] === 1) {
          this.next[i] = 0;
          continue;
        }
        const sx = x + shiftX;
        const sy = y + shiftY;
        const damping = this.shore(x, y) ? WAVES.damping * WAVES.shoreDamping : WAVES.damping;
        const edges = this.at(sx, sy - 1) + this.at(sx, sy + 1) + this.at(sx + 1, sy) + this.at(sx - 1, sy);
        const corners = this.at(sx + 1, sy - 1) + this.at(sx - 1, sy - 1) + this.at(sx + 1, sy + 1) + this.at(sx - 1, sy + 1);
        let v = waveStep(this.at(sx, sy), this.prevAt(sx, sy), edges, corners, damping);
        for (const k of impulses) v += k.strength * impulseProfile(Math.hypot(x + 0.5 - k.x, y + 0.5 - k.y), k.radius);
        this.next[i] = this.stored(v);
      }
    }
    const shifted = new Float32Array(w * hgt);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) shifted[y * w + x] = this.stored(this.at(x + shiftX, y + shiftY));
    this.prev = shifted;
    const t = this.h;
    this.h = this.next;
    this.next = t;
  }

  /** Sum of squared heights over the field (the energy a damped field loses). */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.h.length; i++) e += (this.h[i] ?? 0) ** 2;
    return e;
  }

  /** Largest |height| at a Chebyshev ring of radius `r` texels around (cx, cy). */
  ringPeak(cx: number, cy: number, r: number): number {
    let m = 0;
    for (let d = -r; d <= r; d++) {
      m = Math.max(m, Math.abs(this.at(cx + d, cy - r)), Math.abs(this.at(cx + d, cy + r)), Math.abs(this.at(cx - r, cy + d)), Math.abs(this.at(cx + r, cy + d)));
    }
    return m;
  }
}

/** Texels of the wave field along one axis for a view of `viewPx` px (plus the margin on both sides). */
export function waveFieldTexels(viewPx: number): number {
  return Math.ceil((viewPx + 2 * WAVES.marginPx) / WAVES.texelPx);
}

/**
 * Where the wave field lies this frame: its top-left corner [world px] on the texel grid of the world (so the
 * waves stay put while the camera moves) around the view whose top-left is (`viewLeft`, `viewTop`).
 */
export function waveFieldOrigin(viewLeft: number, viewTop: number, out: { x: number; y: number }): { x: number; y: number } {
  const t = WAVES.texelPx;
  out.x = Math.floor((viewLeft - WAVES.marginPx) / t) * t;
  out.y = Math.floor((viewTop - WAVES.marginPx) / t) * t;
  return out;
}

/** One step of the wave clock [s] (a module constant: the frame computes no quotient for it). */
const WAVE_STEP_S = 1 / WAVES.stepHz;

/** Steps of the fixed-step clock from `simTime` to `time` (at most `WAVES.maxStepsPerFrame`), and the new clock. */
export function waveSteps(simTime: number, time: number, out: { steps: number; simTime: number }): { steps: number; simTime: number } {
  const dt = WAVE_STEP_S;
  if (!(time >= simTime)) {
    // The clock ran backwards (a scenario froze an earlier moment): start over from here.
    out.steps = 0;
    out.simTime = time;
    return out;
  }
  const due = Math.floor((time - simTime) / dt + 1e-9);
  if (due > WAVES.maxStepsPerFrame) {
    out.steps = WAVES.maxStepsPerFrame;
    out.simTime = time;
    return out;
  }
  out.steps = due;
  out.simTime = simTime + due * dt;
  return out;
}
