/**
 * Tile atlas lookup of the chunk tile map (M1-13): ground tile ids → 16×16 frames of an atlas sprite.
 * A tile with several frames picks its variant by a hash of the world tile position (§4.5 "3–4
 * Varianten je Grundtile"), optionally weighted and mirrored – deterministic, so a rebuilt mesh looks
 * exactly like the old one and neighbouring chunks agree along their border.
 */
import { atlasSprite, type AtlasManifest } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { MAX_TILE_ID, TILE_NONE, TILE_PX } from './chunk';

export interface TileDef {
  /** Ground tile id (1…65535) as stored in the chunks. */
  readonly id: number;
  /** Atlas sprite whose frames are the variants (each TILE_PX × TILE_PX). */
  readonly sprite: string;
  /** Variant frames of the sprite (default: every frame). */
  readonly frames?: readonly number[];
  /** Relative weights of the variants (default: equal). */
  readonly weights?: readonly number[];
  /** Variants may be mirrored horizontally (only for tiles without a left/right direction). */
  readonly mirror?: boolean;
}

/** Result of `TileSet.resolve` (reused by the mesh builder). */
export interface TileVariant {
  x: number;
  y: number;
  mirror: boolean;
}

interface ResolvedTile {
  readonly frames: readonly SpriteFrameRef[];
  /** Cumulative weights normalised to 1 (last entry is 1). */
  readonly cumulative: Float64Array;
  readonly mirror: boolean;
}

/** Position hash constants (integer mixing; scene layout only, not simulation randomness). */
const HASH_X = 0x27d4eb2d;
const HASH_Y = 0x165667b1;
const HASH_MIRROR = 0x2c1b3c6d;
const HASH_SHIFT = 15;
const UINT32 = 2 ** 32;
/** Low bit of a hash: the mirror coin. */
const MIRROR_BIT = 1;

/** Deterministic hash of a world tile position in [0, 1). */
export function tileHash01(wx: number, wy: number, salt = 0): number {
  let h = Math.imul(wx ^ HASH_X, HASH_Y) ^ Math.imul((wy + salt) ^ HASH_Y, HASH_X);
  h ^= h >>> HASH_SHIFT;
  h = Math.imul(h, HASH_X);
  h ^= h >>> HASH_SHIFT;
  return (h >>> 0) / UINT32;
}

export class TileSet {
  private readonly tiles = new Map<number, ResolvedTile>();

  constructor(
    readonly manifest: AtlasManifest,
    defs: readonly TileDef[],
  ) {
    for (const def of defs) {
      if (!Number.isInteger(def.id) || def.id <= TILE_NONE || def.id > MAX_TILE_ID) throw new RangeError(`Kachel-ID ${def.id} außerhalb 1…${MAX_TILE_ID}`);
      if (this.tiles.has(def.id)) throw new Error(`Kachel-ID ${def.id} doppelt vergeben`);
      const sprite = atlasSprite(manifest, def.sprite);
      const indices = def.frames ?? sprite.frames.map((_, i) => i);
      if (indices.length === 0) throw new Error(`Kachel ${def.id} (${def.sprite}): keine Varianten`);
      const frames = indices.map((i) => {
        const f = sprite.frames[i];
        if (f === undefined) throw new RangeError(`Kachel ${def.id}: ${def.sprite} hat keinen Frame ${i}`);
        if (f.w !== TILE_PX || f.h !== TILE_PX) throw new Error(`Kachel ${def.id}: ${def.sprite} Frame ${i} ist ${f.w}×${f.h} statt ${TILE_PX}×${TILE_PX}`);
        return f;
      });
      const weights = def.weights ?? frames.map(() => 1);
      if (weights.length !== frames.length || weights.some((w) => !(w > 0))) throw new Error(`Kachel ${def.id}: Gewichte passen nicht zu ${frames.length} Varianten`);
      const total = weights.reduce((a, b) => a + b, 0);
      const cumulative = new Float64Array(frames.length);
      let sum = 0;
      weights.forEach((w, i) => {
        sum += w;
        cumulative[i] = i === weights.length - 1 ? 1 : sum / total;
      });
      this.tiles.set(def.id, { frames, cumulative, mirror: def.mirror ?? false });
    }
  }

  has(id: number): boolean {
    return this.tiles.has(id);
  }

  /** Number of variants of tile `id` (0 if unknown). */
  variants(id: number): number {
    return this.tiles.get(id)?.frames.length ?? 0;
  }

  /**
   * Frame of tile `id` at world tile (wx, wy) into `out`; false for `TILE_NONE`. Throws for ids the
   * set does not know (a chunk referencing a missing tile is a content error, not an empty cell).
   */
  resolve(id: number, wx: number, wy: number, out: TileVariant): boolean {
    if (id === TILE_NONE) return false;
    const t = this.tiles.get(id);
    if (t === undefined) throw new Error(`Kachel-ID ${id} ist im Kachelsatz nicht definiert`);
    const h = tileHash01(wx, wy);
    let v = 0;
    while (v < t.cumulative.length - 1 && h >= (t.cumulative[v] ?? 1)) v++;
    const f = t.frames[v] ?? t.frames[0];
    if (f === undefined) return false;
    out.x = f.x;
    out.y = f.y;
    out.mirror = t.mirror && (Math.floor(tileHash01(wx, wy, HASH_MIRROR) * UINT32) & MIRROR_BIT) === MIRROR_BIT;
    return true;
  }
}
