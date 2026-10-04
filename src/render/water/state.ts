/**
 * The water strand's part of the render scene (`RenderScene.water`, docs/RENDER.md §4): what the water pass needs
 * beyond the G-buffer, filled by the scene every frame –
 * - the **impulse API** of the interactive waves: figures, raindrops, arrows, fish and splashes kick the wave field
 *   (`impulse(kind, x, y, scale)`, `impulseAt`); the pass applies them at its next simulation step;
 * - the **tile grid** of the water around the camera (depth class, frozen, shore distance, level), so waves run
 *   and ice lies where the world has water, also beyond the edge of the picture;
 * - the **immersion masks** of the figures standing or swimming in water (§6.1 pass 7 "Eintauchmaske");
 * - the **sky** the water mirrors (colours by daytime and weather, stars, moon, sun glitter) and the wind that
 *   drives the small waves; the shore ice of a hard frost.
 *
 * A scene that leaves it alone gets water from the G-buffer alone under a clear day sky (M1/M2 debug scenes).
 * Preallocated, no allocation per frame.
 */
import { paletteRgb } from './colour';
import { GLITTER, IMPULSES, MAX_IMMERSIONS, MAX_IMPULSES, MOON, SKY, TILE_GRID, type WaterImpulseKind } from './params';
import { TILE_PX } from '../tilemap/chunk';

/** Impulses of one frame (struct of arrays; world px). */
export class WaterImpulses {
  readonly x = new Float32Array(MAX_IMPULSES);
  readonly y = new Float32Array(MAX_IMPULSES);
  readonly strength = new Float32Array(MAX_IMPULSES);
  readonly radius = new Float32Array(MAX_IMPULSES);
  private n = 0;
  private droppedCount = 0;

  get count(): number {
    return this.n;
  }

  /** Impulses refused this frame because the list was full. */
  get dropped(): number {
    return this.droppedCount;
  }

  clear(): void {
    this.n = 0;
    this.droppedCount = 0;
  }

  /** Adds an impulse; false (counted as dropped) when the list is full or the values are not finite. */
  push(x: number, y: number, strength: number, radius: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(strength) || !(radius > 0) || strength === 0) return false;
    if (this.n >= MAX_IMPULSES) {
      this.droppedCount++;
      return false;
    }
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.strength[i] = strength;
    this.radius[i] = radius;
    return true;
  }
}

/**
 * Figures standing or swimming in water (§6.1 pass 7 "Eintauchmaske"): below the waterline the figure is seen
 * through the water – tinted, wobbling with the waves, fading with depth – and a glint runs along the line.
 *
 * - `x`, `y`: the figure's anchor (feet) [world px]; `halfWidth`: half the width of its drawing [px]; `top`: how far
 *   its drawing reaches above the anchor [px];
 * - `line`: the waterline [px above the anchor] – the water surface in the figure's own frame (a swimmer is sunk);
 * - `frame…`: optional body frame drawn under water where the figure's own sprite is already cut at the waterline
 *   (the swimming player's swim frames): atlas rectangle, anchor in the frame, mirror flag, palette row and how far
 *   the frame is lowered; `frameW` 0 = cut the figure's drawn pixels instead (a wading figure).
 */
export class WaterImmersions {
  readonly x = new Float32Array(MAX_IMMERSIONS);
  readonly y = new Float32Array(MAX_IMMERSIONS);
  readonly halfWidth = new Float32Array(MAX_IMMERSIONS);
  readonly top = new Float32Array(MAX_IMMERSIONS);
  readonly line = new Float32Array(MAX_IMMERSIONS);
  readonly frameX = new Float32Array(MAX_IMMERSIONS);
  readonly frameY = new Float32Array(MAX_IMMERSIONS);
  readonly frameW = new Float32Array(MAX_IMMERSIONS);
  readonly frameH = new Float32Array(MAX_IMMERSIONS);
  readonly anchorX = new Float32Array(MAX_IMMERSIONS);
  readonly anchorY = new Float32Array(MAX_IMMERSIONS);
  readonly mirror = new Uint8Array(MAX_IMMERSIONS);
  readonly row = new Uint8Array(MAX_IMMERSIONS);
  readonly sink = new Float32Array(MAX_IMMERSIONS);
  private n = 0;

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /** A figure whose drawn pixels below `line` [px above its feet] are under water; returns its slot or −1 when full. */
  push(x: number, y: number, halfWidth: number, top: number, line: number): number {
    if (this.n >= MAX_IMMERSIONS || !Number.isFinite(x) || !Number.isFinite(y) || !(halfWidth > 0) || !(top > 0)) return -1;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.halfWidth[i] = halfWidth;
    this.top[i] = top;
    this.line[i] = Math.max(0, line);
    this.frameW[i] = 0;
    this.frameH[i] = 0;
    this.sink[i] = 0;
    this.mirror[i] = 0;
    this.row[i] = 0;
    return i;
  }

