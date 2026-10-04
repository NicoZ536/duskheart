/**
 * The gameplay light map (MASTERPROMPT §12.1; docs/SPIEL.md §4): how bright the world is at a point, for
 * everything that plays by light – fear (§12.3), the spawn rules and the Schattenbrut (§12.4), perception
 * (§19). It is fed by the **same** light source list as the renderer (the light system's list,
 * src/game/light; the renderer converts it into `LightInstance`s) and evaluates the canonical light model
 * of the shader (src/engine/lightFalloff.ts).
 *
 * - **Per tile on the CPU:** the level of a tile (`tileLevel`, `fillTiles` – the batch form for spawn
 *   checks and debug views) is its ambient light (§12.1, `ambient.ts`) plus, for every light on the layer
 *   whose occlusion mask reaches the tile (`occlusion.ts`, a tile raycast per light, cached), the light's
 *   brightness at the tile centre on the ground: intensity × falloff × cone – exactly what the light
 *   target of the renderer holds for a flat pixel there.
 * - **Bilinear:** a point sample (`levelAt`) blends the four surrounding tiles – their ambient and, per
 *   light, their occlusion (a soft shadow edge instead of a tile step) – and evaluates the falloff of each
 *   light at the point itself. Interpolating the falloff between tile centres would miss the hot core of a
 *   light (`LIGHT_FALLOFF_CORE`) by up to 0,08 next to a torch in hand – more than the 0,05 the light map
 *   may differ from the rendered light; at a tile centre both forms agree exactly.
 * - **Steady:** flicker is a presentation effect; gameplay thresholds do not flutter with it.
 * - **Cost:** tile levels are evaluated on demand and memoised for the current stamp (the owner starts a
 *   new stamp every tick: the hand light moves); occlusion masks live in the cache until a wall changes.
 *   No allocation per query (M6-16f): once per stamp the lights are copied into columns of typed arrays (position,
 *   height, radius, intensity, the cone's axis and borders – the cosines computed once instead of per tile); a query
 *   evaluates the canonical formulas statement by statement in place, distances in the shader's √(dx² + dy² + dz²)
 *   form (`lightDistance`), and hands no floating-point value through a call (the tile sum goes straight into the
 *   memo). The same values as `steadyLightLevel`, bit for bit.
 */
import { coneCosine, LIGHT_CONE_EPSILON, LIGHT_CONE_OPEN_INNER, LIGHT_CONE_OPEN_OUTER, LIGHT_FALLOFF_CORE, LIGHT_FULL_CIRCLE, lightCone, lightConeInner, lightConeOuter, lightDistance, lightFalloff, type LightSource } from '../../engine/lightFalloff';
import { TILE_PX, type Layer } from '../model/coords';
import { lightLevelOfTile, OcclusionCache, type OcclusionEntry, type OccluderSource } from './occlusion';
import { lightStage, type LightStage } from './stages';

/** A light of the shared list as the map needs it: the canonical light plus its layer and cache identity. */
export interface MapLight extends LightSource {
  /** Stable id of the light (the occlusion cache keys its masks by it). */
  readonly id: number;
  readonly layer: Layer;
  /** Window radius of the occlusion mask [tiles]: covers the largest radius this light can have. */
  readonly windowTiles: number;
}

/** What the map reads (the light system provides it; tests draw their own). */
export interface LightMapInputs {
  /** The light source list of this stamp (lit lights only). */
  lights(): readonly MapLight[];
  /**
   * Ambient light of tile (tx, ty) [light level] (§12.1) into `out[index]`: an out parameter, so no floating-point value
   * crosses the call (the map asks once per tile it evaluates, M6-16f). Returns nothing – typed `undefined`, so a
   * function that returns the level instead of writing it does not compile.
   */
  ambient(layer: Layer, tx: number, ty: number, out: Float64Array, index: number): undefined;
  /** Collision tile infos: what blocks light (walls, cliffs). */
  readonly occluders: OccluderSource;
}

