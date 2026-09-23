/**
 * Light instances of a frame (MASTERPROMPT §6.1 pass 5): culls the scene's `LightList` (the shared
 * light source list, §12.1) against the target, keeps at most `maxLights` (quality level §6.3: the
 * ones nearest to the view), applies the canonical flicker and packs one record per light for the
 * instanced light quads of `lighting_point.vert`. Preallocated typed arrays, no allocation per frame
 * (they grow by doubling only when a frame has more lights than any before).
 *
 * | Float | Attribute (location) | Content |
 * |---|---|---|
 * | 0 | aGeom (1) vec4 | footprint x, y (world px), height, radius |
 * | 4 | aColor (2) vec3 | colour × intensity × flicker |
 * | 7 | aCone (3) vec4 | cone axis x, y (unit, y south), cos outer border, cos inner border |
 */
import { GBUFFER_HEIGHT_RANGE_PX } from '../gbuffer';
import type { LightList } from '../scene';
import { lightConeInner, lightConeOuter, lightFlicker } from './falloff';

export const LIGHT_INSTANCE_FLOATS = 11;
export const LIGHT_INSTANCE_STRIDE = LIGHT_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/** Float offsets of the attributes. */
export const LIGHT_OFFSET = { geom: 0, color: 4, cone: 7 } as const;
/** Attribute locations (`layout(location = …)` in lighting_point.vert). */
export const LIGHT_LOCATION = { corner: 0, geom: 1, color: 2, cone: 3 } as const;
/** Initial capacity (grows by doubling). */
export const INITIAL_LIGHT_CAPACITY = 64;

/** The world rectangle covered by the render target (whole pixels, y south). */
export interface LightView {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Per-frame limits (graphics settings). */
export interface LightBatchLimits {
  /** Most lights drawn (quality level §6.3: 32/64/128/256). */
  readonly maxLights: number;
  /** Scale of every light's flicker amount (accessibility: flicker reduction). */
  readonly flickerScale: number;
}

/**
 * Screen extent of a light quad above its footprint: pixels up to `height + radius` above the ground
 * (at most the G-buffer's height range) appear that far higher on screen.
 */
export function lightQuadLift(height: number, radius: number): number {
  return Math.min(height + radius, GBUFFER_HEIGHT_RANGE_PX);
}

/** Whether the quad of a light (footprint x, y, height, radius) overlaps the view. */
export function lightTouchesView(x: number, y: number, height: number, radius: number, view: LightView): boolean {
  const top = y - radius - lightQuadLift(height, radius);
  return x + radius > view.left && x - radius < view.left + view.width && y + radius > view.top && top < view.top + view.height;
}

export class LightBatch {
  private packed = new Float32Array(INITIAL_LIGHT_CAPACITY * LIGHT_INSTANCE_FLOATS);
  private order = new Uint32Array(INITIAL_LIGHT_CAPACITY);
  private score = new Float64Array(INITIAL_LIGHT_CAPACITY);
  private keep = new Uint8Array(INITIAL_LIGHT_CAPACITY);
  private n = 0;
  private visible = 0;

  /** Lights packed by the last `pack`. */
  get count(): number {
    return this.n;
  }

  /** Lights that touched the view in the last `pack` (before the `maxLights` cap). */
  get visibleCount(): number {
    return this.visible;
  }

  /** The packed records (`count · LIGHT_INSTANCE_FLOATS` floats are valid). */
  get data(): Float32Array {
    return this.packed;
  }

  private ensure(lights: number): void {
    if (lights <= this.order.length) return;
    let cap = this.order.length;
    while (cap < lights) cap *= 2;
    this.packed = new Float32Array(cap * LIGHT_INSTANCE_FLOATS);
    this.order = new Uint32Array(cap);
    this.score = new Float64Array(cap);
    this.keep = new Uint8Array(cap);
  }

  /**
   * Sorts `order[0…n)` by (score, index) in place: insertion sort, allocation-free and stable; the
   * light counts of §6.3 (≤ 256 on screen) keep it far below a millisecond.
   */
  private sortByScore(n: number): void {
    const order = this.order;
    const score = this.score;
    for (let i = 1; i < n; i++) {
      const v = order[i] ?? 0;
      const sv = score[v] ?? 0;
      let j = i - 1;
      while (j >= 0) {
        const u = order[j] ?? 0;
        const su = score[u] ?? 0;
        if (su < sv || (su === sv && u < v)) break;
        order[j + 1] = u;
        j--;
      }
      order[j + 1] = v;
    }
  }

  /** Culls, caps and packs the lights for presentation time `time`; returns the number packed. */
  pack(lights: LightList, view: LightView, time: number, limits: LightBatchLimits): number {
    const total = lights.count;
    this.ensure(total);
    const keep = this.keep;
    const cx = view.left + view.width / 2;
    const cy = view.top + view.height / 2;
    let visible = 0;
    for (let i = 0; i < total; i++) {
      const r = lights.radius[i] ?? 0;
      const x = lights.x[i] ?? 0;
      const y = lights.y[i] ?? 0;
      const on = r > 0 && (lights.intensity[i] ?? 0) > 0 && lightTouchesView(x, y, lights.height[i] ?? 0, r, view);
      keep[i] = on ? 1 : 0;
      if (!on) continue;
      this.order[visible] = i;
      // Math.sqrt instead of Math.hypot: the variadic builtin boxes its arguments (an allocation per light).
      const dx = x - cx;
      const dy = y - cy;
      this.score[i] = Math.sqrt(dx * dx + dy * dy) - r;
      visible++;
    }
    this.visible = visible;
    const max = Math.max(0, Math.floor(limits.maxLights));
    if (visible > max) {
      // Nearest to the view first; the cut lights are the ones mattering least on screen.
      this.sortByScore(visible);
      for (let j = max; j < visible; j++) keep[this.order[j] ?? 0] = 0;
    }
    const out = this.packed;
    let n = 0;
    for (let i = 0; i < total; i++) {
      if (keep[i] !== 1) continue;
      const o = n * LIGHT_INSTANCE_FLOATS;
      const scale = (lights.intensity[i] ?? 0) * lightFlicker((lights.flicker[i] ?? 0) * limits.flickerScale, lights.seed[i] ?? 0, time);
      const angle = lights.coneAngle[i] ?? 0;
      const dir = lights.coneDirection[i] ?? 0;
      out[o + LIGHT_OFFSET.geom] = lights.x[i] ?? 0;
      out[o + LIGHT_OFFSET.geom + 1] = lights.y[i] ?? 0;
      out[o + LIGHT_OFFSET.geom + 2] = lights.height[i] ?? 0;
      out[o + LIGHT_OFFSET.geom + 3] = lights.radius[i] ?? 0;
      out[o + LIGHT_OFFSET.color] = (lights.r[i] ?? 0) * scale;
      out[o + LIGHT_OFFSET.color + 1] = (lights.g[i] ?? 0) * scale;
      out[o + LIGHT_OFFSET.color + 2] = (lights.b[i] ?? 0) * scale;
      out[o + LIGHT_OFFSET.cone] = Math.cos(dir);
      out[o + LIGHT_OFFSET.cone + 1] = Math.sin(dir);
      out[o + LIGHT_OFFSET.cone + 2] = lightConeOuter(angle);
      out[o + LIGHT_OFFSET.cone + 3] = lightConeInner(angle);
      n++;
    }
    this.n = n;
    return n;
  }
}
