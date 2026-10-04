/**
 * The light strand's part of the render scene (`RenderScene.sky`, docs/RENDER.md §4): the directional light of
 * sun or moon with its shadow vector, the sky light it is split from, cloud cover and drift, the wind the canopy
 * flecks sway with, the occluders the terrain and the build grid contribute to the occluder mask, and the build grid's
 * blocks that cast the sun's shadow of a house.
 *
 * A scene that leaves it alone gets the M1 behaviour: the flat ambient of `scene.env`, no sun shadows (the
 * occluder pass still shadows point lights and darkens the ambient at the feet of occluders). The game view fills
 * it every frame from calendar and weather (`world/skyScene.ts`).
 */
import { OccluderList } from './occluders';
import { SunCasterList } from './sunCasters';

/** Floats of `SkyState.fogDrift`: x, y of the low, mid and high fog layer. */
export const FOG_DRIFT_FLOATS = 6;

/** Directional light (sun by day, moon by night). */
export interface DirectionalLight {
  /**
   * Share of the ambient light (`scene.env`) that arrives as this directed light on a flat, unshadowed pixel
   * (0 = none: all ambient is sky light). The sky part and this part add up to the ambient exactly.
   */
  share: number;
  /** Tint of the directed part and of the sky part (multipliers of the ambient colour; the parts sum to it). */
  dirR: number;
  dirG: number;
  dirB: number;
  skyR: number;
  skyG: number;
  skyB: number;
  /** Unit direction towards the light in the screen space of the normal maps (+x right, +y up, +z viewer). */
  lx: number;
  ly: number;
  lz: number;
  /** Relief strength of its normal mapping (1 + relief · (n·l − l_z)). */
  relief: number;
  /** Shadow vector: where shadows fall on the ground (unit, +x east, +y south) and their length per unit height. */
  shadowX: number;
  shadowY: number;
  shadowLength: number;
}

/** Cloud shadows (M5-03). */
export interface CloudShadows {
  /** Cloud cover 0…1 (0: no cloud shadow at all). */
  cover: number;
  /**
   * Offset of the cloud field at this frame [world px]: the wind's drift integrated over the presentation clock and kept
   * within half the field's period of 0 (`world/drift.ts`, `CLOUDS.periodCells`).
   */
  offsetX: number;
  offsetY: number;
}

/** Slots of `DirectionalRecord`'s values. */
const SHARE = 0;
const DIR_R = 1;
const DIR_G = 2;
const DIR_B = 3;
const SKY_R = 4;
const SKY_G = 5;
const SKY_B = 6;
const LX = 7;
const LY = 8;
const LZ = 9;
const RELIEF = 10;
const SHADOW_X = 11;
const SHADOW_Y = 12;
const SHADOW_LENGTH = 13;
const DIRECTIONAL_VALUES = 14;

/**
 * The scene's directional light (`SkyState.directional`): the values of `DirectionalLight` as doubles behind accessors
 * that count every write (`version`). Code that runs once a frame stays in V8's baseline tier for a long time, where
 * every float read from a record is a new heap number (§30): a pass keeping something derived from the light – uniform
 * inputs, the shadow target's placement – compares the version (with `lit`) instead of reading fourteen floats, and a
 * filler hands over a whole light with `copyFrom` (no float read either).
 *
 * `SkyState.beginFrame` puts the light out (`lit` false: the share reads 0, the values stay); writing the share, `copyFrom`
 * or `relight` (the same light as before) lights it for the frame.
 */
export class DirectionalRecord implements DirectionalLight {
  /** Counts the writes of the values (not `darken`/`relight`). */
  version = 0;
  /** Whether the record shines this frame; the share reads 0 otherwise. */
  lit = true;
  /** The stored share is > 0 (`hasDirectional` reads no float). */
  private positive = false;
  private readonly values = new Float64Array(DIRECTIONAL_VALUES);

  constructor() {
    const v = this.values;
    v[DIR_R] = 1;
    v[DIR_G] = 1;
    v[DIR_B] = 1;
    v[SKY_R] = 1;
    v[SKY_G] = 1;
    v[SKY_B] = 1;
    v[LY] = 0.7071;
    v[LZ] = 0.7071;
    v[SHADOW_Y] = -1;
  }

  /** Whether a directed light shines this frame (lit, share > 0). */
  get shines(): boolean {
    return this.lit && this.positive;
  }

  get share(): number {
    return this.lit ? (this.values[SHARE] as number) : 0;
  }
  set share(v: number) {
    this.values[SHARE] = v;
    this.positive = v > 0;
    this.lit = true;
    this.version++;
  }
  get dirR(): number {
    return this.values[DIR_R] as number;
  }
  set dirR(v: number) {
    this.write(DIR_R, v);
  }
  get dirG(): number {
    return this.values[DIR_G] as number;
  }
  set dirG(v: number) {
    this.write(DIR_G, v);
  }
  get dirB(): number {
    return this.values[DIR_B] as number;
  }
  set dirB(v: number) {
    this.write(DIR_B, v);
  }
  get skyR(): number {
    return this.values[SKY_R] as number;
  }
  set skyR(v: number) {
    this.write(SKY_R, v);
  }
  get skyG(): number {
    return this.values[SKY_G] as number;
  }
  set skyG(v: number) {
    this.write(SKY_G, v);
  }
  get skyB(): number {
    return this.values[SKY_B] as number;
  }
  set skyB(v: number) {
    this.write(SKY_B, v);
  }
  get lx(): number {
    return this.values[LX] as number;
  }
  set lx(v: number) {
    this.write(LX, v);
  }
  get ly(): number {
    return this.values[LY] as number;
  }
  set ly(v: number) {
    this.write(LY, v);
  }
  get lz(): number {
    return this.values[LZ] as number;
  }
  set lz(v: number) {
    this.write(LZ, v);
  }
  get relief(): number {
    return this.values[RELIEF] as number;
  }
  set relief(v: number) {
    this.write(RELIEF, v);
  }
  get shadowX(): number {
    return this.values[SHADOW_X] as number;
  }
  set shadowX(v: number) {
    this.write(SHADOW_X, v);
  }
  get shadowY(): number {
    return this.values[SHADOW_Y] as number;
  }
  set shadowY(v: number) {
    this.write(SHADOW_Y, v);
  }
  get shadowLength(): number {
    return this.values[SHADOW_LENGTH] as number;
  }
  set shadowLength(v: number) {
    this.write(SHADOW_LENGTH, v);
  }

