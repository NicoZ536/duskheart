/**
 * World objects as y-sorted sprites (M2-28, MASTERPROMPT §6.1 pass 2 "y-sortierte Objekte"): every
 * tile's `object` becomes a sprite of the same id (docs/WORLD.md §7), standing centred on its
 * footprint, with the frame of the season (trees), of the harvested state (`abgeerntet`) or of a
 * per-tile variant (scatter), the palette row of its rule (season rows, or the tile's biome row for
 * shared scatter, ore and crystals), wind sway where its pixels are flagged for wind and its anchor
 * raised by the level it stands on.
 *
 * Each chunk's object list is resolved once into typed arrays and rebuilt only when the chunk's
 * content signature or the season changes; a frame only walks the lists of the chunks around the
 * view and pushes the sprites inside it – no allocation per frame. Crowns in front of the focus
 * (the player) that cover it get the canopy fade: their canopy pixels dither out in the fade circle.
 */
import { NO_REGROW_TICK, type ChunkData } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import type { RenderScene } from '../scene';
import { CHUNK_PX, CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
import { tileHash01 } from '../tilemap/tileSet';
import type { ChunkSignatures } from './signature';
import type { ObjectDef, WorldRenderTables } from './tables';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { SpriteFrameRef } from '../batch/spriteList';

/** Anchor row of an object in its tile [px from the tile's top]: the foot stands on the tile's last pixel row. */
const ANCHOR_ROW = TILE_PX - 1;
/** Position jitter of objects inside their tile [px, ±x / up], so forests and scatter do not line up on the grid. */
export const OBJECT_JITTER = {
  blockingX: 3,
  blockingY: 2,
  looseX: 5,
  looseY: 5,
} as const;
/** Hash salts of the per-tile choices (independent of each other and of the terrain variants). */
const SALT = { x: 0x68e31da4, y: 0x1b56c4e9, variant: 0x7f4a7c15, phase: 0x3c6ef372, mirror: 0x5851f42d } as const;
const FULL_TURN = Math.PI * 2;
const UINT32 = 2 ** 32;
/** Initial capacity of a chunk's object list (grows by doubling). */
const INITIAL_OBJECTS = 256;

/** The view rectangle objects are pushed for [world px] and the canopy fade circle around the focus. */
export interface ObjectView {
  readonly layer: Layer;
  readonly chunks: { get(layer: Layer, cx: number, cy: number): ChunkData | undefined };
  readonly signatures: ChunkSignatures;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Canopy fade: focus (world px) and radius (0 = off). */
  fadeX: number;
  fadeY: number;
  fadeRadius: number;
}

class ChunkObjects {
  count = 0;
  signature = -1;
  season = -1;
  x: Float32Array = new Float32Array(INITIAL_OBJECTS);
  y: Float32Array = new Float32Array(INITIAL_OBJECTS);
  base: Float32Array = new Float32Array(INITIAL_OBJECTS);
  phase: Float32Array = new Float32Array(INITIAL_OBJECTS);
  def: Uint16Array = new Uint16Array(INITIAL_OBJECTS);
  frame: Uint16Array = new Uint16Array(INITIAL_OBJECTS);
  row: Uint8Array = new Uint8Array(INITIAL_OBJECTS);
  mirror: Uint8Array = new Uint8Array(INITIAL_OBJECTS);

  reserve(n: number): void {
    if (n <= this.x.length) return;
    let cap = this.x.length;
    while (cap < n) cap *= 2;
    const f = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.x = f(this.x);
    this.y = f(this.y);
    this.base = f(this.base);
    this.phase = f(this.phase);
    const u16 = (a: Uint16Array): Uint16Array => {
      const b = new Uint16Array(cap);
      b.set(a);
      return b;
    };
    this.def = u16(this.def);
    this.frame = u16(this.frame);
    const u8 = (a: Uint8Array): Uint8Array => {
      const b = new Uint8Array(cap);
      b.set(a);
      return b;
    };
    this.row = u8(this.row);
    this.mirror = u8(this.mirror);
  }
}

/** Counters of the object layer (`worldInfo`, tests). */
export interface ObjectStats {
  /** Sprites pushed in the last frame. */
  pushed: number;
  /** Object lists (re)built since the start. */
  builds: number;
  /** Objects within the pushed rectangle whose crown fades around the focus. */
  faded: number;
}

export class WorldObjectLayer {
  readonly stats: ObjectStats = { pushed: 0, builds: 0, faded: 0 };
  private readonly lists = new WeakMap<ChunkData, ChunkObjects>();
  /** Season index (`SEASON_IDS`) the lists show. */
  season = 1;

  constructor(readonly tables: WorldRenderTables) {}

  /** The object list of `chunk`, rebuilt if its content or the season changed. */
  listOf(chunk: ChunkData, signatures: ChunkSignatures): ChunkObjects {
    let list = this.lists.get(chunk);
    if (list === undefined) {
      list = new ChunkObjects();
      this.lists.set(chunk, list);
    }
    const sig = signatures.of(chunk);
    if (list.signature !== sig || list.season !== this.season) {
      this.build(chunk, list);
      list.signature = sig;
      list.season = this.season;
    }
    return list;
  }

  private build(chunk: ChunkData, out: ChunkObjects): void {
    const t = this.tables;
    let n = 0;
    for (let i = 0; i < chunk.object.length; i++) if ((chunk.object[i] as number) !== 0) n++;
    out.reserve(n);
    n = 0;
    const x0 = chunk.cx * CHUNK_TILES;
    const y0 = chunk.cy * CHUNK_TILES;
    for (let i = 0; i < chunk.object.length; i++) {
      const id = chunk.object[i] as number;
      if (id === 0) continue;
      const def = t.objects[id];
      if (def === undefined || def === null) throw new Error(`Welt-Darstellung: Laufzeit-Objekt ${id} in Chunk ${chunk.key} ist unbekannt`);
      const tx = x0 + (i % CHUNK_TILES);
      const ty = y0 + Math.floor(i / CHUNK_TILES);
      const jx = def.blocking ? OBJECT_JITTER.blockingX : OBJECT_JITTER.looseX;
      const jy = def.blocking ? OBJECT_JITTER.blockingY : OBJECT_JITTER.looseY;
      out.x[n] = tx * TILE_PX + (def.footprintW * TILE_PX) / 2 + Math.round((tileHash01(tx, ty, SALT.x) * 2 - 1) * jx);
      out.y[n] = ty * TILE_PX + ANCHOR_ROW - Math.round(tileHash01(tx, ty, SALT.y) * jy);
      out.base[n] = (chunk.layer === 0 ? (chunk.height[i] as number) : 0) * WAND_PX_JE_STUFE;
      out.phase[n] = tileHash01(tx, ty, SALT.phase) * FULL_TURN;
      out.def[n] = id;
      out.frame[n] = this.frameOf(def, chunk, i, tx, ty);
      out.row[n] = t.objectRow(def, this.season, chunk.biome[i] as number);
      out.mirror[n] = def.mirror && (Math.floor(tileHash01(tx, ty, SALT.mirror) * UINT32) & 1) === 1 ? 1 : 0;
      n++;
    }
    out.count = n;
    this.stats.builds++;
  }

  private frameOf(def: ObjectDef, chunk: ChunkData, i: number, tx: number, ty: number): number {
    const state = chunk.objectState.get(i);
    if (state !== undefined && state.regrowAtTick !== NO_REGROW_TICK && def.harvestedFrame >= 0) return def.harvestedFrame;
    if (def.variants > 1) return Math.min(def.variants - 1, Math.floor(tileHash01(tx, ty, SALT.variant) * def.variants));
    return def.seasonFrames[this.season] ?? 0;
  }

  /** Pushes the objects inside `view` (plus their sprite extents) into `scene.sprites`; returns the count. */
  emit(scene: RenderScene, view: ObjectView): number {
    const t = this.tables;
    const s = this.stats;
    s.pushed = 0;
    s.faded = 0;
    const d = scene.sprite;
    const cx0 = Math.floor(view.left / CHUNK_PX);
    const cx1 = Math.floor(view.right / CHUNK_PX);
    const cy0 = Math.floor(view.top / CHUNK_PX);
    const cy1 = Math.floor(view.bottom / CHUNK_PX);
    const fadeR = view.fadeRadius;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = view.chunks.get(view.layer, cx, cy);
        if (chunk === undefined) continue;
        const list = this.listOf(chunk, view.signatures);
        for (let k = 0; k < list.count; k++) {
          const def = t.objects[list.def[k] as number];
          if (def === undefined || def === null) continue;
          const x = list.x[k] as number;
          const y = list.y[k] as number;
          if (x + def.halfWidth < view.left || x - def.halfWidth > view.right || y < view.top || y - def.top > view.bottom) continue;
          const frame = def.sprite.frames[list.frame[k] as number] as SpriteFrameRef;
          d.reset();
          d.frame = frame;
          d.x = x;
          d.y = y;
          d.layer = def.layer;
          d.paletteRow = list.row[k] as number;
          d.mirror = list.mirror[k] === 1;
          d.heightBase = list.base[k] as number;
          d.windAmplitude = def.wind;
          d.windPhase = list.phase[k] as number;
          if (def.canopy && fadeR > 0 && y > view.fadeY && Math.abs(x - view.fadeX) < def.halfWidth + fadeR && y - def.top < view.fadeY + fadeR) {
            d.canopyFade = true;
            s.faded++;
          }
          scene.sprites.push(d);
          s.pushed++;
        }
      }
    }
    return s.pushed;
  }
}
