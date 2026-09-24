/**
 * Moving circles and boxes through the tile grid (MASTERPROMPT §3.3, M2-23).
 *
 * Both movers split a displacement into sub-steps shorter than half their radius (half extent), so
 * even a mover crossing a whole tile per tick (60 tiles/s) cannot pass through a one-tile wall: after
 * every sub-step the centre is still outside every blocked tile and is pushed back out.
 * - Circles resolve overlaps against the closest point of each blocked tile (deepest first, a few
 *   iterations for concave corners) and slide: the rest of the displacement loses its component into
 *   the contact normal. Convex corners are round for a circle, so it glides around them; two blocked
 *   tiles touching diagonally leave no gap. A circle whose tile is open (`CollisionGrid.openAt`)
 *   skips the tile tests.
 * - Boxes move one axis at a time and stop each axis at the first blocked tile face (exact for boxes
 *   against the grid).
 * Blocking is decided by `blocksMover` relative to the tile under the centre, which is re-read after
 * every sub-step (ramps, stairs and jumping down change a walker's level on the way); flyers keep the
 * level of the tile they start on.
 *
 * Positions are world pixels (tile = 16 px). `moveCircles` moves a whole batch of circles stored as
 * typed-array columns (the ECS layout); `moveCircle` and `moveBox` move one mover into a
 * caller-owned `MoveResult`. Internally the state lives in a scratch `Float64Array` and helpers take
 * only integers and objects: V8 boxes every fractional number passed to a function it does not
 * inline, so a per-mover call chain with coordinates as arguments would allocate on every tick.
 * Distances need one square root per contact (IEEE 754 exact).
 */
import { TILE_PX as TILE_PX_IMPORT, type Layer } from '../model/coords';
import { INFO_OPEN as INFO_OPEN_IMPORT, blocksMover as blocksMoverImport, infoConnector as infoConnectorImport, infoLevel as infoLevelImport, type CollisionGrid, type MoverRules } from './tiles';

// Module-local aliases: bundler module wrappers (tsx, vite-node) turn every access to an imported
// binding into a getter call, which costs more than the collision test itself in the hot loop.
const TILE_PX = TILE_PX_IMPORT;
/** 1 / tile size (a power of two, so multiplying is exact). */
const INV_TILE = 1 / TILE_PX;
const blocksMover = blocksMoverImport;
const infoConnector = infoConnectorImport;
const infoLevel = infoLevelImport;
const INFO_OPEN = INFO_OPEN_IMPORT;

/** Longest sub-step relative to the radius or the smaller half extent. */
const SUBSTEP_FRACTION = 0.5;
/** Overlap resolution passes per sub-step (a concave corner needs two). */
const RESOLVE_ITERATIONS = 4;
/** Clearance kept after a push-out [px] (1/1024 px, exact in binary), so a resting contact does not count as overlap again. */
export const CONTACT_SKIN_PX = 0.000_976_562_5;
/** Largest supported radius or half extent [px] (one tile; bigger bodies need a coarser grid). */
export const MAX_MOVER_EXTENT_PX = TILE_PX;
/** Most sub-steps of a single move (a displacement of 64 tiles for the smallest mover). */
const MAX_SUBSTEPS = 4096;

/** Packed move result (`moveCircles` output): bit 0 = hit, bits 1–3 = final level, bits 4+ = levels dropped. */
export const MOVE_HIT = 0b1;
const LEVEL_SHIFT = 1;
const LEVEL_BITS = 0b111;
const DROP_SHIFT = 4;

/** Final level encoded in a packed move result. */
export function moveResultLevel(packed: number): number {
  return (packed >> LEVEL_SHIFT) & LEVEL_BITS;
}

/** Levels dropped (jumps without ramp or stairs) encoded in a packed move result. */
export function moveResultDropped(packed: number): number {
  return packed >> DROP_SHIFT;
}

