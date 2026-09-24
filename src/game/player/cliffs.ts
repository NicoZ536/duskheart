/**
 * Cliffs and the free tile for a spawn (MASTERPROMPT §11.4, M3-08, M3-09), read from the collision grid.
 *
 * Height levels meet in two ways (src/world/collision/tiles.ts, ADR-0022): the south edge of a plateau
 * shows its cliff face on the `d` tiles below it (autotiler `wandAn`), every other edge is a plain step
 * between neighbouring tiles. Walking passes steps down on its own (the collision's `dropDown`, the
 * player "steps off" a ledge); a cliff face blocks, so jumping down a south edge is an action: the player
 * pushes south against the face from the plateau's edge tile (`findJumpDown`). Up there is no way but
 * ramps and stairs (the collision passes them) and placed ladders (`findLadderClimb`): a ladder stands
 * on the face tile directly above the foot of a south cliff, or on the higher tile of a step.
 */
import { BALANCE } from '../../content/balance';
import { BLOCK_DEEP_WATER, BLOCK_WALL, MAX_LEVEL, PLAYER_RULES, infoLevel, infoWallTop, type CollisionGrid } from '../../world/collision/tiles';
import type { Layer } from '../../world/model/coords';

/** Where placed ladders stand (the building system, M4; without it there are none). */
export interface ClimbAids {
  /** Whether a ladder stands on tile (tx, ty) of `layer` (against the cliff above or beside it). */
  ladderAt(layer: Layer, tx: number, ty: number): boolean;
}

/** Target of a jump or climb. */
export interface CliffMove {
  /** Tile the move ends on. */
  tx: number;
  ty: number;
  /** Height level at the end and levels crossed. */
  toLevel: number;
  levels: number;
  /** The move ends in deep water. */
  water: boolean;
}

/** A zeroed cliff move (allocate once, reuse). */
export function createCliffMove(): CliffMove {
  return { tx: 0, ty: 0, toLevel: 0, levels: 0, water: false };
}

/** Whether the player can stand on a tile (deep water counts: the player swims). */
function standable(info: number): boolean {
  return (info & PLAYER_RULES.blockMask) === 0;
}

/**
 * Jump down the cliff face south of tile (tx, ty) for a player standing on `level` (inside a query of
 * `grid`): the tiles below must be faces of exactly this plateau (wall top = `level`), the first tile
 * after them is the landing – standable and lower. Writes the landing into `out`.
 */
export function findJumpDown(grid: CollisionGrid, layer: Layer, tx: number, ty: number, level: number, out: CliffMove): boolean {
  let y = ty + 1;
  let faces = 0;
  while (faces <= MAX_LEVEL) {
    const info = grid.info(layer, tx, y);
    if ((info & BLOCK_WALL) === 0 || infoWallTop(info) !== level) break;
    faces++;
    y++;
  }
  if (faces === 0) return false;
  const landing = grid.info(layer, tx, y);
  const toLevel = infoLevel(landing);
  if (!standable(landing) || toLevel >= level) return false;
  out.tx = tx;
  out.ty = y;
  out.toLevel = toLevel;
  out.levels = level - toLevel;
  out.water = (landing & BLOCK_DEEP_WATER) !== 0;
  return true;
}

/**
 * Climb a placed ladder from tile (tx, ty) on `level`, pushing in the cardinal direction (dirX, dirY)
 * (inside a query of `grid`). North against a cliff face: the ladder stands on the face tile, the climb
 * ends on the plateau's edge tile above the faces. Against a higher step (any direction): the ladder
 * stands on the higher tile, the climb ends on it. Writes the target into `out`.
 */
export function findLadderClimb(grid: CollisionGrid, layer: Layer, tx: number, ty: number, dirX: number, dirY: number, level: number, aids: ClimbAids, out: CliffMove): boolean {
  const nx = tx + dirX;
  const ny = ty + dirY;
  if (!aids.ladderAt(layer, nx, ny)) return false;
  const info = grid.info(layer, nx, ny);
  if ((info & BLOCK_WALL) !== 0) {
    const top = infoWallTop(info);
    if (dirY >= 0 || dirX !== 0 || top <= level) return false;
    let y = ny;
    let faces = 0;
    while (faces <= MAX_LEVEL) {
      const face = grid.info(layer, nx, y);
      if ((face & BLOCK_WALL) === 0 || infoWallTop(face) !== top) break;
      faces++;
      y--;
    }
    const edge = grid.info(layer, nx, y);
    if (!standable(edge) || infoLevel(edge) !== top) return false;
    out.tx = nx;
    out.ty = y;
    out.toLevel = top;
    out.levels = top - level;
    out.water = (edge & BLOCK_DEEP_WATER) !== 0;
    return true;
  }
  const toLevel = infoLevel(info);
  if (!standable(info) || toLevel <= level) return false;
  out.tx = nx;
  out.ty = ny;
  out.toLevel = toLevel;
  out.levels = toLevel - level;
  out.water = (info & BLOCK_DEEP_WATER) !== 0;
  return true;
}

/** A tile found by `findFreeTile`. */
export interface FreeTile {
  tx: number;
  ty: number;
  level: number;
}

/**
 * The free tile nearest to (tx, ty) within `radius` tiles on `layer` (squared distance, ties by row and
 * column): preferably an open tile (it and its eight neighbours free and level, `openAt`), else any tile
 * the player can stand on dry. Starts a query of `grid`; the chunks of the square must be resident.
 */
export function findFreeTile(grid: CollisionGrid, layer: Layer, tx: number, ty: number, radius: number, out: FreeTile): boolean {
  grid.beginQuery();
  for (let pass = 0; pass < 2; pass++) {
    let best = -1;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (best >= 0 && d2 >= best) continue;
        const x = tx + dx;
        const y = ty + dy;
        const info = grid.info(layer, x, y);
        if ((info & (PLAYER_RULES.blockMask | BLOCK_DEEP_WATER)) !== 0) continue;
        if (pass === 0 && !grid.openAt(layer, x, y)) continue;
        best = d2;
        out.tx = x;
        out.ty = y;
        out.level = infoLevel(info);
      }
    }
    if (best >= 0) return true;
  }
  return false;
}

/** Search radius for the spawn [tiles] (`BALANCE.player.spawn`). */
export const SPAWN_SEARCH_RADIUS = BALANCE.player.spawn.searchRadiusTiles;
