/**
 * CPU mirrors of the light strand's shader functions (M5-01, M5-03, M5-05, M5-34, M5-35), statement by statement:
 * the unit tests check the passes' arithmetic here, and CPU consumers that must agree with the picture can use it.
 *
 * - `OccluderField`: the occluder mask of a frame (`occluder_mask.*`: footprints with MAX blending, 8-bit heights),
 *   its seeds (`jfa_seed.frag`), the jump flood (`jfa.glsl`, `jfa_step.frag`) and the resolved distance and info
 *   targets (`sdf_resolve.frag`); `groundPoint` is `sdfGroundPoint` (sdf.glsl).
 * - `lightShadow`, `lightHousing`, `flameNearField` (lighting.glsl) on such a field; `sdfOcclusion` (shadow.glsl).
 * - `OccluderRing`, `occluderAt`, `raySurvives` (sdf_ring.glsl, lighting.glsl): the coarse ring of walls and cliffs
 *   beyond the field's frame and the march through it (M5 review M2, Minor 2).
 * - `valueNoise`, `cloudDensity`, `cloudShade` (shadow_noise.glsl, shadow.glsl).
 * - `sunBlockSpan`, `paneCell` (shadow_block.frag): the build grid's sun casters.
 *
 * The field's texel (i, j) covers world pixels [x0 + i, x0 + i + 1) × [y0 + j, y0 + j + 1), rows counted southwards
 * (the GPU targets count from the bottom; the arithmetic is the same).
 */
import { GBUFFER_HEIGHT_RANGE_PX } from '../gbuffer';
import { OCCLUDER_FLOATS, OCCLUDER_OFFSET, OCCLUDER_SHAPE, PRISM_FLAG, type OccluderList } from './occluders';
import { SUN_CASTER_AXIS, SUN_CASTER_FLOATS, SUN_CASTER_OFFSET, type SunCasterList } from './sunCasters';
import { CLEAR_SKY_COVER, CLOUD_OCTAVE_PERIODS, CLOUDS, FLAME_NEAR_FIELD, LIGHT_HOUSING, LIGHTMAP_COMPARISON, OCCLUDER_CLASS, OCCLUDER_RING, OPENING_MARK, POINT_SHADOW, ROOF_MARK, SDF, SDF_AO, STRUCTURAL_TOP_PX } from './params';

/** What occludes at a texel of the mask or the info target (`sdfOccluder`). */
export interface Occluder {
  /** Top of decor [px]. */
  decor: number;
  /** A wall, closed door or rock: blocks every ray. */
  structural: boolean;
  /** Top of raised terrain [px]. */
  terrain: number;
  /** Height of the ground [px]. */
  ground: number;
}

/** No seed of the jump flood. */
const NO_SEED = -1;
/** Components of a mask texel. */
const DECOR = 0;
const STRUCTURAL = 1;
const TERRAIN = 2;
const GROUND = 3;
/** Offsets of the jump flood's samples, in the order `jfa_step.frag` visits them. */
const STEP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** GLSL `smoothstep`. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** A height [px] as the 8-bit mask channel stores it (`clamp(h / range) → 8 bits → × range`). */
export function maskHeight(h: number): number {
  return (Math.round(Math.max(0, Math.min(1, h / GBUFFER_HEIGHT_RANGE_PX)) * 255) / 255) * GBUFFER_HEIGHT_RANGE_PX;
}

/** The occluder mask and distance fields of one frame on the CPU. */
export class OccluderField {
  readonly mask: Float32Array;
  /** Nearest seed per texel (texel index), after `flood`. */
  readonly nearest: Int32Array;
  /** Distance to the nearest seed [px], capped at `SDF.maxDistancePx`, after `flood`. */
  readonly distance: Float32Array;

