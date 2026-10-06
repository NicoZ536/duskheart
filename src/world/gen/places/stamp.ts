/**
 * Stamping the place layouts into surface chunks (docs/SPIEL.md §18 "Der Chunk-Generator stempelt Boden und Objekte in die
 * Oberflächen-Chunks", ADR-0207; M7-07): after the ground, the deposits and the scatter of a chunk, every placement of
 * `GeneratedWorld.placeLayouts` that overlaps it writes its cells – the ground terrain where the legend names one, the
 * tile's object cleared and the layout's object set at its anchor – on the cells the stamping rule allows (`stampable`,
 * the same rule the placement used for its marks). `.` keeps the generated tile. The disc's `TILE_FLAG_PLACE` stays.
 *
 * Per world the placements are bucketed by chunk and the layouts' terrain and object ids resolved to runtime ids once; a
 * chunk then costs only its own cells (the generator's scratch rule, src/world/gen/chunk.ts).
 *
 * Before the scatter, `markBlocking` writes the footprints of the layouts' blocking objects into the window's occupancy: the
 * scatter keeps its open ring around them like around deposits, so no tree grows against a farmstead wall or a fence just
 * outside the disc (the scatter itself never enters the disc, `TILE_FLAG_PLACE`).
 */
import { CHUNK_SIZE } from '../../model/coords';
import type { ChunkData } from '../../model/chunk';
import type { WorldIdTables } from '../../model/runtimeIds';
import { OBJECTS_BY_ID } from '../resources';
import { RES_BRIDGE, RES_CAVE, RES_ROAD } from '../worldContext';
import { layoutCellAt, placeLayout, type CompiledLayout } from './layouts';
import type { PlacePlacement } from './types';

/** Reservations a place never touches: bridges and cave mouths. */
const FOREIGN_RESERVATIONS = RES_BRIDGE | RES_CAVE;
/** A tile the place leaves alone. */
export const STAMP_NONE = 0;
/** A road tile in a place (the roads lead into the beacon sites): it keeps its ground and stays free, but carries a mark. */
export const STAMP_MARK = 1;
/** A tile the place stamps: ground, object and mark. */
export const STAMP_ALL = 2;
/** "Keep the generated ground" in the resolved ground ids. */
const KEEP_GROUND = -1;

/**
 * The stamping rule (see module comment): dry land on the place's level, no ramp, stairs or ford flag, no lava, no bridge or
 * cave mouth reservation – `STAMP_ALL`; a road tile among them keeps its road (`STAMP_MARK`: marks only); else `STAMP_NONE`.
 */
export function stampRight(land: boolean, level: number, placeLevel: number, water: number, flags: number, reservations: number, lava: boolean): number {
  if (!land || level !== placeLevel || water !== 0 || flags !== 0 || lava || (reservations & FOREIGN_RESERVATIONS) !== 0) return STAMP_NONE;
  return (reservations & RES_ROAD) !== 0 ? STAMP_MARK : STAMP_ALL;
}

/** A layout with its terrain and object ids resolved to runtime ids. */
interface ResolvedLayout {
  readonly layout: CompiledLayout;
  /** Terrain runtime id per cell, `KEEP_GROUND` to keep. */
  readonly ground: Int16Array;
  /** Object runtime id per cell, 0 = clear. */
  readonly object: Uint16Array;
  /** Footprint width and height of a blocking object per cell (0: none or not blocking). */
  readonly blockW: Uint8Array;
  readonly blockH: Uint8Array;
}

function resolve(layout: CompiledLayout, tables: WorldIdTables): ResolvedLayout {
  const n = layout.w * layout.h;
  const ground = new Int16Array(n).fill(KEEP_GROUND);
  const object = new Uint16Array(n);
  const blockW = new Uint8Array(n);
  const blockH = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = layout.ground[i];
    if (g !== null && g !== undefined) ground[i] = tables.terrain.runtimeId(g);
    const o = layout.object[i];
    if (o === null || o === undefined) continue;
    object[i] = tables.objects.runtimeId(o);
    const def = OBJECTS_BY_ID.get(o);
    if (def !== undefined && def.blocking) {
      blockW[i] = def.footprint.w;
      blockH[i] = def.footprint.h;
    }
  }
  return { layout, ground, object, blockW, blockH };
}

/** What `stampChunk` asks of the generated tiles of the chunk (the chunk generator's window). */
export interface StampTiles {
  /** What a place on `level` may do to tile (tx, ty) (`stampRight` over the generated tile). */
  stampRight(tx: number, ty: number, level: number): number;
}

/** The stamping data of one world: placements by chunk, resolved layouts. */
export class PlaceStamper {
  private readonly byChunk = new Map<number, number[]>();
  private readonly resolved = new Map<string, ResolvedLayout>();