/** Result of a single move. */
export interface MoveResult {
  /** Final centre [px]. */
  x: number;
  y: number;
  /** Whether a blocking tile stopped or deflected the mover. */
  hit: boolean;
  /** Normal of the last contact (unit vector pointing away from the obstacle), 0 without contact. */
  normalX: number;
  normalY: number;
  /** Height level of the tile under the final centre (flyers: their flight level). */
  level: number;
  /** Levels descended without ramp or stairs (jumps; M3-09 fall damage). */
  dropped: number;
}

/** A zeroed move result (allocate once, reuse). */
export function createMoveResult(): MoveResult {
  return { x: 0, y: 0, hit: false, normalX: 0, normalY: 0, level: 0, dropped: 0 };
}

/** A batch of circles as typed-array columns (e.g. ECS columns); positions are updated in place. */
export interface CircleBatch {
  /** Number of movers (indices 0 … count − 1). */
  readonly count: number;
  /** Centres [px] (read and written). */
  readonly x: Float32Array | Float64Array;
  readonly y: Float32Array | Float64Array;
  /** Displacement of this move [px]. */
  readonly dx: Float32Array | Float64Array;
  readonly dy: Float32Array | Float64Array;
  /** Radius per mover [px]. */
  readonly r: Float32Array | Float64Array;
  /** Packed result per mover (`MOVE_HIT`, `moveResultLevel`, `moveResultDropped`). */
  readonly result: Int32Array;
  /** Contact normal per mover (0 without contact); optional. */
  readonly normalX?: Float32Array | Float64Array;
  readonly normalY?: Float32Array | Float64Array;
}

// ---------------------------------------------------------------------------------------------
// Scratch state (indices into `st`)
// ---------------------------------------------------------------------------------------------

const CX = 0;
const CY = 1;
const R = 2;
const SX = 3;
const SY = 4;
const NX = 5;
const NY = 6;
const DEPTH = 7;
const CNX = 8;
const CNY = 9;
const HW = 10;
const HH = 11;
const STOP = 12;
const STATE_SIZE = 13;
const st = new Float64Array(STATE_SIZE);

function checkExtent(what: string, v: number): void {
  if (!(v > 0 && v <= MAX_MOVER_EXTENT_PX)) throw new RangeError(`${what} must be in (0, ${MAX_MOVER_EXTENT_PX}] px, got ${String(v)}`);
}

/** Number of sub-steps for the displacement in `st[SX]`, `st[SY]` with the longest step in `st[DEPTH]`. */
function substeps(): number {
  const len = Math.max(Math.abs(st[SX] as number), Math.abs(st[SY] as number));
  if (!Number.isFinite(len)) throw new RangeError('move: displacement must be finite');
  const n = Math.ceil(len / (st[DEPTH] as number));
  if (n > MAX_SUBSTEPS) throw new RangeError(`move: displacement ${len} px needs more than ${MAX_SUBSTEPS} sub-steps`);
  return n > 1 ? n : 1;
}

/** Counts a level change between two reference tiles as a drop unless it runs along a ramp or stairs. */
function droppedLevels(before: number, after: number): number {
  const d = infoLevel(before) - infoLevel(after);
  if (d <= 0) return 0;
  return d === 1 && infoConnector(before) && infoConnector(after) ? 0 : d;
}

/**
 * Finds the deepest overlap of the circle (`st[CX]`, `st[CY]`, `st[R]`) with a blocked tile into
 * `st[DEPTH]`, `st[CNX]`, `st[CNY]`; false if none. The reference tile's info is passed in.
 */