  /**
   * @param x0 world px of the field's north-west corner
   * @param y0 world px of the field's north-west corner
   */
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.mask = new Float32Array(n * 4);
    this.nearest = new Int32Array(n).fill(NO_SEED);
    this.distance = new Float32Array(n).fill(SDF.maxDistancePx);
  }

  /** Texel column and row under world point (x, y) (`sdfTexel`; may lie outside). */
  texel(x: number, y: number): [number, number] {
    return [Math.floor(x - this.x0), Math.floor(y - this.y0)];
  }

  /** Whether texel (i, j) lies in the field (`sdfInside`). */
  inside(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.width && j < this.height;
  }

  /** The mask at texel (i, j) (`sdfOccluder` of the mask; nothing outside). */
  maskAt(i: number, j: number): Occluder {
    return this.inside(i, j) ? this.read(j * this.width + i) : { decor: 0, structural: false, terrain: 0, ground: 0 };
  }

  /** The info target at texel (i, j): the mask at its nearest seed (nothing without a seed or outside). */
  infoAt(i: number, j: number): Occluder {
    if (!this.inside(i, j)) return { decor: 0, structural: false, terrain: 0, ground: 0 };
    const s = this.nearest[j * this.width + i] ?? NO_SEED;
    return s === NO_SEED ? { decor: 0, structural: false, terrain: 0, ground: 0 } : this.read(s);
  }

  /** The distance field at texel (i, j) (`sdfDistance`: the cap outside). */
  distanceAt(i: number, j: number): number {
    return this.inside(i, j) ? (this.distance[j * this.width + i] ?? SDF.maxDistancePx) : SDF.maxDistancePx;
  }

  private read(k: number): Occluder {
    const m = this.mask;
    return { decor: m[k * 4 + DECOR] ?? 0, structural: (m[k * 4 + STRUCTURAL] ?? 0) > 0.5, terrain: m[k * 4 + TERRAIN] ?? 0, ground: m[k * 4 + GROUND] ?? 0 };
  }

  /** Draws the footprints of `list` into the mask (`occluder_mask.*`: pixel centres inside, MAX per channel). */
  draw(list: OccluderList): void {
    const r = list.records;
    for (let k = 0; k < list.count; k++) {
      const o = k * OCCLUDER_FLOATS;
      const cx = r[o] ?? 0;
      const cy = r[o + 1] ?? 0;
      const hx = r[o + 2] ?? 0;
      const hy = r[o + 3] ?? 0;
      const shape = (r[o + OCCLUDER_OFFSET.shapePrism] ?? 0) % PRISM_FLAG;
      const top = maskHeight(r[o + OCCLUDER_OFFSET.top] ?? 0);
      const cls = r[o + OCCLUDER_OFFSET.cls] ?? 0;
      const ground = maskHeight(r[o + OCCLUDER_OFFSET.ground] ?? 0);
      const opening = cls > OCCLUDER_CLASS.opening - 0.5;
      const roof = !opening && cls > OCCLUDER_CLASS.roof - 0.5;
      const channel = opening || roof ? STRUCTURAL : cls > OCCLUDER_CLASS.terrain - 0.5 ? TERRAIN : cls > OCCLUDER_CLASS.structural - 0.5 ? STRUCTURAL : DECOR;
      const value = opening ? OPENING_MARK : roof ? ROOF_MARK : channel === STRUCTURAL ? 1 : top;
      // The quad reaches half a pixel beyond the box; pixel centres inside it are shaded.
      const [i0, j0] = this.texel(cx - hx - 0.5, cy - hy - 0.5);
      const [i1, j1] = this.texel(cx + hx + 0.5, cy + hy + 0.5);
      const slackX = 0.49 / Math.max(hx, 0.5);
      const slackY = 0.49 / Math.max(hy, 0.5);
      for (let j = Math.max(0, j0); j <= Math.min(this.height - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.width - 1, i1); i++) {
          const px = this.x0 + i + 0.5;
          const py = this.y0 + j + 0.5;
          if (Math.abs(px - cx) >= hx + 0.5 || Math.abs(py - cy) >= hy + 0.5) continue;
          const lx = (px - cx) / hx;
          const ly = (py - cy) / hy;
          if (shape === OCCLUDER_SHAPE.ellipse ? lx * lx + ly * ly > 1 : Math.abs(lx) > 1 + slackX || Math.abs(ly) > 1 + slackY) continue;
          const t = (j * this.width + i) * 4;
          this.mask[t + channel] = Math.max(this.mask[t + channel] ?? 0, value);
          this.mask[t + GROUND] = Math.max(this.mask[t + GROUND] ?? 0, ground);
        }
      }
    }
  }

  /** Whether texel (i, j) seeds the occluder field (`jfa_seed.frag`). */
  isSeed(i: number, j: number): boolean {
    const m = this.maskAt(i, j);
    const eps = SDF.seedEpsilonPx;
    const terrainAt = (a: number, b: number): number => (this.inside(a, b) ? this.maskAt(a, b).terrain : m.terrain);
    const lowest = Math.min(terrainAt(i + 1, j), terrainAt(i - 1, j), terrainAt(i, j + 1), terrainAt(i, j - 1));
    return m.structural || m.decor > m.terrain + eps || m.terrain > lowest + eps;
  }

  /** Seeds, jump flood with steps `steps` and resolve (`sdf_resolve.frag`). */
  flood(steps: readonly number[]): void {
    const w = this.width;
    const seeds = new Int32Array(w * this.height).fill(NO_SEED);
    for (let j = 0; j < this.height; j++) for (let i = 0; i < w; i++) if (this.isSeed(i, j)) seeds[j * w + i] = j * w + i;
    const result = jumpFlood(seeds, w, this.height, steps);
    this.nearest.set(result);
    for (let k = 0; k < result.length; k++) {
      const s = result[k] ?? NO_SEED;
      if (s === NO_SEED) {
        this.distance[k] = SDF.maxDistancePx;
        continue;
      }
      const dx = (s % w) - (k % w);
      const dy = Math.floor(s / w) - Math.floor(k / w);
      this.distance[k] = Math.min(Math.hypot(dx, dy), SDF.maxDistancePx);
    }
  }

  /** Whether a roof covers world point (x, y) (`sdfRoofed`). */
  roofed(x: number, y: number): boolean {
    const [i, j] = this.texel(x, y);
    return this.inside(i, j) && (this.mask[(j * this.width + i) * 4 + STRUCTURAL] ?? 0) > 0.5 * ROOF_MARK;
  }

  /** Whether texel (i, j) lies in an opening of a wall (`sdfOpening`). */
  opening(i: number, j: number): boolean {
    if (!this.inside(i, j)) return false;
    const g = this.mask[(j * this.width + i) * 4 + STRUCTURAL] ?? 0;
    return g > 0.5 * (ROOF_MARK + OPENING_MARK) && g < 0.5;
  }

  /** Height of the ground at world point (x, y) (`sdfGroundHeight`). */
  groundHeight(x: number, y: number): number {
    const [i, j] = this.texel(x, y);
    return this.maskAt(i, j).ground;
  }

  /**
   * Ground point of a pixel drawn at world point (x, y) with G-buffer height `z` (`sdfGroundPoint`): moved south by
   * its height above the ground it stands on (the world is drawn without shifting raised levels up).
   */
  groundPoint(x: number, y: number, z: number): [number, number] {
    let gy = y + Math.max(0, z - this.groundHeight(x, y));
    gy = y + Math.max(0, z - this.groundHeight(x, gy));
    return [x, y + Math.max(0, z - this.groundHeight(x, gy))];
  }
}

