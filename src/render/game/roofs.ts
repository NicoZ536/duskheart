/**
 * Roofs of the build grid in the game view (MASTERPROMPT §16.4 "Innenraum", §6.2 "Kronen/Dächer blenden
 * mit Kreis-Dither um den Spieler aus", §16.1 "Ebene … Dach"; M4-27; the sprite contract of
 * assets-src/sprites/bau/_bau.ts).
 *
 * - **Row kind** (`roofColumn`): a roof is drawn per north–south column of roof tiles: the ridge lies on row
 *   `north + ⌊(n − 1) / 2⌋` of the column's run of n tiles, the rows above it show the back (`nord`), the rows below
 *   the front (`sued`). The run's southern end is the column's eave: the whole column sorts there, in front of every
 *   wall and piece of furniture it covers and behind everything standing south of the house.
 * - **Interior view** (`InteriorView`): when the player stands in an interior (a closed room at least 90 % under a
 *   roof, src/game/rooms), the roof above it fades out completely – every roof tile 8-connected to the roof over the
 *   room's tiles (one building under one roof shows all its rooms) – and its walls below the top row of that roof
 *   are cut to their 4-px stubs (`schnitt` frames), so the player looks into the house. Leaving the interior brings
 *   both back. The fade follows the presentation time (`FADE_SECONDS`); a frame whose clock stands still (a frozen
 *   screenshot, a frame without a tick) moves it by `1 / FADE_FRAMES`, so a frozen picture settles too.
 * - Standing on a tile that closes rooms (a doorway, a wall) keeps the last decision: walking through a door does
 *   not flash the roof.
 *
 * Reads the structure layers only (`StructureStore`); the room comes from the rooms system. No allocation per frame:
 * the roof component is rebuilt only when the room or the buildings change.
 */
import { BUILD_LAYER_INDEX, cellBlueprint } from '../../world/structures/cells';
import type { StructureStore } from '../../world/structures/store';
import type { Layer } from '../../world/model/coords';

const ROOF = BUILD_LAYER_INDEX.dach;

/** Row kinds of a roof sprite in frame order (`art · 16 + maske`, assets-src/sprites/bau/_bau.ts). */
export const ROOF_ROW = { sued: 0, first: 1, nord: 2, schnitt: 3 } as const;
/** Longest run of roof tiles a column walk follows [tiles] (a room has at most 400 tiles, §16.4). */
export const MAX_ROOF_RUN = 64;
/** Most roof tiles faded as one building [tiles]. */
export const MAX_ROOF_COMPONENT = 1024;
/** Duration of the roof fade [s] (M4-27: the roof lifts quickly, but visibly). */
export const FADE_SECONDS = 0.3;
/** Frames the fade takes while the presentation clock stands still. */
export const FADE_FRAMES = 18;
/** Span of the tile keys (larger than the largest world, 2048 tiles). */
const KEY_SPAN = 4096;
/** Eight neighbours. */
const NX: readonly number[] = [-1, 0, 1, -1, 1, -1, 0, 1];
const NY: readonly number[] = [-1, -1, -1, 0, 0, 1, 1, 1];

/** Key of tile (tx, ty) (non-negative world tiles). */
export function roofTileKey(tx: number, ty: number): number {
  return ty * KEY_SPAN + tx;
}

/** The north–south run of roof tiles through (tx, ty): its first and last row. */
export interface RoofRun {
  top: number;
  bottom: number;
}

/** Whether a roof (finished or planned) lies on tile (tx, ty). */
export function roofAt(store: StructureStore, layer: Layer, tx: number, ty: number): boolean {
  return store.cell(layer, ROOF, tx, ty) !== 0;
}

/**
 * The column of the roof tile (tx, ty) (fills `out`) and the row kind of the tile (`ROOF_ROW`): ridge on
 * `top + ⌊(bottom − top) / 2⌋`, back above, front below.
 */
export function roofColumn(store: StructureStore, layer: Layer, tx: number, ty: number, out: RoofRun): number {
  let top = ty;
  while (ty - top < MAX_ROOF_RUN && roofAt(store, layer, tx, top - 1)) top--;
  let bottom = ty;
  while (bottom - ty < MAX_ROOF_RUN && roofAt(store, layer, tx, bottom + 1)) bottom++;
  out.top = top;
  out.bottom = bottom;
  const ridge = top + Math.floor((bottom - top) / 2);
  return ty < ridge ? ROOF_ROW.nord : ty === ridge ? ROOF_ROW.first : ROOF_ROW.sued;
}

/** The room the view looks into: its identity and tiles (a `RoomRegion` of src/game/rooms/detect.ts). */
export interface InteriorRoom {
  readonly id: number;
  readonly interior: boolean;
  /** Tile keys of src/game/rooms/detect.ts (`roomTileKey`), decoded with `keyTx`/`keyTy`. */
  readonly tiles: readonly number[];
}

/** Decodes a room tile key into its tile (src/game/rooms/detect.ts `keyTx`/`keyTy`). */
export interface RoomKeyDecoder {
  tx(key: number): number;
  ty(key: number): number;
}