function deepestCircleContact(grid: CollisionGrid, layer: Layer, rules: MoverRules, ref: number, refX: number, refY: number, level: number): boolean {
  const cx = st[CX] as number;
  const cy = st[CY] as number;
  const r = st[R] as number;
  const tx0 = Math.floor((cx - r) * INV_TILE);
  const ty0 = Math.floor((cy - r) * INV_TILE);
  const tx1 = Math.floor((cx + r) * INV_TILE);
  const ty1 = Math.floor((cy + r) * INV_TILE);
  const r2 = r * r;
  let found = false;
  let best = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const bx0 = tx * TILE_PX;
      const by0 = ty * TILE_PX;
      const bx1 = bx0 + TILE_PX;
      const by1 = by0 + TILE_PX;
      const qx = cx < bx0 ? bx0 : cx > bx1 ? bx1 : cx;
      const qy = cy < by0 ? by0 : cy > by1 ? by1 : cy;
      const ex = cx - qx;
      const ey = cy - qy;
      const d2 = ex * ex + ey * ey;
      if (d2 >= r2) continue;
      if (!blocksMover(rules, ref, tx === refX && ty === refY ? ref : grid.info(layer, tx, ty), level)) continue;
      let depth: number;
      let nx: number;
      let ny: number;
      if (d2 > 0) {
        const d = Math.sqrt(d2);
        depth = r - d;
        nx = ex / d;
        ny = ey / d;
      } else {
        // Centre inside or on the tile: leave through the nearest face.
        const left = cx - bx0;
        const right = bx1 - cx;
        const top = cy - by0;
        const bottom = by1 - cy;
        const m = Math.min(left, right, top, bottom);
        depth = m + r;
        nx = m === left ? -1 : m === right ? 1 : 0;
        ny = nx !== 0 ? 0 : m === top ? -1 : 1;
      }
      if (depth > best) {
        best = depth;
        st[DEPTH] = depth;
        st[CNX] = nx;
        st[CNY] = ny;
        found = true;
      }
    }
  }
  return found;
}

/**
 * Moves the circle in the scratch state (`st[CX]`, `st[CY]`, `st[R]`, displacement in `st[SX]`,
 * `st[SY]`); writes the contact normal to `st[NX]`, `st[NY]` and returns the packed result.
 * Works on local copies; `st` carries the circle only into `deepestCircleContact`.
 */
function moveScratchCircle(grid: CollisionGrid, layer: Layer, rules: MoverRules): number {
  const r = st[R] as number;
  if (!(r > 0 && r <= MAX_MOVER_EXTENT_PX)) checkExtent('moveCircle: radius', r);
  let sx = st[SX] as number;
  let sy = st[SY] as number;
  const len = Math.max(Math.abs(sx), Math.abs(sy));
  let n = 1;
  if (len > r * SUBSTEP_FRACTION) {
    st[DEPTH] = r * SUBSTEP_FRACTION;
    n = substeps();
    sx /= n;
    sy /= n;
  } else if (len !== len) throw new RangeError('move: displacement must be finite');
  const walker = rules.mode === 'walk';
  let cx = st[CX] as number;
  let cy = st[CY] as number;
  let refX = Math.floor(cx * INV_TILE);
  let refY = Math.floor(cy * INV_TILE);
  let ref = grid.standInfo(layer, refX, refY);
  const level = infoLevel(ref);
  // Fast path: nothing within one tile of an open tile's centre can block (radius ≤ one tile).
  let open = (ref & INFO_OPEN) !== 0;
  let dropped = 0;
  let hit = 0;
  let nxLast = 0;
  let nyLast = 0;
  for (let s = 0; s < n; s++) {
    cx += sx;
    cy += sy;
    for (let it = 0; it < RESOLVE_ITERATIONS; it++) {
      const tx = Math.floor(cx * INV_TILE);
      const ty = Math.floor(cy * INV_TILE);
      if (tx !== refX || ty !== refY) {
        // The centre entered another tile: it becomes the reference (ramps, stairs, jumps).
        const now = grid.standInfo(layer, tx, ty);
        if (walker) dropped += droppedLevels(ref, now);
        ref = now;
        refX = tx;
        refY = ty;
        open = (now & INFO_OPEN) !== 0 && (walker || infoLevel(now) <= level);
      }
      if (open) break;
      st[CX] = cx;
      st[CY] = cy;
      if (!deepestCircleContact(grid, layer, rules, ref, refX, refY, level)) break;
      const nx = st[CNX] as number;
      const ny = st[CNY] as number;
      const push = (st[DEPTH] as number) + CONTACT_SKIN_PX;
      cx += nx * push;
      cy += ny * push;
      hit = MOVE_HIT;
      nxLast = nx;
      nyLast = ny;
      // Slide: the remaining sub-steps lose their component into the obstacle.
      const into = sx * nx + sy * ny;
      if (into < 0) {
        sx -= into * nx;
        sy -= into * ny;
      }
    }
  }
  const tx = Math.floor(cx * INV_TILE);
  const ty = Math.floor(cy * INV_TILE);
  if (tx !== refX || ty !== refY) {
    const now = grid.info(layer, tx, ty);
    if (walker) dropped += droppedLevels(ref, now);
    ref = now;
  }
  st[CX] = cx;
  st[CY] = cy;
  st[NX] = nxLast;
  st[NY] = nyLast;
  return hit | ((walker ? infoLevel(ref) : level) << LEVEL_SHIFT) | (dropped << DROP_SHIFT);
}