/**
 * The occluder ring (M5 review M2, `occluder_mask.*` drawn with the ring's slack; read by sdf_ring.glsl): the mask's
 * structural, terrain and ground channels at `texelPx` px per texel – decor is left out. Texel (i, j) covers world
 * pixels [x0 + i·T, x0 + (i + 1)·T) × [y0 + j·T, y0 + (j + 1)·T), rows counted southwards.
 */
export class OccluderRing {
  readonly mask: Float32Array;

  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly width: number,
    readonly height: number,
    readonly texelPx: number = OCCLUDER_RING.texelPx,
  ) {
    this.mask = new Float32Array(width * height * 4);
  }

  /** Texel under world point (x, y) (`ringTexel`; may lie outside). */
  texel(x: number, y: number): [number, number] {
    return [Math.floor((x - this.x0) / this.texelPx), Math.floor((y - this.y0) / this.texelPx)];
  }

  inside(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.width && j < this.height;
  }

  /**
   * What occludes at world point (x, y), or null outside the ring: decor 0 for the rays and ground points (`occluderAt`),
   * its decor top with `withDecor` (`occluderWithDecorAt`: the housing of a light beside the view, M5-45).
   */
  at(x: number, y: number, withDecor = false): Occluder | null {
    const [i, j] = this.texel(x, y);
    if (!this.inside(i, j)) return null;
    const k = (j * this.width + i) * 4;
    const m = this.mask;
    return { decor: withDecor ? (m[k + DECOR] ?? 0) : 0, structural: (m[k + STRUCTURAL] ?? 0) > 0.5, terrain: m[k + TERRAIN] ?? 0, ground: m[k + GROUND] ?? 0 };
  }

  /**
   * Draws the footprints of `list` (the scene's own records) into the ring: texel centres within half a texel less a
   * hundredth of the box (rectangles) or inside the ellipse, MAX per channel – a wall keeps every texel it touches.
   */
  draw(list: OccluderList, count = list.count): void {
    const r = list.records;
    const t = this.texelPx;
    const tolerance = t / 2 - 0.01;
    for (let k = 0; k < count; k++) {
      const o = k * OCCLUDER_FLOATS;
      const cx = r[o] ?? 0;
      const cy = r[o + 1] ?? 0;
      const hx = r[o + 2] ?? 0;
      const hy = r[o + 3] ?? 0;
      const shape = (r[o + OCCLUDER_OFFSET.shapePrism] ?? 0) % PRISM_FLAG;
      const top = maskHeight(r[o + OCCLUDER_OFFSET.top] ?? 0);
      const cls = r[o + OCCLUDER_OFFSET.cls] ?? 0;
      const ground = maskHeight(r[o + OCCLUDER_OFFSET.ground] ?? 0);
      const opening = cls > OCCLUDER_CLASS.opening - 0.5;
      const roof = !opening && cls > OCCLUDER_CLASS.roof - 0.5;
      const channel = opening || roof ? STRUCTURAL : cls > OCCLUDER_CLASS.terrain - 0.5 ? TERRAIN : cls > OCCLUDER_CLASS.structural - 0.5 ? STRUCTURAL : DECOR;
      const value = opening ? OPENING_MARK : roof ? ROOF_MARK : channel === STRUCTURAL ? 1 : top;
      const [i0, j0] = this.texel(cx - hx - t / 2, cy - hy - t / 2);
      const [i1, j1] = this.texel(cx + hx + t / 2, cy + hy + t / 2);
      for (let j = Math.max(0, j0); j <= Math.min(this.height - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.width - 1, i1); i++) {
          const px = this.x0 + (i + 0.5) * t;
          const py = this.y0 + (j + 0.5) * t;
          if (Math.abs(px - cx) >= hx + t / 2 || Math.abs(py - cy) >= hy + t / 2) continue;
          const lx = (px - cx) / hx;
          const ly = (py - cy) / hy;
          const outside = shape === OCCLUDER_SHAPE.ellipse ? lx * lx + ly * ly > 1 : Math.abs(px - cx) > hx + tolerance || Math.abs(py - cy) > hy + tolerance;
          if (outside) continue;
          const q = (j * this.width + i) * 4;
          this.mask[q + channel] = Math.max(this.mask[q + channel] ?? 0, value);
          this.mask[q + GROUND] = Math.max(this.mask[q + GROUND] ?? 0, ground);
        }
      }
    }
  }
}

