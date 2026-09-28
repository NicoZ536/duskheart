/**
 * Occluders of a frame (MASTERPROMPT §6.1 pass 3 "Wände, Stämme, Klippen, Felsen, große Objekte"): footprints
 * on the ground – rectangles and ellipses in world pixels – with the height of their top and their class
 * (`OCCLUDER_CLASS`). The occluder pass draws them into its mask and floods the signed distance field from it.
 *
 * Three producers fill the list: the sprites of the frame (their `occluder` from the atlas manifest,
 * `SpriteOccluders`), the terrain (raised levels and cliff faces, solid rock: `terrainOccluders.ts`) and the build
 * grid (walls, closed doors and gates, fences, pillars: `buildingOccluders.ts`). Struct of arrays, preallocated,
 * growing by doubling – no allocation per frame.
 */
import type { AtlasManifest } from '../assets/atlas';
import type { SpriteList } from '../batch/spriteList';
import { INSTANCE_STRIDE, OFFSET, SPRITE_FLAG, LAYER } from '../batch/spriteLayout';
import { OCCLUDER_CLASS, type OccluderClass } from './params';

/** Shapes of a footprint. */
export const OCCLUDER_SHAPE = { rect: 0, ellipse: 1 } as const;
export type OccluderShape = (typeof OCCLUDER_SHAPE)[keyof typeof OCCLUDER_SHAPE];

/** Floats per occluder record in the instance stream of the mask (`occluder_mask.vert`). */
export const OCCLUDER_FLOATS = 8;
export const OCCLUDER_STRIDE = OCCLUDER_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/**
 * Float offsets: footprint (centre x, y, half extent x, y), top height, class, shape + 2 × prism (the footprint
 * itself casts the sun's shadow as an upright block: terrain; sprites cast theirs from their silhouette), and the
 * height of the ground it covers (terrain: the level a pixel there stands on; 0 for everything else).
 */
export const OCCLUDER_OFFSET = { box: 0, top: 4, cls: 5, shapePrism: 6, ground: 7 } as const;
/** Added to the shape code of a record whose footprint casts the sun's shadow as a block. */
export const PRISM_FLAG = 2;
export const INITIAL_OCCLUDERS = 256;

/** Occluders of one frame, packed as the instance records of the mask pass. */
export class OccluderList {
  private data = new Float32Array(INITIAL_OCCLUDERS * OCCLUDER_FLOATS);
  private n = 0;

  get count(): number {
    return this.n;
  }

  /** The packed records (`count · OCCLUDER_FLOATS` floats are valid). */
  get records(): Float32Array {
    return this.data;
  }

  clear(): void {
    this.n = 0;
  }

  private ensure(): void {
    if ((this.n + 1) * OCCLUDER_FLOATS <= this.data.length) return;
    const next = new Float32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;
  }

  /**
   * Adds a footprint centred at (cx, cy) with half extents (hx, hy) [world px], its top [px above level 0] and
   * class; `prism`: the footprint casts the sun's shadow as a block of its height (terrain); `ground`: height of the
   * ground a pixel standing there stands on (terrain levels) [px].
   */
  push(shape: OccluderShape, cx: number, cy: number, hx: number, hy: number, top: number, cls: OccluderClass, prism = false, ground = 0): void {
    if (!(hx > 0) || !(hy > 0)) return;
    this.ensure();
    const o = this.n * OCCLUDER_FLOATS;
    const d = this.data;
    d[o] = cx;
    d[o + 1] = cy;
    d[o + 2] = hx;
    d[o + 3] = hy;
    d[o + OCCLUDER_OFFSET.top] = top;
    d[o + OCCLUDER_OFFSET.cls] = cls;
    d[o + OCCLUDER_OFFSET.shapePrism] = shape + (prism ? PRISM_FLAG : 0);
    d[o + OCCLUDER_OFFSET.ground] = ground;
    this.n++;
  }

  /** An axis-aligned rectangle from (x0, y0) to (x1, y1) [world px]. */
  rect(x0: number, y0: number, x1: number, y1: number, top: number, cls: OccluderClass, prism = false, ground = 0): void {
    this.push(OCCLUDER_SHAPE.rect, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, top, cls, prism, ground);
  }

