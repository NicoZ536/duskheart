/**
 * Per-frame sprite list of a `RenderScene`: producers push sprites through one reusable
 * `SpriteDesc`; the records are written straight into a preallocated interleaved buffer in the
 * instance layout (`spriteLayout.ts`), and the y-sort keys (layer, depth, the frame's depth range)
 * are kept alongside. Nothing is allocated per frame – the storage only grows (by doubling) when a
 * frame needs more sprites than ever before.
 *
 * `push` is the hottest function of the frame path (one call per sprite, M1-28): every offset, flag
 * and bound is a constant of this module (no lookup through an imported binding per field), byte
 * fields go through a clamping view (the typed array clamps and rounds to the nearest integer instead
 * of `Math.min/max/round` per field), and no record is copied.
 */
import { BYTE_MAX, grownCapacity, INSTANCE_STRIDE, INSTANCE_WORDS, LAYER, MAX_PALETTE_ROWS, OFFSET, SPRITE_FLAG, type SpriteLayer } from './spriteLayout';

/** A frame of an atlas: rectangle and anchor (pixel edges from the frame's top-left corner). */
export interface SpriteFrameRef {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
}

/** Initial capacity of a sprite list (grows by doubling). */
export const DEFAULT_SPRITE_CAPACITY = 1024;

const BYTES_PER_INSTANCE = INSTANCE_STRIDE;
const U16_PER_INSTANCE = INSTANCE_STRIDE / Uint16Array.BYTES_PER_ELEMENT;
const F32_PER_INSTANCE = INSTANCE_WORDS;
const F32_POS = OFFSET.pos / Float32Array.BYTES_PER_ELEMENT;
const F32_PARAMS = OFFSET.params / Float32Array.BYTES_PER_ELEMENT;
const U16_RECT = OFFSET.rect / Uint16Array.BYTES_PER_ELEMENT;
const I16_ANCHOR = OFFSET.anchor / Int16Array.BYTES_PER_ELEMENT;
const B_TINT = OFFSET.tint;
const B_MISC = OFFSET.misc;
const FLAG_MIRROR = SPRITE_FLAG.mirror;
const FLAG_OUTLINE = SPRITE_FLAG.outline;
const FLAG_FLASH = SPRITE_FLAG.flash;
const FLAG_WIND = SPRITE_FLAG.wind;
const LAYER_GROUND = LAYER.ground;
const LAYER_WATER = LAYER.water;
const LAYER_OBJECTS = LAYER.objects;
const LAYER_CANOPY = LAYER.canopy;
const PALETTE_ROWS = MAX_PALETTE_ROWS;
/** Scale of a 0…1 value to its 8-bit channel. */
const UNIT_TO_BYTE = BYTE_MAX;

/** Layer index of a layer name (a switch: no keyed lookup per sprite). */
function layerIndex(layer: SpriteLayer): number {
  switch (layer) {
    case 'ground':
      return LAYER_GROUND;
    case 'water':
      return LAYER_WATER;
    case 'canopy':
      return LAYER_CANOPY;
    default:
      return LAYER_OBJECTS;
  }
}

/** Reusable description of one sprite; `reset()` restores the defaults. */
export class SpriteDesc {
  frame: SpriteFrameRef | null = null;
  /** Anchor position in world px (interpolated, not snapped). */
  x = 0;
  y = 0;
  layer: SpriteLayer = 'objects';
  /** y-sort key; `NaN` = the anchor y (the default for everything standing on the ground). */
  depth = Number.NaN;
  /** Palette row (0 = master palette). */
  paletteRow = 0;
  mirror = false;
  /** 1-px outline in the accent colour (interactable under the cursor, §4.6). */
  outline = false;
  /** White hit flash (§6.2 "2-Frame-Trefferblitz"). */
  flash = false;
  /** Sway amplitude in px at the top of the sprite (0 = no wind). */
  windAmplitude = 0;
  windPhase = 0;
  /** Height of the anchor above the ground in px (carried, flying, wall-mounted). */
  heightBase = 0;
  /** Extra emission of emissive pixels, 0…1 (→ up to ×4). */
  emissiveBoost = 0;
  /** Dither fade-out, 0 = opaque … 1 = gone. */
  fade = 0;
  /** Overlay colour (0…255) and its strength 0…1. */
  tintR = 0;
  tintG = 0;
  tintB = 0;
  tintStrength = 0;
  /** Rotation about the anchor in radians (clockwise on screen). */
  rotation = 0;

  reset(): this {
    this.frame = null;
    this.x = 0;
    this.y = 0;
    this.layer = 'objects';
    this.depth = Number.NaN;
    this.paletteRow = 0;
    this.mirror = false;
    this.outline = false;
    this.flash = false;
    this.windAmplitude = 0;
    this.windPhase = 0;
    this.heightBase = 0;
    this.emissiveBoost = 0;
    this.fade = 0;
    this.tintR = 0;
    this.tintG = 0;
    this.tintB = 0;
    this.tintStrength = 0;
    this.rotation = 0;
    return this;
  }
}

