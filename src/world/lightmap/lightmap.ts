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
 *   No allocation per query.
 */
import { coneCosine, lightCone, lightConeInner, lightConeOuter, lightDistance, lightFalloff, type LightSource } from '../../engine/lightFalloff';
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
  /** Ambient light of a tile [light level] (§12.1). */
  ambient(layer: Layer, tx: number, ty: number): number;
  /** Collision tile infos: what blocks light (walls, cliffs). */
  readonly occluders: OccluderSource;
}

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
  private readonly entries: OcclusionEntry[] = [];
  private readonly entryLights: MapLight[] = [];
  private entriesGeneration = -1;

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

  /** Light of the sources alone at the centre of tile (tx, ty) (without the ambient). */
  tileSourceLevel(layer: Layer, tx: number, ty: number): number {
    return this.memoSource[this.memo(layer, tx, ty)] as number;
  }

  /** Light level at world px (x, y) on `layer`: ambient and occlusion bilinear between the tile centres, falloff at the point. */
  levelAt(layer: Layer, x: number, y: number): number {
    return this.ambientAt(layer, x, y) + this.sourceLevelAt(layer, x, y);
  }

  /** Light of the sources alone at world px (x, y) (occlusion bilinear, falloff at the point). */
  sourceLevelAt(layer: Layer, x: number, y: number): number {
    this.refreshEntries();
    const lights = this.entryLights;
    const entries = this.entries;
    // Tile centres sit at (t + ½) · TILE_PX: u, v are the coordinates in the lattice of tile centres.
    const u = x / TILE_PX - 0.5;
    const v = y / TILE_PX - 0.5;
    const tx = Math.floor(u);
    const ty = Math.floor(v);
    const fx = u - tx;
    const fy = v - ty;
    let sum = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as MapLight;
      if (l.layer !== layer) continue;
      const level = steadyLightLevel(l, x, y);
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
    return sum;
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

  /** Ambient at world px (x, y): bilinear between the tile centres (a weather region border is a soft step). */
  private ambientAt(layer: Layer, x: number, y: number): number {
    const u = x / TILE_PX - 0.5;
    const v = y / TILE_PX - 0.5;
    const tx = Math.floor(u);
    const ty = Math.floor(v);
    const fx = u - tx;
    const fy = v - ty;
    const a = this.memoAmbient[this.memo(layer, tx, ty)] as number;
    const b = this.memoAmbient[this.memo(layer, tx + 1, ty)] as number;
    const c = this.memoAmbient[this.memo(layer, tx, ty + 1)] as number;
    const d = this.memoAmbient[this.memo(layer, tx + 1, ty + 1)] as number;
    const top = a + (b - a) * fx;
    return top + (c + (d - c) * fx - top) * fy;
  }

  /** Memo slot of tile (tx, ty) with its ambient and source level of this generation. */
  private memo(layer: Layer, tx: number, ty: number): number {
    const slot = (Math.imul(tx, HASH_X) ^ Math.imul(ty, HASH_Y) ^ Math.imul(layer, HASH_L)) & MEMO_MASK;
    if (this.memoGeneration[slot] !== this.generation || this.memoX[slot] !== tx || this.memoY[slot] !== ty || this.memoLayer[slot] !== layer) {
      this.memoGeneration[slot] = this.generation;
      this.memoX[slot] = tx;
      this.memoY[slot] = ty;
      this.memoLayer[slot] = layer;
      this.memoSource[slot] = this.tileSources(layer, tx, ty);
      this.memoAmbient[slot] = this.inputs.ambient(layer, tx, ty);
    }
    return slot;
  }

  /** Sum of the lights that reach tile (tx, ty) of `layer`, at its centre on the ground. */
  private tileSources(layer: Layer, tx: number, ty: number): number {
    this.refreshEntries();
    const lights = this.entryLights;
    const entries = this.entries;
    const cx = (tx + 0.5) * TILE_PX;
    const cy = (ty + 0.5) * TILE_PX;
    let sum = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as MapLight;
      if (l.layer !== layer) continue;
      if (!(entries[i] as OcclusionEntry).visible(tx, ty)) continue;
      sum += steadyLightLevel(l, cx, cy);
    }
    return sum;
  }

  /** Occlusion masks of this generation's lights (looked up once per generation). */
  private refreshEntries(): void {
    if (this.entriesGeneration === this.generation) return;
    this.entriesGeneration = this.generation;
    const lights = this.inputs.lights();
    const occluders = this.inputs.occluders;
    this.entryLights.length = 0;
    this.entries.length = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as MapLight;
      if (!(l.radius > 0) || !(l.intensity > 0)) continue;
      const tx = tileOf(l.x);
      const ty = tileOf(l.y);
      occluders.beginQuery();
      const level = lightLevelOfTile(occluders.info(l.layer, tx, ty));
      this.entryLights.push(l);
      this.entries.push(this.occlusion.window(occluders, l.id, l.layer, tx, ty, l.windowTiles, level));
    }
  }
}