  /** Gives slot `i` a body frame to draw under the water (atlas rect, anchor in the frame, mirror, palette row, lowered by `sink` px). */
  body(i: number, fx: number, fy: number, fw: number, fh: number, ax: number, ay: number, mirror: boolean, row: number, sink: number): void {
    if (i < 0 || i >= this.n) return;
    this.frameX[i] = fx;
    this.frameY[i] = fy;
    this.frameW[i] = fw;
    this.frameH[i] = fh;
    this.anchorX[i] = ax;
    this.anchorY[i] = ay;
    this.mirror[i] = mirror ? 1 : 0;
    this.row[i] = row;
    this.sink[i] = sink;
  }
}

/** Channels of the tile grid (RGBA8 per tile). */
export const WATER_TILE = {
  /** R: depth class 0 none, 1 shallow, 2 deep (open water only; frozen water has 0 here and the frozen flag). */
  depth: 0,
  /** G: flags (`WATER_TILE_FLAG`). */
  flags: 1,
  /** B: distance from the tile's centre to the nearest land tile [px] (0 on land; `SHORE_TILES`). */
  shore: 2,
  /** A: height level of the tile (water surface = level × 16 px). */
  level: 3,
} as const;

/** Flags of the tile grid's G channel. */
export const WATER_TILE_FLAG = {
  frozen: 1,
  river: 2,
  sea: 4,
  lake: 8,
  /** Glacier ice on the ground (the `eis` terrain): cracks and a faint mirror like frozen water. */
  iceGround: 16,
} as const;

/** Tiles of the grid across and down (the largest view plus a margin, `TILE_GRID`). */
export const WATER_GRID_W = Math.ceil(TILE_GRID.viewWidthPx / TILE_PX) + 2 * TILE_GRID.marginTiles;
export const WATER_GRID_H = Math.ceil(TILE_GRID.viewHeightPx / TILE_PX) + 2 * TILE_GRID.marginTiles;
const RGBA = 4;

/**
 * The water around the camera, one RGBA8 texel per tile (channels `WATER_TILE`). Row 0 of `data` is the grid's
 * southern row (GL's first texture row), so the pass uploads it as it is.
 */
export class WaterTiles {
  readonly width = WATER_GRID_W;
  readonly height = WATER_GRID_H;
  readonly data = new Uint8Array(WATER_GRID_W * WATER_GRID_H * RGBA);
  /** Tile coordinates of the grid's north-west tile. */
  originTx = 0;
  originTy = 0;
  /** Whether a scene filled the grid this frame (otherwise the pass knows water only from the G-buffer). */
  known = false;
  /** Open water, frozen and deep tiles in the grid (the pass skips a frame without water). */
  waterTiles = 0;
  frozenTiles = 0;
  deepTiles = 0;
  /** Content version: bumps whenever `data` changed (the pass uploads then). */
  version = 0;

  /** Byte offset of tile (tx, ty) in `data`, or −1 outside the grid. */
  offset(tx: number, ty: number): number {
    const x = tx - this.originTx;
    const y = ty - this.originTy;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return ((this.height - 1 - y) * this.width + x) * RGBA;
  }

  /** Channel `c` of tile (tx, ty) (0 outside the grid). */
  get(tx: number, ty: number, c: number): number {
    const o = this.offset(tx, ty);
    return o < 0 ? 0 : (this.data[o + c] ?? 0);
  }
}

/**
 * Fields of the mirrored sky in `WaterSky.values`: five vec4s, uploaded to the surface shader as they are (`uSky`,
 * water_surface.frag) – filled and read without a single float passing through a function call.
 */