export class SpriteList {
  private buffer: ArrayBuffer;
  private f32: Float32Array;
  private u16: Uint16Array;
  private i16: Int16Array;
  /** Byte view that clamps to 0…255 and rounds to the nearest integer (tint, strength, boost, fade). */
  private c8: Uint8ClampedArray;
  private u32: Uint32Array;
  private layers: Uint8Array;
  private depths: Float64Array;
  private n = 0;
  private cap: number;
  private minDepth = Number.POSITIVE_INFINITY;
  private maxDepth = Number.NEGATIVE_INFINITY;

  constructor(initialCapacity = DEFAULT_SPRITE_CAPACITY) {
    this.cap = Math.max(1, Math.floor(initialCapacity));
    this.buffer = new ArrayBuffer(this.cap * INSTANCE_STRIDE);
    this.f32 = new Float32Array(this.buffer);
    this.u16 = new Uint16Array(this.buffer);
    this.i16 = new Int16Array(this.buffer);
    this.c8 = new Uint8ClampedArray(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
    this.layers = new Uint8Array(this.cap);
    this.depths = new Float64Array(this.cap);
  }

  get count(): number {
    return this.n;
  }

  get capacity(): number {
    return this.cap;
  }

  /** Instance records as 32-bit words (`INSTANCE_WORDS` per sprite). */
  get words(): Uint32Array {
    return this.u32;
  }

  get layerKeys(): Uint8Array {
    return this.layers;
  }

  get depthKeys(): Float64Array {
    return this.depths;
  }

  /** Smallest finite depth pushed this frame (`+Infinity` while there is none). */
  get depthMin(): number {
    return this.minDepth;
  }

  /** Largest finite depth pushed this frame (`−Infinity` while there is none). */
  get depthMax(): number {
    return this.maxDepth;
  }

  clear(): void {
    this.n = 0;
    this.minDepth = Number.POSITIVE_INFINITY;
    this.maxDepth = Number.NEGATIVE_INFINITY;
  }

  private grow(needed: number): void {
    const cap = grownCapacity(this.cap, needed);
    const buffer = new ArrayBuffer(cap * INSTANCE_STRIDE);
    new Uint8ClampedArray(buffer).set(this.c8.subarray(0, this.n * INSTANCE_STRIDE));
    const layers = new Uint8Array(cap);
    layers.set(this.layers.subarray(0, this.n));
    const depths = new Float64Array(cap);
    depths.set(this.depths.subarray(0, this.n));
    this.buffer = buffer;
    this.f32 = new Float32Array(buffer);
    this.u16 = new Uint16Array(buffer);
    this.i16 = new Int16Array(buffer);
    this.c8 = new Uint8ClampedArray(buffer);
    this.u32 = new Uint32Array(buffer);
    this.layers = layers;
    this.depths = depths;
    this.cap = cap;
  }

  /** Appends a sprite; returns its index (submission order = tie-break of the y-sort). */
  push(d: SpriteDesc): number {
    const f = d.frame;
    if (f === null) throw new Error('SpriteList.push: Sprite ohne Frame');
    const row = d.paletteRow;
    if (row < 0 || row >= PALETTE_ROWS) throw new RangeError(`Palettenzeile ${row} außerhalb 0…${PALETTE_ROWS - 1}`);
    if (this.n === this.cap) this.grow(this.n + 1);
    const i = this.n++;
    const f32 = this.f32;
    const fo = i * F32_PER_INSTANCE;
    f32[fo + F32_POS] = d.x;
    f32[fo + F32_POS + 1] = d.y;
    f32[fo + F32_PARAMS] = d.heightBase;
    f32[fo + F32_PARAMS + 1] = d.windAmplitude;
    f32[fo + F32_PARAMS + 2] = d.windPhase;
    f32[fo + F32_PARAMS + 3] = d.rotation;
    const so = i * U16_PER_INSTANCE;
    const u16 = this.u16;
    u16[so + U16_RECT] = f.x;
    u16[so + U16_RECT + 1] = f.y;
    u16[so + U16_RECT + 2] = f.w;
    u16[so + U16_RECT + 3] = f.h;
    const i16 = this.i16;
    i16[so + I16_ANCHOR] = f.ax;
    i16[so + I16_ANCHOR + 1] = f.ay;
    const bo = i * BYTES_PER_INSTANCE;
    const c8 = this.c8;
    c8[bo + B_TINT] = d.tintR;
    c8[bo + B_TINT + 1] = d.tintG;
    c8[bo + B_TINT + 2] = d.tintB;
    c8[bo + B_TINT + 3] = d.tintStrength * UNIT_TO_BYTE;
    c8[bo + B_MISC] = row;
    c8[bo + B_MISC + 1] = (d.mirror ? FLAG_MIRROR : 0) | (d.outline ? FLAG_OUTLINE : 0) | (d.flash ? FLAG_FLASH : 0) | (d.windAmplitude !== 0 ? FLAG_WIND : 0);
    c8[bo + B_MISC + 2] = d.emissiveBoost * UNIT_TO_BYTE;
    c8[bo + B_MISC + 3] = d.fade * UNIT_TO_BYTE;
    this.layers[i] = layerIndex(d.layer);
    const depth = d.depth === d.depth ? d.depth : d.y;
    this.depths[i] = depth;
    if (depth < this.minDepth && depth !== Number.NEGATIVE_INFINITY) this.minDepth = depth;
    if (depth > this.maxDepth && depth !== Number.POSITIVE_INFINITY) this.maxDepth = depth;
    return i;
  }
}
