/**
 * Per-frame sprite list of a `RenderScene`: producers push sprites through one reusable
 * `SpriteDesc`; the records are written straight into a preallocated interleaved buffer in the
 * instance layout (`spriteLayout.ts`). Nothing is allocated per frame – the storage only grows (by
 * doubling) when a frame needs more sprites than ever before.
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

const U16_PER_INSTANCE = INSTANCE_STRIDE / Uint16Array.BYTES_PER_ELEMENT;
const F32_PER_INSTANCE = INSTANCE_WORDS;
const F32_POS = OFFSET.pos / Float32Array.BYTES_PER_ELEMENT;
const F32_PARAMS = OFFSET.params / Float32Array.BYTES_PER_ELEMENT;
const U16_RECT = OFFSET.rect / Uint16Array.BYTES_PER_ELEMENT;
const I16_ANCHOR = OFFSET.anchor / Int16Array.BYTES_PER_ELEMENT;

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

function unitByte(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * BYTE_MAX);
}

function byte(v: number): number {
  return Math.round(Math.min(BYTE_MAX, Math.max(0, v)));
}

export class SpriteList {
  private buffer: ArrayBuffer;
  private f32: Float32Array;
  private u16: Uint16Array;
  private i16: Int16Array;
  private u8: Uint8Array;
  private u32: Uint32Array;
  private layers: Uint8Array;
  private depths: Float64Array;
  private n = 0;
  private cap: number;

  constructor(initialCapacity = DEFAULT_SPRITE_CAPACITY) {
    this.cap = Math.max(1, Math.floor(initialCapacity));
    this.buffer = new ArrayBuffer(this.cap * INSTANCE_STRIDE);
    this.f32 = new Float32Array(this.buffer);
    this.u16 = new Uint16Array(this.buffer);
    this.i16 = new Int16Array(this.buffer);
    this.u8 = new Uint8Array(this.buffer);
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

  clear(): void {
    this.n = 0;
  }

  private grow(needed: number): void {
    const cap = grownCapacity(this.cap, needed);
    const buffer = new ArrayBuffer(cap * INSTANCE_STRIDE);
    new Uint8Array(buffer).set(this.u8.subarray(0, this.n * INSTANCE_STRIDE));
    const layers = new Uint8Array(cap);
    layers.set(this.layers.subarray(0, this.n));
    const depths = new Float64Array(cap);
    depths.set(this.depths.subarray(0, this.n));
    this.buffer = buffer;
    this.f32 = new Float32Array(buffer);
    this.u16 = new Uint16Array(buffer);
    this.i16 = new Int16Array(buffer);
    this.u8 = new Uint8Array(buffer);
    this.u32 = new Uint32Array(buffer);
    this.layers = layers;
    this.depths = depths;
    this.cap = cap;
  }

  /** Appends a sprite; returns its index (submission order = tie-break of the y-sort). */
  push(d: SpriteDesc): number {
    const f = d.frame;
    if (f === null) throw new Error('SpriteList.push: Sprite ohne Frame');
    if (d.paletteRow < 0 || d.paletteRow >= MAX_PALETTE_ROWS) throw new RangeError(`Palettenzeile ${d.paletteRow} außerhalb 0…${MAX_PALETTE_ROWS - 1}`);
    if (this.n === this.cap) this.grow(this.n + 1);
    const i = this.n++;
    const fo = i * F32_PER_INSTANCE;
    this.f32[fo + F32_POS] = d.x;
    this.f32[fo + F32_POS + 1] = d.y;
    this.f32[fo + F32_PARAMS] = d.heightBase;
    this.f32[fo + F32_PARAMS + 1] = d.windAmplitude;
    this.f32[fo + F32_PARAMS + 2] = d.windPhase;
    this.f32[fo + F32_PARAMS + 3] = d.rotation;
    const so = i * U16_PER_INSTANCE;
    this.u16[so + U16_RECT] = f.x;
    this.u16[so + U16_RECT + 1] = f.y;
    this.u16[so + U16_RECT + 2] = f.w;
    this.u16[so + U16_RECT + 3] = f.h;
    this.i16[so + I16_ANCHOR] = f.ax;
    this.i16[so + I16_ANCHOR + 1] = f.ay;
    const bo = i * INSTANCE_STRIDE;
    this.u8[bo + OFFSET.tint] = byte(d.tintR);
    this.u8[bo + OFFSET.tint + 1] = byte(d.tintG);
    this.u8[bo + OFFSET.tint + 2] = byte(d.tintB);
    this.u8[bo + OFFSET.tint + 3] = unitByte(d.tintStrength);
    this.u8[bo + OFFSET.misc] = d.paletteRow;
    this.u8[bo + OFFSET.misc + 1] =
      (d.mirror ? SPRITE_FLAG.mirror : 0) | (d.outline ? SPRITE_FLAG.outline : 0) | (d.flash ? SPRITE_FLAG.flash : 0) | (d.windAmplitude !== 0 ? SPRITE_FLAG.wind : 0);
    this.u8[bo + OFFSET.misc + 2] = unitByte(d.emissiveBoost);
    this.u8[bo + OFFSET.misc + 3] = unitByte(d.fade);
    this.layers[i] = LAYER[d.layer];
    this.depths[i] = Number.isNaN(d.depth) ? d.y : d.depth;
    return i;
  }
}