export const SKY_FIELD = {
  zenithR: 0,
  zenithG: 1,
  zenithB: 2,
  /** The sunlight share reaching the ground (caustics). */
  sunlight: 3,
  horizonR: 4,
  horizonG: 5,
  horizonB: 6,
  /** Share of the sky in the water colour. */
  share: 7,
  /** Visibility of the stars 0…1 (night, clear sky). */
  stars: 8,
  /** Sun glitter strength 0…1. */
  glitter: 9,
  /** Moon: waxing (1: lit on the right) or waning (0), brightness 0…1 (0 = not up), place as shares of the view, lit fraction 0…1. */
  moonWaxing: 10,
  moon: 11,
  moonX: 12,
  moonY: 13,
  moonLit: 14,
  /**
   * The sun's mirror path (`GLITTER`): its mirror point as shares of the view (x from the left, y from the top), the
   * path's length (share of the view height) and its half width at the near end (share of the view width).
   */
  sunX: 16,
  sunY: 17,
  sunPath: 18,
  sunPathWidth: 19,
} as const;
/** Floats of the sky record (five vec4s). */
export const SKY_FLOATS = 20;

const DAY_ZENITH = paletteRgb(SKY.dayZenith);
const DAY_HORIZON = paletteRgb(SKY.dayHorizon);

/** The clear day sky at noon (what a scene without a sky filler shows: the M1/M2 debug scenes). */
const DAY_SKY: Readonly<Record<keyof typeof SKY_FIELD, number>> = {
  zenithR: DAY_ZENITH[0],
  zenithG: DAY_ZENITH[1],
  zenithB: DAY_ZENITH[2],
  horizonR: DAY_HORIZON[0],
  horizonG: DAY_HORIZON[1],
  horizonB: DAY_HORIZON[2],
  share: SKY.dayShare,
  stars: 0,
  moon: 0,
  moonLit: 1,
  moonWaxing: 1,
  moonX: 0.5,
  moonY: MOON.topShare,
  glitter: 1,
  sunlight: 1,
  sunX: 0.5,
  sunY: GLITTER.highTop,
  sunPath: GLITTER.highLength,
  sunPathWidth: GLITTER.highHalfWidth,
};

/** Mirrored sky: colours in linear HDR, positions as shares of the view (fields `SKY_FIELD`). */
export class WaterSky {
  readonly values = new Float32Array(SKY_FLOATS);

  constructor() {
    for (const [k, v] of Object.entries(DAY_SKY)) this.values[SKY_FIELD[k as keyof typeof SKY_FIELD]] = v;
  }

  private at(i: number): number {
    return this.values[i] ?? 0;
  }

  get zenithR(): number {
    return this.at(SKY_FIELD.zenithR);
  }
  get zenithG(): number {
    return this.at(SKY_FIELD.zenithG);
  }
  get zenithB(): number {
    return this.at(SKY_FIELD.zenithB);
  }
  get horizonR(): number {
    return this.at(SKY_FIELD.horizonR);
  }
  get horizonG(): number {
    return this.at(SKY_FIELD.horizonG);
  }
  get horizonB(): number {
    return this.at(SKY_FIELD.horizonB);
  }
  get share(): number {
    return this.at(SKY_FIELD.share);
  }
  get stars(): number {
    return this.at(SKY_FIELD.stars);
  }
  get moon(): number {
    return this.at(SKY_FIELD.moon);
  }
  get moonLit(): number {
    return this.at(SKY_FIELD.moonLit);
  }
  get moonWaxing(): boolean {
    return this.at(SKY_FIELD.moonWaxing) > 0;
  }
  get moonX(): number {
    return this.at(SKY_FIELD.moonX);
  }
  get moonY(): number {
    return this.at(SKY_FIELD.moonY);
  }
  get glitter(): number {
    return this.at(SKY_FIELD.glitter);
  }
  get sunlight(): number {
    return this.at(SKY_FIELD.sunlight);
  }
  get sunX(): number {
    return this.at(SKY_FIELD.sunX);
  }
  get sunY(): number {
    return this.at(SKY_FIELD.sunY);
  }
  get sunPath(): number {
    return this.at(SKY_FIELD.sunPath);
  }
  get sunPathWidth(): number {
    return this.at(SKY_FIELD.sunPathWidth);
  }

