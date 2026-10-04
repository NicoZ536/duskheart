/**
 * `RenderScene.surface` (docs/RENDER.md §4 "Welt-Oberfläche"): what the world surface of a frame looks like – the
 * wind as a vector, the ground's wetness and puddles, the snow cover, the seasonal foliage blend, the figures that
 * push the grass aside and the footprints in the snow. Filled per frame by the game view (`world/surfaceScene.ts`);
 * scenes that do not fill it keep the neutral surface (dry, no snow) and sway with `env.wind` as before.
 *
 * No allocation per frame: the lists are typed arrays of a fixed capacity.
 */
import { SURFACE_PARAMS } from './params';
import { oneAt, zeroAt } from '../uniformBits';

/** Fields of one bender (a figure pressing the grass): x, y [world px], radius [px], strength 0…1. */
export const BENDER_FIELDS = 4;
/** Fields of one footprint: x, y [world px], strength 0…1 (fades), side (−1 left, +1 right) × facing code. */
export const FOOTPRINT_FIELDS = 4;

/**
 * Slots of `SurfaceState.values`: the frame's scalar surface values (see the accessors of the same names). Ordered for
 * the uniforms that copy them: snow, wetness, puddles (the terrain's weather), the wind vector, the gust.
 */
export const SURFACE_SLOT = { snow: 0, wetness: 1, puddles: 2, windX: 3, windY: 4, gust: 5, seasonProgress: 6, canopyOpen: 7 } as const;
/** Length of `SurfaceState.values`. */
export const SURFACE_VALUES = 8;
/** The neutral surface a frame starts with: calm, dry, no snow, no change of season, the see-through circle open. */
const NEUTRAL_VALUES = new Float64Array(SURFACE_VALUES);
NEUTRAL_VALUES[SURFACE_SLOT.canopyOpen] = 1;

export class SurfaceState {
  /**
   * Whether a weather source filled the wind this frame; otherwise the sprites sway with the signed
   * `env.wind` along x (the M1 scenes and debug scenes set only that).
   */
  weatherDriven = false;
  /**
   * The scalar values of the frame (slots `SURFACE_SLOT`) behind the accessors below. A filler that keeps its values
   * between frames hands a whole set over with one copy (`values.set`): reading a float out of a record makes a new
   * number in V8's baseline tier, copying a typed array does not (§30).
   */
  readonly values = new Float64Array(SURFACE_VALUES);
  /** The same memory as 32-bit words (`zero`, `one`, change detection of the uniforms). */
  readonly words = new Int32Array(this.values.buffer);
  /** Snow, wetness and puddles as a view (the terrain's weather uniform copies it without a read). */
  readonly groundValues = this.values.subarray(SURFACE_SLOT.snow, SURFACE_SLOT.puddles + 1);
  /** Whether it is snowing now (fresh snow fills footprints). */
  snowing = false;
  /** Foliage blend of the seasons (`SEASON_IDS` indices): from → to with progress 0…1; `to` = −1 outside a change. */
  seasonFrom = 0;
  seasonTo = -1;
  /** Figures pushing the grass: `BENDER_FIELDS` floats each. */
  readonly benders = new Float32Array(SURFACE_PARAMS.grass.maxBenders * BENDER_FIELDS);
  benderCount = 0;
  /** Footprints to stamp this frame: `FOOTPRINT_FIELDS` floats each. */
  readonly footprints = new Float32Array(SURFACE_PARAMS.footprints.capacity * FOOTPRINT_FIELDS);
  footprintCount = 0;

  constructor() {
    this.values.set(NEUTRAL_VALUES);
  }

