/**
 * Ground chunks as the tile map sees them (docs/ARCHITEKTUR.md "Welt": tiles 16×16 px, chunks 32×32
 * tiles). The world will expose its chunk arrays through `GroundChunk`; `TileChunk` is the plain
 * implementation used by the render scenes and tests. Every change bumps `version`, which is all the
 * tile map compares to decide whether a chunk's static mesh must be rebuilt.
 */

/** Tile edge in world px (§4.4). */
export const TILE_PX = 16;
/** Tiles along one chunk edge. */
export const CHUNK_TILES = 32;
/** Chunk edge in world px. */
export const CHUNK_PX = TILE_PX * CHUNK_TILES;
export const TILES_PER_CHUNK = CHUNK_TILES * CHUNK_TILES;
/** Ground tile id meaning "nothing here" (no quad is emitted). */
export const TILE_NONE = 0;
/** Largest ground tile id (ids are stored as 16-bit values). */
export const MAX_TILE_ID = 0xffff;
/** Palette rows addressable per tile (8-bit field of the mesh). */
export const MAX_TILE_PALETTE_ROW = 0xff;

/** Read access to one chunk's ground layer. */
export interface GroundChunk {
  /** Chunk coordinates (chunk (0, 0) starts at world px (0, 0)). */
  readonly cx: number;
  readonly cy: number;
  /** Change counter of the ground layer; equal versions mean an unchanged mesh. */
  readonly version: number;
  /** Ground tile id at `index` = ty · CHUNK_TILES + tx (`TILE_NONE` = empty). */
  groundAt(index: number): number;
  /** Palette row of the tile at `index` (season, biome tint; 0 = master palette). */
  paletteRowAt(index: number): number;
}

/** Index of tile (tx, ty) inside its chunk. */
export function tileIndex(tx: number, ty: number): number {
  return ty * CHUNK_TILES + tx;
}

/** Chunk coordinate containing world px `v`. */
export function chunkCoord(v: number): number {
  return Math.floor(v / CHUNK_PX);
}

function checkLocal(tx: number, ty: number): void {
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx >= CHUNK_TILES || ty >= CHUNK_TILES) {
    throw new RangeError(`Kachel (${tx}, ${ty}) liegt außerhalb des Chunks (0…${CHUNK_TILES - 1})`);
  }
}

/** A chunk's ground layer in typed arrays. */
export class TileChunk implements GroundChunk {
  readonly ground = new Uint16Array(TILES_PER_CHUNK);
  readonly rows = new Uint8Array(TILES_PER_CHUNK);
  private changes = 0;

  constructor(
    readonly cx: number,
    readonly cy: number,
  ) {
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) throw new RangeError(`Chunk-Koordinaten müssen ganzzahlig sein: (${cx}, ${cy})`);
  }

  get version(): number {
    return this.changes;
  }

  groundAt(index: number): number {
    return this.ground[index] ?? TILE_NONE;
  }

  paletteRowAt(index: number): number {
    return this.rows[index] ?? 0;
  }

  /** Sets tile (tx, ty); returns false (and keeps the version) when nothing changes. */
  set(tx: number, ty: number, id: number, paletteRow = 0): boolean {
    checkLocal(tx, ty);
    if (!Number.isInteger(id) || id < TILE_NONE || id > MAX_TILE_ID) throw new RangeError(`Kachel-ID ${id} außerhalb ${TILE_NONE}…${MAX_TILE_ID}`);
    if (!Number.isInteger(paletteRow) || paletteRow < 0 || paletteRow > MAX_TILE_PALETTE_ROW) throw new RangeError(`Palettenzeile ${paletteRow} außerhalb 0…${MAX_TILE_PALETTE_ROW}`);
    const i = tileIndex(tx, ty);
    if (this.ground[i] === id && this.rows[i] === paletteRow) return false;
    this.ground[i] = id;
    this.rows[i] = paletteRow;
    this.changes++;
    return true;
  }

  /** Fills every tile from `tileAt(worldTileX, worldTileY)` (one version step for the whole chunk). */
  fill(tileAt: (worldTileX: number, worldTileY: number) => number, paletteRow = 0): void {
    if (!Number.isInteger(paletteRow) || paletteRow < 0 || paletteRow > MAX_TILE_PALETTE_ROW) throw new RangeError(`Palettenzeile ${paletteRow} außerhalb 0…${MAX_TILE_PALETTE_ROW}`);
    const x0 = this.cx * CHUNK_TILES;
    const y0 = this.cy * CHUNK_TILES;
    let changed = false;
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const id = tileAt(x0 + tx, y0 + ty);
        const i = tileIndex(tx, ty);
        if (this.ground[i] === id && this.rows[i] === paletteRow) continue;
        if (!Number.isInteger(id) || id < TILE_NONE || id > MAX_TILE_ID) throw new RangeError(`Kachel-ID ${id} außerhalb ${TILE_NONE}…${MAX_TILE_ID}`);
        this.ground[i] = id;
        this.rows[i] = paletteRow;
        changed = true;
      }
    }
    if (changed) this.changes++;
  }
}