  /** Copies the records of `other` behind the own ones. */
  append(other: OccluderList): void {
    const m = other.count;
    if (m === 0) return;
    while ((this.n + m) * OCCLUDER_FLOATS > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data.set(other.records.subarray(0, m * OCCLUDER_FLOATS), this.n * OCCLUDER_FLOATS);
    this.n += m;
  }
}

/** Sprite layers whose sprites may occlude (ground decals and water never do; roofs and crowns cast only sun shadows). */
const OBJECTS_LAYER = LAYER.objects;
/** Bits of the frame key: atlas x and y are below 2^16. */
const KEY_SHIFT = 65536;
/** Words of a sprite record and offsets of its fields (spriteLayout.ts). */
const U16_PER_INSTANCE = INSTANCE_STRIDE / Uint16Array.BYTES_PER_ELEMENT;
const F32_PER_INSTANCE = INSTANCE_STRIDE / Float32Array.BYTES_PER_ELEMENT;
const U16_RECT = OFFSET.rect / Uint16Array.BYTES_PER_ELEMENT;
const F32_POS = OFFSET.pos / Float32Array.BYTES_PER_ELEMENT;
const F32_PARAMS = OFFSET.params / Float32Array.BYTES_PER_ELEMENT;
const B_MISC = OFFSET.misc;
const FLAG_MIRROR = SPRITE_FLAG.mirror;

/**
 * The occluder of every atlas frame (keyed by its rectangle), from the manifest: shape and extents relative to
 * the frame's anchor, the height of the sprite's top above its anchor, the class. Built once per atlas.
 */
export class SpriteOccluders {
  private manifest: AtlasManifest | null = null;
  private readonly index = new Map<number, number>();
  /** Per entry: shape, dx, dy (centre relative to the anchor), hx, hy, top above the anchor. */
  private table = new Float32Array(0);
  private u16: Uint16Array = new Uint16Array(0);
  private f32: Float32Array = new Float32Array(0);
  private u8: Uint8Array = new Uint8Array(0);
  private buffer: ArrayBufferLike | null = null;

  /** Entries of the table (frames with an occluder). */
  get size(): number {
    return this.index.size;
  }

  /** Reads the occluders of `manifest` (no-op for the same manifest). */
  bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.index.clear();
    const rows: number[] = [];
    for (const sprite of Object.values(manifest.sprites)) {
      const o = sprite.occluder;
      const first = sprite.frames[0];
      // Build parts (`sprite`) get their footprints from the build grid (buildingOccluders.ts).
      if (o === undefined || o.kind === 'none' || o.kind === 'sprite' || first === undefined) continue;
      const ax = first.ax;
      const ay = first.ay;
      const top = ay - (sprite.bounds?.y ?? 0);
      for (const f of sprite.frames) {
        const key = f.y * KEY_SHIFT + f.x;
        if (this.index.has(key)) continue;
        this.index.set(key, rows.length / 6);
        if (o.kind === 'rect') rows.push(OCCLUDER_SHAPE.rect, o.x + o.w / 2 - ax, o.y + o.h / 2 - ay, o.w / 2, o.h / 2, top);
        else rows.push(OCCLUDER_SHAPE.ellipse, o.x - ax, o.y - ay, o.rx, o.ry, top);
      }
    }
    this.table = new Float32Array(rows);
  }

  private views(list: SpriteList): void {
    const buf = list.words.buffer;
    if (buf === this.buffer) return;
    this.buffer = buf;
    this.u16 = new Uint16Array(buf);
    this.f32 = new Float32Array(buf);
    this.u8 = new Uint8Array(buf);
  }

  /** Adds the occluders of the frame's sprites (objects layer) to `out`; returns how many. */
  collect(list: SpriteList, out: OccluderList): number {
    if (this.index.size === 0 || list.count === 0) return 0;
    this.views(list);
    const layers = list.layerKeys;
    const u16 = this.u16;
    const f32 = this.f32;
    const u8 = this.u8;
    const t = this.table;
    let added = 0;
    for (let i = 0; i < list.count; i++) {
      if (layers[i] !== OBJECTS_LAYER) continue;
      const so = i * U16_PER_INSTANCE;
      const key = (u16[so + U16_RECT + 1] ?? 0) * KEY_SHIFT + (u16[so + U16_RECT] ?? 0);
      const e = this.index.get(key);
      if (e === undefined) continue;
      const fo = i * F32_PER_INSTANCE;
      // The table is relative to the sprite's anchor (every frame of a sprite shares it); mirroring reflects about it.
      const mirror = ((u8[i * INSTANCE_STRIDE + B_MISC + 1] ?? 0) & FLAG_MIRROR) !== 0;
      const x = Math.floor((f32[fo + F32_POS] ?? 0) + 0.5);
      const y = Math.floor((f32[fo + F32_POS + 1] ?? 0) + 0.5);
      const base = f32[fo + F32_PARAMS] ?? 0;
      const r = e * 6;
      const dx = t[r + 1] ?? 0;
      out.push((t[r] ?? 0) as OccluderShape, x + (mirror ? -dx : dx), y + (t[r + 2] ?? 0), t[r + 3] ?? 0, t[r + 4] ?? 0, base + (t[r + 5] ?? 0), OCCLUDER_CLASS.decor);
      added++;
    }
    return added;
  }
}