/** The player's interior: which roof fades, which walls are cut, and how far the fade has come (see module comment). */
export class InteriorView {
  /** 0 = the roof is drawn … 1 = it is gone (the cut walls show fully). */
  fade = 0;
  /** Whether the player's tile belongs to an interior (the fade's target). */
  inside = false;
  /** Bounding box of the faded roof [tiles]; empty (x1 < x0) without one. */
  x0 = 0;
  y0 = 0;
  x1 = -1;
  y1 = -1;
  private readonly roof = new Set<number>();
  private readonly queue: number[] = [];
  private roomId = Number.NaN;
  private revision = -1;
  private layer: Layer = 0;
  private lastTime = Number.NaN;
  /** The fade stands on this target (0 or 1; −1: on its way): a frame then forms no time step (§30). */
  private settledAt = 0;

  /** Number of roof tiles that fade with the interior. */
  get roofTiles(): number {
    return this.roof.size;
  }

  /**
   * One frame: `room` is the region of the player's tile (`null` outdoors, `undefined` on a tile that closes rooms –
   * the last decision stays), `revision` the store's revision, `time` the presentation time [s]; `instant` jumps to
   * the target (reduced motion).
   */
  update(store: StructureStore, layer: Layer, room: InteriorRoom | null | undefined, keys: RoomKeyDecoder, revision: number, time: number, instant = false): void {
    if (layer !== this.layer) {
      this.layer = layer;
      this.forget();
    }
    if (room !== undefined) {
      const interior = room !== null && room.interior;
      this.inside = interior;
      if (interior && (room.id !== this.roomId || revision !== this.revision)) this.collect(store, layer, room, keys);
      if (interior) this.roomId = room.id;
    }
    this.revision = revision;
    this.step(time, instant);
    // Faded out and outside: nothing is held any more (the next room starts afresh).
    if (!this.inside && this.roof.size > 0 && this.fade === 0) this.forget();
  }

  /** Whether the roof tile (tx, ty) belongs to the faded building. */
  fadesRoof(tx: number, ty: number): boolean {
    return this.roof.size > 0 && tx >= this.x0 && tx <= this.x1 && ty >= this.y0 && ty <= this.y1 && this.roof.has(roofTileKey(tx, ty));
  }

  /**
   * Whether a wall on (tx, ty) is cut while the roof is faded: below the top row of the faded roof, within its box
   * and one tile around it on the sides and the south (walls the roof does not cover).
   */
  cutsWall(tx: number, ty: number): boolean {
    return this.roof.size > 0 && tx >= this.x0 - 1 && tx <= this.x1 + 1 && ty > this.y0 && ty <= this.y1 + 1;
  }

  /** Forgets everything (another simulation, a loaded save). */
  reset(): void {
    this.forget();
    this.fade = 0;
    this.settledAt = 0;
    this.inside = false;
    this.lastTime = Number.NaN;
    this.revision = -1;
  }

  private forget(): void {
    this.roof.clear();
    this.roomId = Number.NaN;
    this.x0 = 0;
    this.y0 = 0;
    this.x1 = -1;
    this.y1 = -1;
  }

  /** The finished roof 8-connected to the roof over the room's tiles. */
  private collect(store: StructureStore, layer: Layer, room: InteriorRoom, keys: RoomKeyDecoder): void {
    this.forget();
    const q = this.queue;
    q.length = 0;
    const finished = (tx: number, ty: number): boolean => {
      const cell = store.cell(layer, ROOF, tx, ty);
      return cell !== 0 && !cellBlueprint(cell);
    };
    const add = (tx: number, ty: number): void => {
      const key = roofTileKey(tx, ty);
      if (this.roof.size >= MAX_ROOF_COMPONENT || this.roof.has(key) || !finished(tx, ty)) return;
      this.roof.add(key);
      q.push(tx, ty);
    };
    for (const key of room.tiles) add(keys.tx(key), keys.ty(key));
    for (let i = 0; i < q.length; i += 2) {
      const tx = q[i] as number;
      const ty = q[i + 1] as number;
      for (let k = 0; k < NX.length; k++) add(tx + (NX[k] as number), ty + (NY[k] as number));
    }
    if (this.roof.size === 0) return;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < q.length; i += 2) {
      const tx = q[i] as number;
      const ty = q[i + 1] as number;
      if (tx < x0) x0 = tx;
      if (tx > x1) x1 = tx;
      if (ty < y0) y0 = ty;
      if (ty > y1) y1 = ty;
    }
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.roomId = room.id;
  }

  /** Moves the fade towards its target (standing on it – almost every frame – it only keeps the clock). */
  private step(time: number, instant: boolean): void {
    const target = this.inside && this.roof.size > 0 ? 1 : 0;
    if (target === this.settledAt) {
      this.lastTime = time;
      return;
    }
    const dt = time - this.lastTime;
    this.lastTime = time;
    if (instant) {
      this.fade = target;
      this.settledAt = target;
      return;
    }
    const delta = Number.isFinite(dt) && dt > 0 ? dt / FADE_SECONDS : 1 / FADE_FRAMES;
    const fade = target > this.fade ? Math.min(target, this.fade + delta) : Math.max(target, this.fade - delta);
    this.fade = fade;
    this.settledAt = fade === target ? target : -1;
  }
}