/**
 * Moves a circle of radius `r` [px] centred at (x, y) by (dx, dy) [px] on `layer` and writes the
 * resolved position into `out`. Flyers (`mode: 'fly'`) keep the level of the tile they start on.
 */
export function moveCircle(grid: CollisionGrid, layer: Layer, x: number, y: number, r: number, dx: number, dy: number, rules: MoverRules, out: MoveResult): MoveResult {
  grid.beginQuery();
  st[CX] = x;
  st[CY] = y;
  st[R] = r;
  st[SX] = dx;
  st[SY] = dy;
  const packed = moveScratchCircle(grid, layer, rules);
  out.x = st[CX] as number;
  out.y = st[CY] as number;
  out.hit = (packed & MOVE_HIT) !== 0;
  out.normalX = st[NX] as number;
  out.normalY = st[NY] as number;
  out.level = moveResultLevel(packed);
  out.dropped = moveResultDropped(packed);
  return out;
}

/**
 * Moves every circle of a batch on `layer` with the same rules (one call per tick and rule set, no
 * allocation). Positions are written back; results go to `batch.result` (and the normals, if given).
 */
export function moveCircles(grid: CollisionGrid, layer: Layer, batch: CircleBatch, rules: MoverRules): void {
  const { count, x, y, dx, dy, r, result, normalX, normalY } = batch;
  if (x.length < count || y.length < count || dx.length < count || dy.length < count || r.length < count || result.length < count) {
    throw new RangeError(`moveCircles: every column needs at least ${count} entries`);
  }
  // One query for the whole batch: nothing edits the chunks while it runs.
  grid.beginQuery();
  for (let i = 0; i < count; i++) {
    st[CX] = x[i] as number;
    st[CY] = y[i] as number;
    st[R] = r[i] as number;
    st[SX] = dx[i] as number;
    st[SY] = dy[i] as number;
    result[i] = moveScratchCircle(grid, layer, rules);
    x[i] = st[CX] as number;
    y[i] = st[CY] as number;
    if (normalX !== undefined) normalX[i] = st[NX] as number;
    if (normalY !== undefined) normalY[i] = st[NY] as number;
  }
}

/**
 * Moves the box along one axis by `st[DEPTH]` and stops at the first blocked tile face; the stop
 * coordinate goes to `st[STOP]`. `horizontal`: the box moves along x. Returns whether it hit.
 */