/**
 * What occludes at world point (x, y) (`occluderAt` of sdf_ring.glsl): the field's mask inside its frame, the ring beyond
 * it (decor 0), null beyond both (unknown).
 */
export function occluderAt(field: OccluderField, ring: OccluderRing | null, x: number, y: number): Occluder | null {
  const [i, j] = field.texel(x, y);
  if (field.inside(i, j)) return field.maskAt(i, j);
  return ring === null ? null : ring.at(x, y);
}

/**
 * What occludes at world point (x, y) with the decor beyond the field's frame (`occluderWithDecorAt` of sdf_ring.glsl,
 * M5-45): the field's mask inside its frame, the ring with its decor tops beyond it, null beyond both.
 */
export function occluderWithDecorAt(field: OccluderField, ring: OccluderRing | null, x: number, y: number): Occluder | null {
  const [i, j] = field.texel(x, y);
  if (field.inside(i, j)) return field.maskAt(i, j);
  return ring === null ? null : ring.at(x, y, true);
}

/** Whether decor stands at `m` (a decor top above the terrain top; `null`: unknown, none). */
function decorKnownAt(m: Occluder | null): boolean {
  return m !== null && decorAt(m);
}

/**
 * The rest of a ray from `from` along `dir` between `t` and `end` (`raySurvives` of lighting.glsl): 1 when no wall,
 * closed door or terrain above the light's ground `base` lies on it, sampled every `OCCLUDER_RING.stepPx` in the field and
 * beyond it in the ring; 0 at the first one, where the ray leaves both, or when the steps run out. `skip`: the receiver
 * still stands in its own wall or cliff face.
 */
export function raySurvives(field: OccluderField, ring: OccluderRing | null, from: readonly [number, number], dir: readonly [number, number], t: number, end: number, base: number, skip: boolean): number {
  let inOwn = skip;
  for (let i = 0; i < OCCLUDER_RING.maxSteps; i++) {
    if (t >= end) return 1;
    const m = occluderAt(field, ring, from[0] + dir[0] * t, from[1] + dir[1] * t);
    if (m === null) return 0;
    const blocks = m.structural || m.terrain > base + POINT_SHADOW.heightEpsilonPx;
    if (blocks && !inOwn) return 0;
    inOwn = inOwn && blocks;
    t += OCCLUDER_RING.stepPx;
  }
  return 0;
}

/** One jump flood over `seeds` (per texel the seed's texel index or −1), step by step (`jfa_step.frag`). */
export function jumpFlood(seeds: Int32Array, width: number, height: number, steps: readonly number[]): Int32Array {
  let cur = Int32Array.from(seeds);
  let next = new Int32Array(cur.length);
  for (const step of steps) {
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        let best = NO_SEED;
        let d = Number.POSITIVE_INFINITY;
        for (const [ox, oy] of STEP_OFFSETS) {
          const qi = i + ox * step;
          const qj = j + oy * step;
          if (qi < 0 || qj < 0 || qi >= width || qj >= height) continue;
          const s = cur[qj * width + qi] ?? NO_SEED;
          if (s === NO_SEED) continue;
          const vx = (s % width) - i;
          const vy = Math.floor(s / width) - j;
          const dd = vx * vx + vy * vy;
          if (dd < d) {
            d = dd;
            best = s;
          }
        }
        next[j * width + i] = best;
      }
    }
    [cur, next] = [next, cur];
  }
  return cur;
}