/** Hermite smoothstep t²·(3 − 2t) of a cone's border, inlined (as `smoothstep` in src/engine/lightFalloff.ts and lighting.glsl). */
const SMOOTHSTEP_CUBIC = 3;
/** Slots of the point scratch: x, y [px] and the level. */
const POINT_SLOTS = 3;
/** Light columns allocated at first (they grow by doubling when a stamp has more lights than ever before). */
const INITIAL_LIGHT_COLUMNS = 16;

/** Tile levels memoised per stamp (power of two; a query touches 4 tiles, a debug view a few hundred). */
const MEMO_SLOTS = 1024;
const MEMO_MASK = MEMO_SLOTS - 1;
/** Hash multipliers of the memo slot (large odd constants, any mixing will do). */
const HASH_X = 73856093;
const HASH_Y = 19349663;
const HASH_L = 83492791;

/** Brightness a light adds on the ground at world px (x, y), without flicker: intensity × falloff × cone. */
export function steadyLightLevel(light: LightSource, x: number, y: number): number {
  const f = lightFalloff(lightDistance(light, x, y, 0), light.radius);
  if (f === 0) return 0;
  return light.intensity * f * lightCone(coneCosine(x - light.x, y - light.y, light.coneDirection), lightConeOuter(light.coneAngle), lightConeInner(light.coneAngle));
}

/** Tile of world px `p` (floor division by the tile size). */
function tileOf(p: number): number {
  return Math.floor(p / TILE_PX);
}

export class GameplayLightMap {
  readonly occlusion: OcclusionCache;
  private stampValue = Number.NaN;
  /** Generation of the memo: a new stamp or an invalidation starts a new one. */
  private generation = 0;
  private readonly memoGeneration = new Float64Array(MEMO_SLOTS).fill(-1);
  private readonly memoLayer = new Int8Array(MEMO_SLOTS);
  private readonly memoX = new Int32Array(MEMO_SLOTS);
  private readonly memoY = new Int32Array(MEMO_SLOTS);
  private readonly memoAmbient = new Float64Array(MEMO_SLOTS);
  private readonly memoSource = new Float64Array(MEMO_SLOTS);
  /**
   * The lights of this generation (radius and intensity above 0) and their occlusion masks: the first `count` slots
   * of the arrays and columns count, the arrays keep their length (`length = 0` would drop their storage).
   */
  private count = 0;
  private readonly entries: OcclusionEntry[] = [];
  private readonly entryLights: MapLight[] = [];
  private entriesGeneration = -1;
  private layers = new Int8Array(INITIAL_LIGHT_COLUMNS);
  /** 1: a cone (`coneAngle` below a full turn); 0: a point light, whose cone factor is exactly 1. */
  private spots = new Uint8Array(INITIAL_LIGHT_COLUMNS);
  private xs = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private ys = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private heights = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private radii = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private intensities = new Float64Array(INITIAL_LIGHT_COLUMNS);
  /** cos/sin of the cone axis and the cosines of its outer and inner border (`lightConeOuter`/`lightConeInner`). */
  private axisCos = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private axisSin = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private outers = new Float64Array(INITIAL_LIGHT_COLUMNS);
  private inners = new Float64Array(INITIAL_LIGHT_COLUMNS);
  /** Scratch of `pointLevel`: the point [px] and its result (no floating-point value crosses a call). */
  private readonly point = new Float64Array(POINT_SLOTS);

  /**
   * @param inputs the light list, ambient and occluders.
   * @param positionsPerLight occlusion masks kept per light (the moving hand light keeps its last few).
   */
  constructor(
    private readonly inputs: LightMapInputs,
    positionsPerLight: number,
  ) {
    this.occlusion = new OcclusionCache(positionsPerLight);
  }

  /** Starts stamp `stamp` (the tick): the lights may have moved, memoised tile levels are dropped. */
  setStamp(stamp: number): void {
    if (stamp === this.stampValue) return;
    this.stampValue = stamp;
    this.generation++;
  }