function sweepBoxAxis(grid: CollisionGrid, layer: Layer, horizontal: boolean, rules: MoverRules, ref: number, level: number): boolean {
  const along = horizontal ? (st[CX] as number) : (st[CY] as number);
  const across = horizontal ? (st[CY] as number) : (st[CX] as number);
  const ha = horizontal ? (st[HW] as number) : (st[HH] as number);
  const hc = horizontal ? (st[HH] as number) : (st[HW] as number);
  const d = st[DEPTH] as number;
  const target = along + d;
  st[STOP] = target;
  if (d === 0) return false;
  const c0 = Math.floor((across - hc) * INV_TILE);
  const c1 = Math.ceil((across + hc) * INV_TILE) - 1;
  // Tiles newly overlapped by the leading edge.
  const lead0 = d > 0 ? Math.ceil((along + ha) * INV_TILE) : Math.floor((along - ha) * INV_TILE) - 1;
  const lead1 = d > 0 ? Math.ceil((target + ha) * INV_TILE) - 1 : Math.floor((target - ha) * INV_TILE);
  const step = d > 0 ? 1 : -1;
  for (let a = lead0; d > 0 ? a <= lead1 : a >= lead1; a += step) {
    for (let c = c0; c <= c1; c++) {
      const info = horizontal ? grid.info(layer, a, c) : grid.info(layer, c, a);
      if (!blocksMover(rules, ref, info, level)) continue;
      st[STOP] = d > 0 ? a * TILE_PX - ha - CONTACT_SKIN_PX : (a + 1) * TILE_PX + ha + CONTACT_SKIN_PX;
      return true;
    }
  }
  return false;
}

/**
 * Moves an axis-aligned box with half extents (hw, hh) [px] centred at (x, y) by (dx, dy) [px]:
 * first along x, then along y, each stopping at the first blocked tile face. Flyers keep the level
 * of the tile they start on.
 */
export function moveBox(grid: CollisionGrid, layer: Layer, x: number, y: number, hw: number, hh: number, dx: number, dy: number, rules: MoverRules, out: MoveResult): MoveResult {
  checkExtent('moveBox: half width', hw);
  checkExtent('moveBox: half height', hh);
  grid.beginQuery();
  st[CX] = x;
  st[CY] = y;
  st[HW] = hw;
  st[HH] = hh;
  st[SX] = dx;
  st[SY] = dy;
  st[DEPTH] = Math.min(hw, hh) * SUBSTEP_FRACTION;
  const n = substeps();
  const sx = dx / n;
  const sy = dy / n;
  const walker = rules.mode === 'walk';
  let refX = Math.floor(x * INV_TILE);
  let refY = Math.floor(y * INV_TILE);
  let ref = grid.info(layer, refX, refY);
  const level = infoLevel(ref);
  let blockedX = false;
  let blockedY = false;
  let dropped = 0;
  out.hit = false;
  out.normalX = 0;
  out.normalY = 0;
  for (let s = 0; s < n; s++) {
    for (let axis = 0; axis < 2; axis++) {
      const horizontal = axis === 0;
      if (horizontal ? blockedX : blockedY) continue;
      st[DEPTH] = horizontal ? sx : sy;
      const hitAxis = sweepBoxAxis(grid, layer, horizontal, rules, ref, level);
      st[horizontal ? CX : CY] = st[STOP] as number;
      if (hitAxis) {
        out.hit = true;
        if (horizontal) {
          blockedX = true;
          out.normalX = sx > 0 ? -1 : 1;
          out.normalY = 0;
        } else {
          blockedY = true;
          out.normalX = 0;
          out.normalY = sy > 0 ? -1 : 1;
        }
      }
      const tx = Math.floor((st[CX] as number) * INV_TILE);
      const ty = Math.floor((st[CY] as number) * INV_TILE);
      if (tx !== refX || ty !== refY) {
        const now = grid.info(layer, tx, ty);
        if (walker) dropped += droppedLevels(ref, now);
        ref = now;
        refX = tx;
        refY = ty;
      }
    }
  }
  out.x = st[CX] as number;
  out.y = st[CY] as number;
  out.level = walker ? infoLevel(ref) : level;
  out.dropped = dropped;
  return out;
}