  constructor(
    private readonly placements: readonly PlacePlacement[],
    /** Slot level per placement (the level the cells are stamped on). */
    private readonly levels: readonly number[],
    tables: WorldIdTables,
    /** Chunks per world edge. */
    private readonly chunks: number,
  ) {
    placements.forEach((p, k) => {
      if (!this.resolved.has(p.layout)) this.resolved.set(p.layout, resolve(placeLayout(p.layout), tables));
      const cx0 = Math.max(0, Math.floor(p.x0 / CHUNK_SIZE));
      const cy0 = Math.max(0, Math.floor(p.y0 / CHUNK_SIZE));
      const cx1 = Math.min(chunks - 1, Math.floor((p.x0 + p.width - 1) / CHUNK_SIZE));
      const cy1 = Math.min(chunks - 1, Math.floor((p.y0 + p.height - 1) / CHUNK_SIZE));
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = cy * chunks + cx;
          const list = this.byChunk.get(key);
          if (list === undefined) this.byChunk.set(key, [k]);
          else list.push(k);
        }
      }
    });
  }

  /** Whether any placement overlaps chunk (cx, cy). */
  touches(cx: number, cy: number): boolean {
    return this.byChunk.has(cy * this.chunks + cx);
  }

  /**
   * Writes `value` into the occupancy `occ` of the window (north-west tile (wx0, wy0), `ww × wh` tiles) on every footprint
   * tile of a blocking layout object the chunk generation of chunk (cx, cy) would stamp – of the placements of the chunk and
   * its eight neighbours (the window reaches into them).
   */
  markBlocking(cx: number, cy: number, wx0: number, wy0: number, ww: number, wh: number, occ: Uint8Array, value: number, tiles: StampTiles): void {
    for (let ny = cy - 1; ny <= cy + 1; ny++) {
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        if (nx < 0 || ny < 0 || nx >= this.chunks || ny >= this.chunks) continue;
        const list = this.byChunk.get(ny * this.chunks + nx);
        if (list === undefined) continue;
        for (const k of list) {
          const p = this.placements[k] as PlacePlacement;
          const r = this.resolved.get(p.layout) as ResolvedLayout;
          const level = this.levels[k] as number;
          // Anchors inside the window (its margin is wider than the scatter's reach, src/world/gen/chunkWindow.ts).
          const ux0 = Math.max(p.x0, wx0);
          const uy0 = Math.max(p.y0, wy0);
          const ux1 = Math.min(p.x0 + p.width, wx0 + ww);
          const uy1 = Math.min(p.y0 + p.height, wy0 + wh);
          for (let ty = uy0; ty < uy1; ty++) {
            for (let tx = ux0; tx < ux1; tx++) {
              const cell = layoutCellAt(r.layout, p.rotation, p.mirror, tx - p.x0, ty - p.y0);
              const fw = r.blockW[cell] as number;
              if (fw === 0 || r.layout.keep[cell] === 1 || tiles.stampRight(tx, ty, level) !== STAMP_ALL) continue;
              const fh = r.blockH[cell] as number;
              for (let fy = ty - fh + 1; fy <= ty; fy++) {
                for (let fx = tx; fx < tx + fw; fx++) {
                  if (fx >= wx0 && fy >= wy0 && fx < wx0 + ww && fy < wy0 + wh) occ[(fy - wy0) * ww + (fx - wx0)] = value;
                }
              }
            }
          }
        }
      }
    }
  }

  /** Stamps every placement overlapping the surface chunk `out` (whose north-west tile is (x0, y0)). */
  stampChunk(out: ChunkData, x0: number, y0: number, tiles: StampTiles): void {
    const list = this.byChunk.get(out.cy * this.chunks + out.cx);
    if (list === undefined) return;
    for (const k of list) {
      const p = this.placements[k] as PlacePlacement;
      const r = this.resolved.get(p.layout) as ResolvedLayout;
      const level = this.levels[k] as number;
      const ux0 = Math.max(p.x0, x0);
      const uy0 = Math.max(p.y0, y0);
      const ux1 = Math.min(p.x0 + p.width, x0 + CHUNK_SIZE);
      const uy1 = Math.min(p.y0 + p.height, y0 + CHUNK_SIZE);
      // Ground and clearing first, objects second: an object's footprint cells clear nothing set after it.
      for (let pass = 0; pass < 2; pass++) {
        for (let ty = uy0; ty < uy1; ty++) {
          for (let tx = ux0; tx < ux1; tx++) {
            const cell = layoutCellAt(r.layout, p.rotation, p.mirror, tx - p.x0, ty - p.y0);
            if (r.layout.keep[cell] === 1 || tiles.stampRight(tx, ty, level) !== STAMP_ALL) continue;
            const i = (ty - y0) * CHUNK_SIZE + (tx - x0);
            if (pass === 0) {
              const g = r.ground[cell] as number;
              if (g !== KEEP_GROUND) out.ground[i] = g;
              out.object[i] = 0;
            } else {
              const o = r.object[cell] as number;
              if (o !== 0) out.object[i] = o;
            }
          }
        }
      }
    }
  }
}