  /** The current stamp. */
  get stamp(): number {
    return this.stampValue;
  }

  /** Light level of tile (tx, ty) on `layer` at its centre: ambient + every light that reaches it. */
  tileLevel(layer: Layer, tx: number, ty: number): number {
    const slot = this.memo(layer, tx, ty);
    return (this.memoAmbient[slot] as number) + (this.memoSource[slot] as number);
  }

  /**
   * Whether the light level of tile (tx, ty) is above `threshold` – `tileLevel(…) > threshold` without handing the level
   * through the call (the path samplers ask thousands of tiles, M6-16f).
   */
  brighter(layer: Layer, tx: number, ty: number, threshold: number): boolean {
    const slot = this.memo(layer, tx, ty);
    return (this.memoAmbient[slot] as number) + (this.memoSource[slot] as number) > threshold;
  }

  /** Light of the sources alone at the centre of tile (tx, ty) (without the ambient). */
  tileSourceLevel(layer: Layer, tx: number, ty: number): number {
    return this.memoSource[this.memo(layer, tx, ty)] as number;
  }

  /** Light level at world px (x, y) on `layer`: ambient and occlusion bilinear between the tile centres, falloff at the point. */
  levelAt(layer: Layer, x: number, y: number): number {
    const p = this.point;
    p[0] = x;
    p[1] = y;
    this.pointLevel(layer, true);
    return p[2] as number;
  }

  /**
   * `levelAt` of the point (`xy[0]`, `xy[1]`) into `xy[2]`: no floating-point value crosses the call (the presentation asks
   * it for every creature in every frame, ADR-0167).
   */
  levelInto(layer: Layer, xy: Float64Array): void {
    const p = this.point;
    p[0] = xy[0] as number;
    p[1] = xy[1] as number;
    this.pointLevel(layer, true);
    xy[2] = p[2] as number;
  }

  /** Light of the sources alone at world px (x, y) (occlusion bilinear, falloff at the point). */
  sourceLevelAt(layer: Layer, x: number, y: number): number {
    const p = this.point;
    p[0] = x;
    p[1] = y;
    this.pointLevel(layer, false);
    return p[2] as number;
  }

  /** Light stage at world px (x, y) (§12.1). */
  stageAt(layer: Layer, x: number, y: number): LightStage {
    return lightStage(this.levelAt(layer, x, y));
  }

  /** Tile levels of the rectangle (tx0, ty0, w × h) into `out` (row-major); `ambient` false = sources only. */
  fillTiles(layer: Layer, tx0: number, ty0: number, w: number, h: number, out: Float32Array | Float64Array, ambient = true): void {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = ambient ? this.tileLevel(layer, tx0 + x, ty0 + y) : this.tileSourceLevel(layer, tx0 + x, ty0 + y);
  }

  /**
   * Point samples on a lattice: `out[j · w + i]` = the level at world px (x0 + i · step, y0 + j · step);
   * `ambient` false = sources only (debug views compare the renderer with it).
   */
  fillLattice(layer: Layer, x0: number, y0: number, step: number, w: number, h: number, out: Float32Array | Float64Array, ambient = true): void {
    for (let j = 0; j < h; j++) {
      const y = y0 + j * step;
      for (let i = 0; i < w; i++) {
        const x = x0 + i * step;
        out[j * w + i] = ambient ? this.levelAt(layer, x, y) : this.sourceLevelAt(layer, x, y);
      }
    }
  }