/** A seed's texel coordinates as the four bytes of its RGBA8 texel (`jfaEncode`: x high, x low, y high, y low). */
export function jfaEncode(x: number, y: number): [number, number, number, number] {
  return [x >> 8, x & 255, y >> 8, y & 255];
}

/** Texel coordinates of an encoded seed, or null for none (`jfaDecode`; 0xFFFF is "no seed"). */
export function jfaDecode(b: readonly [number, number, number, number]): [number, number] | null {
  const x = b[0] * 256 + b[1];
  const y = b[2] * 256 + b[3];
  return x >= 0xffff ? null : [x, y];
}

/** Near field of a flame (`flameNearField`): the share of its light a pixel `horizontal` px beside, `drop` px below it keeps. */
export function flameNearField(horizontal: number, upright: boolean, drop: number): number {
  if (!upright || drop <= 0) return 1;
  const radius = FLAME_NEAR_FIELD.radiusPx + drop * FLAME_NEAR_FIELD.spread;
  const s = smoothstep(0.5 * radius, radius, horizontal);
  return FLAME_NEAR_FIELD.floor + (1 - FLAME_NEAR_FIELD.floor) * s;
}

/** Whether a decor footprint stands at a mask texel. */
function decorAt(m: Occluder): boolean {
  return m.decor > m.terrain + SDF.seedEpsilonPx;
}

/**
 * Whether a receiver belongs to the body the light with ground point `to` burns in (`lightHousing`): the part of the
 * receiver's column between where it is drawn (`screen`) and its ground point (`ground`; without end when `capped`)
 * nearest the light's row is joined to the light by decor footprint texels.
 */
export function lightHousing(field: OccluderField, screen: readonly [number, number], ground: readonly [number, number], capped: boolean, to: readonly [number, number], ring: OccluderRing | null = null): boolean {
  const south = capped ? Math.max(to[1], screen[1]) : ground[1] + LIGHT_HOUSING.gracePx;
  const px = screen[0];
  const py = Math.max(screen[1], Math.min(south, to[1]));
  const sx = px - to[0];
  const sy = py - to[1];
  const len = Math.hypot(sx, sy);
  if (len > LIGHT_HOUSING.spanPx) return false;
  const dx = len > 0 ? sx / len : 0;
  const dy = len > 0 ? sy / len : 0;
  for (let i = 0; i <= LIGHT_HOUSING.spanPx; i++) {
    if (i > len) break;
    if (!decorKnownAt(occluderWithDecorAt(field, ring, to[0] + dx * i, to[1] + dy * i))) return i > 0 && len - i <= LIGHT_HOUSING.gracePx;
  }
  return true;
}

/**
 * Top of the decor footprint a light with ground point `to` burns in [px], or −1 when it stands free (the vertex
 * stage): the footprint under `to`, else the nearest within `LIGHT_HOUSING.edgePx` whose top rises above the flame at
 * height `flame` [px above level 0] (a hearth's fire at the back edge of its ring).
 */
export function housingTop(field: OccluderField, to: readonly [number, number], flame = Number.POSITIVE_INFINITY, ring: OccluderRing | null = null): number {
  const m = occluderWithDecorAt(field, ring, to[0], to[1]);
  if (m !== null && decorAt(m)) return m.decor;
  const e = LIGHT_HOUSING.edgePx;
  let top = -1;
  let nearest = 2 * e * e + 1;
  for (let dj = -e; dj <= e; dj++) {
    for (let di = -e; di <= e; di++) {
      const n = occluderWithDecorAt(field, ring, to[0] + di, to[1] + dj);
      const d = di * di + dj * dj;
      if (d < nearest && n !== null && decorAt(n) && n.decor > flame) {
        nearest = d;
        top = n.decor;
      }
    }
  }
  return top;
}

/**
 * Share of a light reaching a receiver (`lightShadow`): the receiver's ground point `from` at height `zFrom` (`own`:
 * a pixel of an occluder; `ownWall`: standing in a wall), the light's ground point `to` at height `zTo` on ground of
 * height `base`, burning in a housing of top `housing` (−1: none; its rays pass it). Returns (visibility, visibility
 * behind the structural occluders alone – past decor only with `bookkeeping`, the comparison's frames). Without
 * `decorShadows` (quality level "Niedrig") only walls and cliffs block. Where the trace stops short of the light – the
 * ray leaves the field, or its steps run out – `raySurvives` decides the rest through the field and the `ring`.
 */