  /** Takes every value of `from`, lit as it is (a new version). */
  copyFrom(from: DirectionalRecord): void {
    this.values.set(from.values);
    this.positive = from.positive;
    this.lit = from.lit;
    this.version++;
  }

  /** Puts the light out for the frame (the values stay). */
  darken(): void {
    this.lit = false;
  }

  /** Lights the stored light again (a frame that keeps the last light). */
  relight(): void {
    this.lit = true;
  }

  /** A plain copy (debug reports). */
  snapshot(): DirectionalLight {
    return {
      share: this.share,
      dirR: this.dirR,
      dirG: this.dirG,
      dirB: this.dirB,
      skyR: this.skyR,
      skyG: this.skyG,
      skyB: this.skyB,
      lx: this.lx,
      ly: this.ly,
      lz: this.lz,
      relief: this.relief,
      shadowX: this.shadowX,
      shadowY: this.shadowY,
      shadowLength: this.shadowLength,
    };
  }

  private write(slot: number, v: number): void {
    this.values[slot] = v;
    this.version++;
  }
}

/** Slots of `SkyState.values`: the wind for the canopy flecks and the cloud field (see the accessors). */
export const SKY_SLOT = { windX: 0, windY: 1, cover: 2, offsetX: 3, offsetY: 4 } as const;
/** Length of `SkyState.values`. */
export const SKY_VALUES = 5;

/** The cloud field of the frame (`SkyState.clouds`): cover and offset held in the sky's typed record. */
class CloudRecord implements CloudShadows {
  constructor(private readonly values: Float64Array) {}

  get cover(): number {
    return this.values[SKY_SLOT.cover] as number;
  }
  set cover(v: number) {
    this.values[SKY_SLOT.cover] = v;
  }
  get offsetX(): number {
    return this.values[SKY_SLOT.offsetX] as number;
  }
  set offsetX(v: number) {
    this.values[SKY_SLOT.offsetX] = v;
  }
  get offsetY(): number {
    return this.values[SKY_SLOT.offsetY] as number;
  }
  set offsetY(v: number) {
    this.values[SKY_SLOT.offsetY] = v;
  }
}

export class SkyState {
  readonly directional = new DirectionalRecord();
  /**
   * Wind and cloud field in a typed record behind the accessors (`windX`, `windY`, `clouds`): a filler that keeps them
   * between frames hands them over with one copy, the shadow pass copies them into its uniforms – no float is read (§30).
   */
  readonly values = new Float64Array(SKY_VALUES);
  /** Views for the uniforms: the wind; the cloud cover and offset. */
  readonly windValues = this.values.subarray(SKY_SLOT.windX, SKY_SLOT.windY + 1);
  readonly cloudValues = this.values.subarray(SKY_SLOT.cover, SKY_SLOT.offsetY + 1);
  readonly clouds: CloudShadows = new CloudRecord(this.values);
  /**
   * Offsets of the fog's three noise layers (low mist, banks, high veils: x, y each [1/DRIFT_UNITS world px, whole
   * numbers]), the wind's drift integrated over the presentation clock and kept modulo each layer's tile
   * (`world/skyScene.ts`, `world/drift.ts`); the atmosphere pass uploads them as they are, the shader divides. Kept
   * between frames (a scene without the game view's filler has no fog).
   */
  readonly fogDrift = new Float32Array(FOG_DRIFT_FLOATS);
  /** Wind for the canopy flecks: direction and strength (the vector's length, 0…1). */
  get windX(): number {
    return this.values[SKY_SLOT.windX] as number;
  }
  set windX(v: number) {
    this.values[SKY_SLOT.windX] = v;
  }
  get windY(): number {
    return this.values[SKY_SLOT.windY] as number;
  }
  set windY(v: number) {
    this.values[SKY_SLOT.windY] = v;
  }
  /** Terrain and build-grid occluders of the frame (the sprites' own are collected by the occluder pass). */
  readonly occluders = new OccluderList();
  /** Sun and moon casters of the build grid: walls, doors, windows (their panes), roofs (`sunCasters.ts`). */
  readonly sunCasters = new SunCasterList();

  /** Whether a directed light shines (sun shadows are drawn). */
  get hasDirectional(): boolean {
    return this.directional.shines;
  }

  /**
   * Starts a frame: no directed light (put out: the share reads 0 – every reader asks `hasDirectional` first, the rest of
   * the record keeps the last values, so a scene that did not change its sun need not write it again, `relight`), no
   * clouds, no wind, no occluders – the scene sets what it has.
   */
  beginFrame(): void {
    this.directional.darken();
    this.values.fill(0, SKY_SLOT.windX, SKY_SLOT.cover + 1);
    this.occluders.clear();
    this.sunCasters.clear();
  }
}