  /** Copies another sky. */
  copy(from: WaterSky): void {
    this.values.set(from.values);
  }
}

/** A clear day sky. */
export function daySky(): WaterSky {
  return new WaterSky();
}

/** Slots of `WaterState.values`: the wind's direction and strength, the shore ice (see the accessors). */
export const WATER_SLOT = { windX: 0, windY: 1, windStrength: 2, shoreIcePx: 3 } as const;
/** Length of `WaterState.values`. */
export const WATER_VALUES = 4;
/** Calm air, no shore ice (the start of each frame). */
const CALM_WATER = new Float64Array(WATER_VALUES);
CALM_WATER[WATER_SLOT.windX] = 1;

export class WaterState {
  readonly impulses = new WaterImpulses();
  readonly immersions = new WaterImmersions();
  readonly tiles = new WaterTiles();
  readonly sky = new WaterSky();
  /**
   * Wind and shore ice in a typed record behind the accessors below: a filler hands its values over with one copy, the
   * water pass copies them into its frame values and tells a still wind from the words – no float is read (§30).
   */
  readonly values = new Float64Array(WATER_VALUES);
  /** The wind's words (direction x, y: four words). */
  readonly windWords = new Int32Array(this.values.buffer, 0, 4);
  /** Views for the frame values: wind direction and strength; the shore ice. */
  readonly windValues = this.values.subarray(WATER_SLOT.windX, WATER_SLOT.windStrength + 1);
  readonly iceValue = this.values.subarray(WATER_SLOT.shoreIcePx, WATER_SLOT.shoreIcePx + 1);
  /**
   * The state of the world the drifts' velocities come from (the simulation tick; 0 in a scene without one): a frame
   * whose presentation clock stands while it changed is a still picture whose world moved on – the water's drifts then
   * show velocity × time under the wind they end with (`DriftOffset.advance`, M5-43).
   */
  stepKey = 0;
  private readonly defaults = new WaterSky();

  constructor() {
    this.values.set(CALM_WATER);
  }

  /** Wind the small waves run with: direction (unit) and strength 0…1. */
  get windX(): number {
    return this.values[WATER_SLOT.windX] as number;
  }
  set windX(v: number) {
    this.values[WATER_SLOT.windX] = v;
  }
  get windY(): number {
    return this.values[WATER_SLOT.windY] as number;
  }
  set windY(v: number) {
    this.values[WATER_SLOT.windY] = v;
  }
  get windStrength(): number {
    return this.values[WATER_SLOT.windStrength] as number;
  }
  set windStrength(v: number) {
    this.values[WATER_SLOT.windStrength] = v;
  }
  /** Width of the ice grown from the shore in frost [px] (0: none). */
  get shoreIcePx(): number {
    return this.values[WATER_SLOT.shoreIcePx] as number;
  }
  set shoreIcePx(v: number) {
    this.values[WATER_SLOT.shoreIcePx] = v;
  }

  /**
   * Kicks the wave field at world px (x, y) with the impulse `kind` (`IMPULSES`: figure, figureIdle, rain, arrow,
   * fish, splash); `scale` multiplies its strength – a continuous source (a figure moving through the water) passes
   * the frame time [s], an event 1. Returns false when the frame's impulse list is full.
   */
  impulse(kind: WaterImpulseKind, x: number, y: number, scale = 1): boolean {
    const k = IMPULSES[kind];
    return this.impulses.push(x, y, k.strength * scale, k.radiusPx);
  }

  /** Kicks the wave field with a raw strength (height units) and radius [px]. */
  impulseAt(x: number, y: number, strength: number, radiusPx: number): boolean {
    return this.impulses.push(x, y, strength, radiusPx);
  }

  /** Starts a frame: no impulses, no figures, grid unknown, the default sky, calm air, no shore ice, no world. */
  beginFrame(): void {
    this.impulses.clear();
    this.immersions.clear();
    this.tiles.known = false;
    this.sky.copy(this.defaults);
    this.values.set(CALM_WATER);
    this.stepKey = 0;
  }
}