export function lightShadow(
  field: OccluderField,
  from: readonly [number, number],
  zFrom: number,
  own: boolean,
  ownWall: boolean,
  to: readonly [number, number],
  zTo: number,
  base: number,
  housing: number,
  soft: boolean,
  decorShadows = true,
  bookkeeping = true,
  ring: OccluderRing | null = null,
): [number, number] {
  const sx = to[0] - from[0];
  const sy = to[1] - from[1];
  const len = Math.hypot(sx, sy);
  const end = len - POINT_SHADOW.lightClearancePx;
  if (end <= POINT_SHADOW.startPx) return [1, 1];
  const dx = sx / len;
  const dy = sy / len;
  const eps = POINT_SHADOW.heightEpsilonPx;
  let res = 1;
  let resStructural = 1;
  let t = POINT_SHADOW.startPx;
  const start = occluderAt(field, ring, from[0], from[1]) ?? { decor: 0, structural: false, terrain: 0, ground: 0 };
  const face = start.terrain > zFrom + eps && start.terrain > start.ground + SDF.seedEpsilonPx;
  let inside = own || face;
  let origin = 0;
  // The last point the trace saw in the field: a step out of it may have jumped over a wall beyond it.
  let seen = t;
  for (let step = 0; step < POINT_SHADOW.maxSteps; step++) {
    if (t >= end) break;
    const [qi, qj] = field.texel(from[0] + dx * t, from[1] + dy * t);
    if (!field.inside(qi, qj)) {
      t = seen;
      break;
    }
    seen = t;
    if (inside) {
      const m = field.maskAt(qi, qj);
      if (m.structural && !ownWall) {
        res = 0;
        resStructural = 0;
        break;
      }
      const inOwn = own && (m.structural || decorAt(m));
      const inFace = face && m.terrain > zFrom + eps;
      if (inOwn || inFace || t < POINT_SHADOW.ownGracePx) {
        t += POINT_SHADOW.minStepPx;
        continue;
      }
      inside = false;
      origin = t;
    }
    const d = field.distanceAt(qi, qj);
    const occ = field.infoAt(qi, qj);
    const rayHeight = zFrom + (zTo - zFrom) * (t / len);
    const structural = occ.structural || occ.terrain > base + eps;
    const decor = decorShadows && decorAt(occ) && occ.decor > rayHeight + eps && Math.abs(occ.decor - housing) > LIGHT_HOUSING.sameTopPx;
    if (structural || decor) {
      if (d < 0.5) {
        res = 0;
        if (structural || !bookkeeping) {
          if (structural) resStructural = 0;
          break;
        }
        // Decor stops the light here; walls and cliffs further on still decide the structural visibility.
        t += POINT_SHADOW.minStepPx;
        continue;
      }
      const penumbra = soft ? Math.max(0, Math.min(1, (POINT_SHADOW.softness * d) / Math.max(t - origin, POINT_SHADOW.minStepPx))) : 1;
      res = Math.min(res, penumbra);
      if (structural) resStructural = Math.min(resStructural, penumbra);
    }
    t += Math.max(d, POINT_SHADOW.minStepPx);
  }
  // Not through yet (left the field, or out of steps): the walls and cliffs further on decide.
  if (t < end && resStructural > 0 && (res > 0 || bookkeeping)) {
    const rest = raySurvives(field, ring, from, [dx, dy], t, end, base, inside && (ownWall || face));
    res = Math.min(res, rest);
    resStructural = Math.min(resStructural, rest);
  }
  return [smoothstep(0, 1, res), smoothstep(0, 1, resStructural)];
}

/**
 * Where an occluder's ambient occlusion begins to fade and where it ends [px from its footprint] (M5-61): decor of
 * `height` px above its ground at full strength within `SDF_AO.decorContactPx`, then over `SDF_AO.decorReachPerHeight`
 * px per px of it (together at most `SDF_AO.radiusPx`); walls, closed doors and cliffs from 0 over the whole radius.
 */
export function aoReach(decor: boolean, height: number): { from: number; end: number } {
  if (!decor) return { from: 0, end: SDF_AO.radiusPx };
  const from = SDF_AO.decorContactPx;
  return { from, end: Math.min(SDF_AO.radiusPx, from + SDF_AO.decorReachPerHeight * Math.max(0, height)) };
}

/**
 * Ambient occlusion of a receiver at ground point `ground`, height `z` by the nearest occluder (`sdfOcclusion`): full
 * at an occluder's foot, gone at its reach (`aoReach`) and `SDF_AO.reachHeightPx` above the ground.
 */
