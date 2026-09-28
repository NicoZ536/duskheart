/**
 * Distortion sources of a frame (MASTERPROMPT §6.1 pass 9 "Verzerrungspuffer (Schockwellen, Hitze,
 * Unterwasser)", M5-13): shock wave rings and heat areas in world pixels, filled per frame by their
 * producers – the particle, fire and combat effects push into `RenderScene.post.distortion` – and drawn
 * by the distortion pass (`passes/distortionPass.ts`) into an offset field the post pass samples the
 * picture through. Struct-of-arrays in preallocated typed arrays, no allocation per frame (the list
 * grows by doubling only when a frame has more sources than any before).
 *
 * Offsets are whole pixels when the picture is read (pixel art stays pixel art), so a shock wave bends
 * the scene in pixel steps like the SNES mode-7 wobble instead of blurring it.
 */

/** Kinds of distortion sources. */
export const DISTORTION_KIND = {
  /** Expanding ring that pushes the picture outward at its front (explosions, heavy landings, boss roars). */
  shockwave: 0,
  /** Rising heat haze in an ellipse (fires, lava, forges). */
  heat: 1,
} as const;

/** Largest offset the field can store [px] (RGBA8: 1/255 of it per step). */
export const DISTORTION_RANGE_PX = 8;
/** Initial capacity (grows by doubling). */
export const DISTORTION_CAPACITY = 32;

/**
 * Radial sampling offset of a shock wave ring (mirror of `shockwaveProfile` in distortion.glsl): `u` =
 * (distance − radius) / width, in [−1, 1] across the ring; the picture at a pixel is read `profile ×
 * strength` px further out along the ray from the centre (negative: further in). Zero at both edges and
 * in the middle of the ring, largest a third of the way from either edge: the inner half reads from
 * further out, the outer half from further in – the picture under the ring is squeezed into a lens that
 * travels outward with it.
 */
export function shockwaveProfile(u: number): number {
  if (u <= -1 || u >= 1) return 0;
  const taper = 1 - u * u;
  return -Math.sin(Math.PI * u) * taper;
}

/**
 * State of a shock wave `age` seconds after it started: ring radius [px] and strength [px] for a wave
 * that travels at `speed` px/s and dies at `life` seconds (strength falls off quadratically), with its
 * peak `strength`. Writes `out` and returns it; strength 0 when the wave is over.
 */
export function shockwaveAt(age: number, speed: number, life: number, strength: number, out: { radius: number; strength: number }): { radius: number; strength: number } {
  if (!(age >= 0) || !(life > 0) || age >= life) {
    out.radius = 0;
    out.strength = 0;
    return out;
  }
  const fade = 1 - age / life;
  out.radius = age * speed;
  out.strength = strength * fade * fade;
  return out;
}

/** The frame's distortion sources (`RenderScene.post.distortion`). */
export class DistortionList {
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  /** Shock wave: ring radius; heat: half width [px]. */
  a: Float32Array;
  /** Shock wave: ring width; heat: half height [px]. */
  b: Float32Array;
  /** Largest offset [px]. */
  strength: Float32Array;
  private n = 0;
  private cap: number;

  constructor(capacity = DISTORTION_CAPACITY) {
    this.cap = Math.max(1, Math.floor(capacity));
    this.kind = new Uint8Array(this.cap);
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.a = new Float32Array(this.cap);
    this.b = new Float32Array(this.cap);
    this.strength = new Float32Array(this.cap);
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const f = (src: Float32Array): Float32Array => {
      const out = new Float32Array(cap);
      out.set(src);
      return out;
    };
    const kind = new Uint8Array(cap);
    kind.set(this.kind);
    this.kind = kind;
    this.x = f(this.x);
    this.y = f(this.y);
    this.a = f(this.a);
    this.b = f(this.b);
    this.strength = f(this.strength);
    this.cap = cap;
  }

  private push(kind: number, x: number, y: number, a: number, b: number, strength: number): number {
    if (!(strength > 0) || !(a > 0) || !(b > 0)) return -1;
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.a[i] = a;
    this.b[i] = b;
    this.strength[i] = Math.min(strength, DISTORTION_RANGE_PX);
    return i;
  }

  /** A shock wave ring around world px (x, y): current `radius`, ring `width`, peak offset `strength` [px]. Returns its index or −1 (nothing to draw). */
  shockwave(x: number, y: number, radius: number, width: number, strength: number): number {
    return this.push(DISTORTION_KIND.shockwave, x, y, radius, width, strength);
  }

  /** Heat haze in the ellipse around world px (x, y) with half axes (rx, ry), peak offset `strength` [px]. */
  heat(x: number, y: number, rx: number, ry: number, strength: number): number {
    return this.push(DISTORTION_KIND.heat, x, y, rx, ry, strength);
  }
}