  /** Wind vector (sway scale; +x east, +y south – the direction it blows towards) and gust strength 0…1. */
  get windX(): number {
    return this.values[SURFACE_SLOT.windX] as number;
  }
  set windX(v: number) {
    this.values[SURFACE_SLOT.windX] = v;
  }
  get windY(): number {
    return this.values[SURFACE_SLOT.windY] as number;
  }
  set windY(v: number) {
    this.values[SURFACE_SLOT.windY] = v;
  }
  get gust(): number {
    return this.values[SURFACE_SLOT.gust] as number;
  }
  set gust(v: number) {
    this.values[SURFACE_SLOT.gust] = v;
  }
  /** Wetness of the ground 0…1 (rain soaks it, it dries slowly). */
  get wetness(): number {
    return this.values[SURFACE_SLOT.wetness] as number;
  }
  set wetness(v: number) {
    this.values[SURFACE_SLOT.wetness] = v;
  }
  /** Fill of the puddles 0…1 (they gather in hollows once the ground is wet). */
  get puddles(): number {
    return this.values[SURFACE_SLOT.puddles] as number;
  }
  set puddles(v: number) {
    this.values[SURFACE_SLOT.puddles] = v;
  }
  /** Snow cover 0…1 on up-facing surfaces (ground, roofs, crowns, rock tops). */
  get snow(): number {
    return this.values[SURFACE_SLOT.snow] as number;
  }
  set snow(v: number) {
    this.values[SURFACE_SLOT.snow] = v;
  }
  /** Progress 0…1 of the foliage blend `seasonFrom` → `seasonTo`. */
  get seasonProgress(): number {
    return this.values[SURFACE_SLOT.seasonProgress] as number;
  }
  set seasonProgress(v: number) {
    this.values[SURFACE_SLOT.seasonProgress] = v;
  }
  /** How far the see-through circle around the player is open 0…1 (it irises open under a crown or roof). */
  get canopyOpen(): number {
    return this.values[SURFACE_SLOT.canopyOpen] as number;
  }
  set canopyOpen(v: number) {
    this.values[SURFACE_SLOT.canopyOpen] = v;
  }

  /** Whether the value in `slot` (`SURFACE_SLOT`) is exactly +0, told without reading a float (§30). */
  zero(slot: number): boolean {
    return zeroAt(this.words, slot);
  }

  /** Whether the value in `slot` (`SURFACE_SLOT`) is exactly 1, told without reading a float (§30). */
  one(slot: number): boolean {
    return oneAt(this.words, slot);
  }

  /** A new frame: nothing pushes the grass or stamps prints until a filler says so; the weather is neutral again. */
  beginFrame(): void {
    this.weatherDriven = false;
    this.values.set(NEUTRAL_VALUES);
    this.snowing = false;
    this.seasonTo = -1;
    this.benderCount = 0;
    this.footprintCount = 0;
  }

  /** Adds a figure that pushes the grass (ignored beyond the capacity). */
  addBender(x: number, y: number, radius: number, strength: number): void {
    const max = this.benders.length / BENDER_FIELDS;
    if (this.benderCount >= max) return;
    const o = this.benderCount++ * BENDER_FIELDS;
    const b = this.benders;
    b[o] = x;
    b[o + 1] = y;
    b[o + 2] = radius;
    b[o + 3] = strength;
  }

  /**
   * Adds a figure that pushes the grass at the point held in `at` (x, y [world px]; a typed pair is copied without
   * reading a float, §30) – the same as `addBender(at[0], at[1], radius, strength)`.
   */
  addBenderAt(at: Float64Array, radius: number, strength: number): void {
    const max = this.benders.length / BENDER_FIELDS;
    if (this.benderCount >= max) return;
    const o = this.benderCount++ * BENDER_FIELDS;
    const b = this.benders;
    b.set(at, o);
    b[o + 2] = radius;
    b[o + 3] = strength;
  }

  /** Adds a footprint to stamp (ignored beyond the capacity). */
  addFootprint(x: number, y: number, strength: number, side: number): void {
    const max = this.footprints.length / FOOTPRINT_FIELDS;
    if (this.footprintCount >= max) return;
    const o = this.footprintCount++ * FOOTPRINT_FIELDS;
    const f = this.footprints;
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = strength;
    f[o + 3] = side;
  }
}