export function sdfOcclusion(field: OccluderField, ground: readonly [number, number], z: number): number {
  const [i, j] = field.texel(ground[0], ground[1]);
  if (!field.inside(i, j)) return 1;
  const d = field.distanceAt(i, j);
  if (d >= SDF_AO.radiusPx) return 1;
  const occ = field.infoAt(i, j);
  const top = occ.structural ? STRUCTURAL_TOP_PX : Math.max(occ.decor, occ.terrain);
  const groundHere = field.maskAt(i, j).ground;
  if (top <= z + 1) return 1;
  const { from, end } = aoReach(!occ.structural && decorAt(occ), occ.decor - occ.ground);
  if (d >= Math.max(end, from)) return 1;
  const above = Math.max(0, z - groundHere);
  const near = d <= from ? 1 : 1 - smoothstep(from, end, d);
  return 1 - SDF_AO.strength * near * (1 - smoothstep(0, SDF_AO.reachHeightPx, above));
}

/** GLSL `fract`. */
function fract(v: number): number {
  return v - Math.floor(v);
}

/** Hash of a lattice point (`lightHash`). */
export function lightHash(x: number, y: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.103);
  const d = px * (py + 33.33) + py * (px + 33.33);
  px += d;
  py += d;
  return fract((px + py) * px);
}