  /** A tile that can block light changed (mining, building): the masks around it are traced again. */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    this.occlusion.invalidateTile(layer, tx, ty);
    this.generation++;
  }

  /** Something anywhere in a chunk changed. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    this.occlusion.invalidateChunk(layer, cx, cy);
    this.generation++;
  }

  /**
   * Level at the point (`point[0]`, `point[1]`) [world px] into `point[2]`: the sources (occlusion bilinear between the
   * tile centres, falloff and cone at the point – `steadyLightLevel` statement by statement) plus, with `ambient`, the
   * ambient bilinear between the tile centres (a weather region border is a soft step).
   */
  private pointLevel(layer: Layer, ambient: boolean): void {
    this.refreshEntries();
    const p = this.point;
    const x = p[0] as number;
    const y = p[1] as number;
    // Tile centres sit at (t + ½) · TILE_PX: u, v are the coordinates in the lattice of tile centres.
    const u = x / TILE_PX - 0.5;
    const v = y / TILE_PX - 0.5;
    const tx = Math.floor(u);
    const ty = Math.floor(v);
    const fx = u - tx;
    const fy = v - ty;
    const entries = this.entries;
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.layers[i] !== layer) continue;
      // lightDistance(light, x, y, 0): the light's offset from the point, its height above the ground.
      const dx = (this.xs[i] as number) - x;
      const dy = (this.ys[i] as number) - y;
      const dz = this.heights[i] as number;
      const r = this.radii[i] as number;
      // lightFalloff(distance, radius)
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
      const w = Math.max(0, 1 - q * q);
      const f = (w * w) / (1 + LIGHT_FALLOFF_CORE * q * q);
      if (f === 0) continue;
      let level = (this.intensities[i] as number) * f;
      if (this.spots[i] === 1) {
        // lightCone(coneCosine(x − light.x, y − light.y, axis), outer, inner)
        const ax = x - (this.xs[i] as number);
        const ay = y - (this.ys[i] as number);
        const len = Math.sqrt(ax * ax + ay * ay);
        const cos = len < LIGHT_CONE_EPSILON ? 1 : (ax * (this.axisCos[i] as number) + ay * (this.axisSin[i] as number)) / len;
        const e0 = this.outers[i] as number;
        const t = Math.min(1, Math.max(0, (cos - e0) / ((this.inners[i] as number) - e0)));
        level *= t * t * (SMOOTHSTEP_CUBIC - 2 * t);
      }
      if (level === 0) continue;
      const e = entries[i] as OcclusionEntry;
      const a = e.visible(tx, ty) ? 1 : 0;
      const b = e.visible(tx + 1, ty) ? 1 : 0;
      const c = e.visible(tx, ty + 1) ? 1 : 0;
      const d = e.visible(tx + 1, ty + 1) ? 1 : 0;
      const top = a + (b - a) * fx;
      const seen = top + (c + (d - c) * fx - top) * fy;
      sum += level * seen;
    }
    if (!ambient) {
      p[2] = sum;
      return;
    }
    const a = this.memoAmbient[this.memo(layer, tx, ty)] as number;
    const b = this.memoAmbient[this.memo(layer, tx + 1, ty)] as number;
    const c = this.memoAmbient[this.memo(layer, tx, ty + 1)] as number;
    const d = this.memoAmbient[this.memo(layer, tx + 1, ty + 1)] as number;
    const top = a + (b - a) * fx;
    p[2] = top + (c + (d - c) * fx - top) * fy + sum;
  }

  /** Memo slot of tile (tx, ty) with its ambient and source level of this generation. */
  private memo(layer: Layer, tx: number, ty: number): number {
    const slot = (Math.imul(tx, HASH_X) ^ Math.imul(ty, HASH_Y) ^ Math.imul(layer, HASH_L)) & MEMO_MASK;
    if (this.memoGeneration[slot] !== this.generation || this.memoX[slot] !== tx || this.memoY[slot] !== ty || this.memoLayer[slot] !== layer) {
      this.memoGeneration[slot] = this.generation;
      this.memoX[slot] = tx;
      this.memoY[slot] = ty;
      this.memoLayer[slot] = layer;
      this.tileSources(layer, tx, ty, slot);
      this.inputs.ambient(layer, tx, ty, this.memoAmbient, slot);
    }
    return slot;
  }

  /**
   * Sum of the lights that reach tile (tx, ty) of `layer`, at its centre on the ground, into `memoSource[slot]` –
   * `steadyLightLevel` statement by statement (see `pointLevel`).
   */
  private tileSources(layer: Layer, tx: number, ty: number, slot: number): void {
    this.refreshEntries();
    const entries = this.entries;
    const x = (tx + 0.5) * TILE_PX;
    const y = (ty + 0.5) * TILE_PX;
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.layers[i] !== layer) continue;
      if (!(entries[i] as OcclusionEntry).visible(tx, ty)) continue;
      const dx = (this.xs[i] as number) - x;
      const dy = (this.ys[i] as number) - y;
      const dz = this.heights[i] as number;
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / (this.radii[i] as number);
      const w = Math.max(0, 1 - q * q);
      const f = (w * w) / (1 + LIGHT_FALLOFF_CORE * q * q);
      if (f === 0) continue;
      let level = (this.intensities[i] as number) * f;
      if (this.spots[i] === 1) {
        const ax = x - (this.xs[i] as number);
        const ay = y - (this.ys[i] as number);
        const len = Math.sqrt(ax * ax + ay * ay);
        const cos = len < LIGHT_CONE_EPSILON ? 1 : (ax * (this.axisCos[i] as number) + ay * (this.axisSin[i] as number)) / len;
        const e0 = this.outers[i] as number;
        const t = Math.min(1, Math.max(0, (cos - e0) / ((this.inners[i] as number) - e0)));
        level *= t * t * (SMOOTHSTEP_CUBIC - 2 * t);
      }
      sum += level;
    }
    this.memoSource[slot] = sum;
  }

  /** The lights of this generation into the columns, with their occlusion masks (looked up once per generation). */
  private refreshEntries(): void {
    if (this.entriesGeneration === this.generation) return;
    this.entriesGeneration = this.generation;
    const lights = this.inputs.lights();
    const occluders = this.inputs.occluders;
    let n = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as MapLight;
      if (!(l.radius > 0) || !(l.intensity > 0)) continue;
      const tx = tileOf(l.x);
      const ty = tileOf(l.y);
      occluders.beginQuery();
      const level = lightLevelOfTile(occluders.info(l.layer, tx, ty));
      if (n === this.xs.length) this.grow();
      this.entryLights[n] = l;
      this.entries[n] = this.occlusion.window(occluders, l.id, l.layer, tx, ty, l.windowTiles, level);
      this.layers[n] = l.layer;
      this.xs[n] = l.x;
      this.ys[n] = l.y;
      this.heights[n] = l.height;
      this.radii[n] = l.radius;
      this.intensities[n] = l.intensity;
      // A full turn or more is a point light: its cone factor is smoothstep(−3, −2, cos) = 1 for every cosine.
      const spot = l.coneAngle < LIGHT_FULL_CIRCLE;
      this.spots[n] = spot ? 1 : 0;
      this.axisCos[n] = spot ? Math.cos(l.coneDirection) : 1;
      this.axisSin[n] = spot ? Math.sin(l.coneDirection) : 0;
      this.outers[n] = spot ? lightConeOuter(l.coneAngle) : LIGHT_CONE_OPEN_OUTER;
      this.inners[n] = spot ? lightConeInner(l.coneAngle) : LIGHT_CONE_OPEN_INNER;
      n++;
    }
    this.count = n;
  }

  /** Doubles the light columns (a stamp with more lights than any before). */
  private grow(): void {
    const n = this.xs.length * 2;
    const f64 = (old: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
      const next = new Float64Array(n);
      next.set(old);
      return next;
    };
    const layers = new Int8Array(n);
    layers.set(this.layers);
    this.layers = layers;
    const spots = new Uint8Array(n);
    spots.set(this.spots);
    this.spots = spots;
    this.xs = f64(this.xs);
    this.ys = f64(this.ys);
    this.heights = f64(this.heights);
    this.radii = f64(this.radii);
    this.intensities = f64(this.intensities);
    this.axisCos = f64(this.axisCos);
    this.axisSin = f64(this.axisSin);
    this.outers = f64(this.outers);
    this.inners = f64(this.inners);
  }
}