/** Smooth value noise (`valueNoise`). */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = lightHash(ix, iy);
  const b = lightHash(ix + 1, iy);
  const c = lightHash(ix, iy + 1);
  const d = lightHash(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** GLSL `mod`. */
function glslMod(v: number, m: number): number {
  return v - m * Math.floor(v / m);
}

/** Value noise on a lattice that repeats every `period` cells (`cloudNoise` of shadow.glsl). */
export function cloudNoise(x: number, y: number, period: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const ax = glslMod(ix, period);
  const ay = glslMod(iy, period);
  const bx = glslMod(ix + 1, period);
  const by = glslMod(iy + 1, period);
  const a = lightHash(ax, ay);
  const b = lightHash(bx, ay);
  const c = lightHash(ax, by);
  const d = lightHash(bx, by);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Share of the sun a cloud takes away at its densest under cover `cover` (`cloudDensity`): the thin fair-weather clouds
 * of a clear sky up to its cover (`CLEAR_SKY_COVER`), the full density of a cloudy one from `CLOUDS.denseCover` on
 * (M5-59).
 */
export function cloudDensity(cover: number): number {
  const t = Math.max(0, Math.min(1, (cover - CLEAR_SKY_COVER) / (CLOUDS.denseCover - CLEAR_SKY_COVER)));
  return CLOUDS.clearDensity + (CLOUDS.density - CLOUDS.clearDensity) * t;
}

/** Share of the sun a cloud leaves at world point (x, y) with cover `cover` and the field offset (`cloudShade`). */
export function cloudShade(x: number, y: number, cover: number, offsetX: number, offsetY: number): number {
  if (cover <= 0) return 1;
  const px = (x + offsetX) / CLOUDS.scalePx;
  const py = (y + offsetY) / CLOUDS.scalePx;
  const s1 = CLOUDS.octaveScales[0];
  const s2 = CLOUDS.octaveScales[1];
  const n =
    0.55 * cloudNoise(px, py, CLOUD_OCTAVE_PERIODS[0]) +
    0.3 * cloudNoise(px * s1 + 17.1, py * s1 + 5.3, CLOUD_OCTAVE_PERIODS[1]) +
    0.15 * cloudNoise(px * s2 + 3.7, py * s2 + 11.9, CLOUD_OCTAVE_PERIODS[2]);
  const threshold = CLOUDS.thresholdClear + (CLOUDS.thresholdClosed - CLOUDS.thresholdClear) * cover;
  return 1 - cloudDensity(cover) * smoothstep(threshold - CLOUDS.edge, threshold + CLOUDS.edge, n);
}

/** A shadow component below this counts as parallel to an axis (`PARALLEL` of shadow_block.frag: a ray along a wall's plane). */
const PANE_PARALLEL = 1e-5;

/** Heights t with lo ≤ p − t · s ≤ hi on one axis (`interval` of shadow_block.frag / shadow_prism.frag). */
function interval(p: number, s: number, lo: number, hi: number): [number, number] {
  if (Math.abs(s) < PANE_PARALLEL) return p >= lo && p <= hi ? [-1e9, 1e9] : [1, -1];
  const t0 = (p - hi) / s;
  const t1 = (p - lo) / s;
  return [Math.min(t0, t1), Math.max(t0, t1)];
}

/**
 * The heights [from, to] of sun caster `i` of `list` whose points project onto ground point (x, y) along the shadow
 * vector (sx, sy) · length (`shadow_block.frag`), or null when the block's shadow misses the point.
 */
export function sunBlockSpan(list: SunCasterList, i: number, x: number, y: number, sx: number, sy: number): [number, number] | null {
  const r = list.records;
  const o = i * SUN_CASTER_FLOATS;
  const cx = r[o] ?? 0;
  const cy = r[o + 1] ?? 0;
  const hx = r[o + 2] ?? 0;
  const hy = r[o + 3] ?? 0;
  const [ax0, ax1] = interval(x, sx, cx - hx, cx + hx);
  const [ay0, ay1] = interval(y, sy, cy - hy, cy + hy);
  const from = Math.max(ax0, ay0, r[o + SUN_CASTER_OFFSET.span] ?? 0);
  const to = Math.min(ax1, ay1, r[o + SUN_CASTER_OFFSET.span + 1] ?? 0);
  return from > to ? null : [from, to];
}

/**
 * The frame cell (column, row) a pane caster `i` samples for ground point (x, y) whose ray crosses it over heights
 * [from, to] (`shadow_block.frag`), or null outside its frame: where the ray crosses the window's plane (the middle of
 * the caster's band across the pane's axis), within the wall's height – every block of a window samples the same cell
 * (M5-58); a ray along the plane at the middle of its path through the block.
 */
export function paneCell(list: SunCasterList, i: number, x: number, y: number, sx: number, sy: number, from: number, to: number): [number, number] | null {
  const r = list.records;
  const o = i * SUN_CASTER_FLOATS;
  const alongY = (r[o + SUN_CASTER_OFFSET.span + 3] ?? 0) > 0.5;
  const across = alongY ? sx : sy;
  const plane = alongY ? (r[o] ?? 0) : (r[o + 1] ?? 0);
  const bottom = r[o + SUN_CASTER_OFFSET.span] ?? 0;
  const top = r[o + SUN_CASTER_OFFSET.span + 1] ?? 0;
  const t = Math.abs(across) < PANE_PARALLEL ? 0.5 * (from + to) : Math.max(bottom, Math.min(top, ((alongY ? x : y) - plane) / across));
  const along = alongY ? y - sy * t : x - sx * t;
  const col = Math.floor(along - (r[o + SUN_CASTER_OFFSET.pane] ?? 0));
  const row = Math.floor((r[o + SUN_CASTER_OFFSET.pane + 3] ?? 0) - (t - (r[o + SUN_CASTER_OFFSET.span] ?? 0)));
  const w = r[o + SUN_CASTER_OFFSET.frame + 1] ?? 0;
  const h = r[o + SUN_CASTER_OFFSET.frame + 2] ?? 0;
  return col >= 0 && row >= 0 && col < w && row < h ? [col, row] : null;
}

/** Axis of a pane caster (`SUN_CASTER_AXIS`). */
export function paneAxis(list: SunCasterList, i: number): number {
  return list.records[i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span + 3] ?? SUN_CASTER_AXIS.x;
}

/** Whether the ray from a receiver's ground point `from` to the light's `to` passes an opening of a wall (`throughOpening`). */
export function throughOpening(field: OccluderField, from: readonly [number, number], to: readonly [number, number]): boolean {
  const sx = to[0] - from[0];
  const sy = to[1] - from[1];
  const len = Math.hypot(sx, sy);
  const dx = len > 0 ? sx / len : 0;
  const dy = len > 0 ? sy / len : 0;
  for (let t = 0; t <= len; t += LIGHTMAP_COMPARISON.openingStepPx) {
    const [i, j] = field.texel(from[0] + dx * t, from[1] + dy * t);
    if (field.opening(i, j)) return true;
  }
  return false;
}

/**
 * Whether a ground point stands within the comparison's reach of a wall or a cliff the light cannot see over
 * (`nearStructural`): the nearest occluder, or – behind nearer decor – a mask probe every `LIGHTMAP_COMPARISON.probePx`
 * along eight directions.
 */
export function nearStructural(field: OccluderField, ground: readonly [number, number], base: number): boolean {
  const [i, j] = field.texel(ground[0], ground[1]);
  if (!field.inside(i, j)) return false;
  const eps = POINT_SHADOW.heightEpsilonPx;
  const occ = field.infoAt(i, j);
  const blocks = occ.structural || occ.terrain > base + eps;
  if (blocks && field.distanceAt(i, j) < LIGHTMAP_COMPARISON.nearStructuralPx) return true;
  const { probePx, nearStructuralPx } = LIGHTMAP_COMPARISON;
  for (let k = 0; k < 8; k++) {
    const a = k * (Math.PI / 4);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    for (let r = probePx; r < nearStructuralPx + 0.5; r += probePx) {
      const [pi, pj] = field.texel(ground[0] + dx * r, ground[1] + dy * r);
      const m = field.maskAt(pi, pj);
      if (m.structural || m.terrain > base + eps) return true;
    }
  }
  return false;
}
