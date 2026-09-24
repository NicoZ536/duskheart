/**
 * Swept tests for fast projectiles (MASTERPROMPT §3.3 "Swept-Tests für schnelle Projektile", M2-23).
 *
 * `sweepCircle` finds the exact first contact of a circle (radius ≤ one tile, 0 = a point) moving
 * along a segment with any blocked tile: the tiles along the centre line are walked with a grid DDA
 * (Amanatides & Woo) and each blocked tile in the 3 × 3 neighbourhood of a visited cell is tested as
 * a rounded rectangle (tile box ⊕ circle). A contact at time t lies within one tile of the cell that
 * contains the centre at t, so the walk can stop as soon as the next cell is entered after the best
 * contact. Nothing is skipped, whatever the speed (1 tile per tick at 60 tiles/s or a whole screen in
 * one hitscan). A projectile keeps its flight level (`PROJECTILE_RULES`, `mode: 'fly'`).
 *
 * No allocation: results go into a caller-owned `SweepHit`.
 */
import { TILE_PX as TILE_PX_IMPORT, type Layer } from '../model/coords';
import { blocksMover as blocksMoverImport, type CollisionGrid, type MoverRules } from './tiles';

// Module-local aliases (bundler module wrappers turn imported bindings into getter calls).
const TILE_PX = TILE_PX_IMPORT;
const blocksMover = blocksMoverImport;

/** Largest supported sweep radius [px] (the 3 × 3 neighbourhood covers one tile of clearance). */
export const MAX_SWEEP_RADIUS_PX = TILE_PX;
/** Most grid cells a single sweep may visit (a 4096-tile hitscan). */
const MAX_SWEEP_CELLS = 8192;

/** First contact of a sweep. */
export interface SweepHit {
  /** Whether anything was hit. */
  hit: boolean;
  /** Fraction of the segment travelled until the contact, 0…1 (1 without hit). */
  t: number;
  /** Centre at the contact [px] (the segment end without hit). */
  x: number;
  y: number;
  /** Contact normal (unit, pointing away from the obstacle); 0 without hit. */
  normalX: number;
  normalY: number;
  /** Tile that was hit and its packed collision info. */
  tileX: number;
  tileY: number;
  info: number;
}

/** A zeroed sweep result (allocate once, reuse). */
export function createSweepHit(): SweepHit {
  return { hit: false, t: 1, x: 0, y: 0, normalX: 0, normalY: 0, tileX: 0, tileY: 0, info: 0 };
}

/** Scratch of `segmentVsRoundedBox`: time and normal of the contact. */
const toi = { t: 0, nx: 0, ny: 0 };
/** Time and normal of the last contact found by `segmentVsRoundedBox` (read it right after the call). */
export const sweepContact: Readonly<typeof toi> = toi;

/**
 * Earliest contact of a circle of radius `r` moving from (ox, oy) by (dx, dy) (t ∈ [0, 1]) with the
 * box [bx0, bx1] × [by0, by1]. Writes `toi`; returns false if they do not touch within the segment.
 * An initial overlap is a contact at t = 0.
 */
export function segmentVsRoundedBox(ox: number, oy: number, dx: number, dy: number, r: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
  const qx = ox < bx0 ? bx0 : ox > bx1 ? bx1 : ox;
  const qy = oy < by0 ? by0 : oy > by1 ? by1 : oy;
  const ex = ox - qx;
  const ey = oy - qy;
  const e2 = ex * ex + ey * ey;
  const inside = r > 0 ? e2 < r * r : ox > bx0 && ox < bx1 && oy > by0 && oy < by1;
  if (inside) {
    toi.t = 0;
    if (e2 > 0) {
      const d = Math.sqrt(e2);
      toi.nx = ex / d;
      toi.ny = ey / d;
    } else {
      // Centre inside the box: the normal opposes the motion (points up for a resting start).
      const len = Math.sqrt(dx * dx + dy * dy);
      toi.nx = len > 0 ? -dx / len : 0;
      toi.ny = len > 0 ? -dy / len : -1;
    }
    return true;
  }
  // Slabs of the box expanded by r.
  let tmin = Number.NEGATIVE_INFINITY;
  let tmax = Number.POSITIVE_INFINITY;
  let nx = 0;
  let ny = 0;
  if (dx === 0) {
    if (ox < bx0 - r || ox > bx1 + r) return false;
  } else {
    let t1 = (bx0 - r - ox) / dx;
    let t2 = (bx1 + r - ox) / dx;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    tmin = t1;
    nx = n;
    tmax = t2;
  }
  if (dy === 0) {
    if (oy < by0 - r || oy > by1 + r) return false;
  } else {
    let t1 = (by0 - r - oy) / dy;
    let t2 = (by1 + r - oy) / dy;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tmax) tmax = t2;
  }
  if (tmin > tmax || tmax < 0 || tmin > 1) return false;
  // Where the expanded box is entered: an edge band gives the answer, a corner square needs the round corner.
  const t0 = tmin > 0 ? tmin : 0;
  const px = ox + dx * t0;
  const py = oy + dy * t0;
  const cornerX = px < bx0 ? bx0 : px > bx1 ? bx1 : Number.NaN;
  const cornerY = py < by0 ? by0 : py > by1 ? by1 : Number.NaN;
  if (r > 0 && !Number.isNaN(cornerX) && !Number.isNaN(cornerY)) {
    // Ray against the corner circle: |o + t·d − c|² = r².
    const mx = ox - cornerX;
    const my = oy - cornerY;
    const a = dx * dx + dy * dy;
    const b = mx * dx + my * dy;
    const c = mx * mx + my * my - r * r;
    const disc = b * b - a * c;
    if (disc < 0 || a === 0) return false;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > 1) return false;
    toi.t = t;
    toi.nx = (mx + dx * t) / r;
    toi.ny = (my + dy * t) / r;
    return true;
  }
  if (tmin >= 0) {
    toi.t = tmin;
    toi.nx = nx;
    toi.ny = ny;
    return true;
  }
  // The start touches the boundary of an edge band: a contact only when moving inwards.
  let bnx: number;
  let bny: number;
  if (e2 > 0) {
    const d = Math.sqrt(e2);
    bnx = ex / d;
    bny = ey / d;
  } else {
    const left = ox - bx0;
    const right = bx1 - ox;
    const top = oy - by0;
    const bottom = by1 - oy;
    const m = Math.min(left, right, top, bottom);
    bnx = m === left ? -1 : m === right ? 1 : 0;
    bny = bnx !== 0 ? 0 : m === top ? -1 : 1;
  }
  if (dx * bnx + dy * bny >= 0) return false;
  toi.t = 0;
  toi.nx = bnx;
  toi.ny = bny;
  return true;
}

/**
 * Sweeps a circle of radius `r` [px] (0 = a point) from (x0, y0) to (x1, y1) on `layer` and reports
 * the first blocked tile it touches. `level` is the flight level for `mode: 'fly'` rules; walkers
 * use the tile under the start as reference.
 */
export function sweepCircle(grid: CollisionGrid, layer: Layer, x0: number, y0: number, x1: number, y1: number, r: number, rules: MoverRules, level: number, out: SweepHit): SweepHit {
  if (!(r >= 0 && r <= MAX_SWEEP_RADIUS_PX)) throw new RangeError(`sweepCircle: radius must be in [0, ${MAX_SWEEP_RADIUS_PX}] px, got ${String(r)}`);
  // `v - v === 0` is false exactly for NaN and ±Infinity (no array per call on the projectile path).
  if (!(x0 - x0 === 0 && y0 - y0 === 0 && x1 - x1 === 0 && y1 - y1 === 0)) throw new RangeError('sweepCircle: coordinates must be finite');
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dx) + Math.abs(dy) > (MAX_SWEEP_CELLS - 2) * TILE_PX) throw new RangeError(`sweepCircle: segment longer than ${MAX_SWEEP_CELLS - 2} tiles`);
  grid.beginQuery();
  const ref = grid.info(layer, Math.floor(x0 / TILE_PX), Math.floor(y0 / TILE_PX));
  let best = Number.POSITIVE_INFINITY;
  out.hit = false;
  out.normalX = 0;
  out.normalY = 0;
  // Grid DDA over the cells of the centre line, in tile units.
  const ox = x0 / TILE_PX;
  const oy = y0 / TILE_PX;
  const ddx = dx / TILE_PX;
  const ddy = dy / TILE_PX;
  let cellX = Math.floor(ox);
  let cellY = Math.floor(oy);
  const stepX = ddx > 0 ? 1 : ddx < 0 ? -1 : 0;
  const stepY = ddy > 0 ? 1 : ddy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / ddx) : Number.POSITIVE_INFINITY;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / ddy) : Number.POSITIVE_INFINITY;
  let tMaxX = stepX > 0 ? (cellX + 1 - ox) * tDeltaX : stepX < 0 ? (ox - cellX) * tDeltaX : Number.POSITIVE_INFINITY;
  let tMaxY = stepY > 0 ? (cellY + 1 - oy) * tDeltaY : stepY < 0 ? (oy - cellY) * tDeltaY : Number.POSITIVE_INFINITY;
  const reach = r > 0 ? 1 : 0;
  let tEnter = 0;
  for (;;) {
    for (let ny = -reach; ny <= reach; ny++) {
      for (let nx = -reach; nx <= reach; nx++) {
        const tx = cellX + nx;
        const ty = cellY + ny;
        const info = grid.info(layer, tx, ty);
        if (!blocksMover(rules, ref, info, level)) continue;
        const bx0 = tx * TILE_PX;
        const by0 = ty * TILE_PX;
        if (!segmentVsRoundedBox(x0, y0, dx, dy, r, bx0, by0, bx0 + TILE_PX, by0 + TILE_PX)) continue;
        if (toi.t < best) {
          best = toi.t;
          out.hit = true;
          out.normalX = toi.nx;
          out.normalY = toi.ny;
          out.tileX = tx;
          out.tileY = ty;
          out.info = info;
        }
      }
    }
    // Next cell; stop once it is entered after the best contact or beyond the segment end.
    if (tMaxX < tMaxY) {
      tEnter = tMaxX;
      cellX += stepX;
      tMaxX += tDeltaX;
    } else {
      tEnter = tMaxY;
      cellY += stepY;
      tMaxY += tDeltaY;
    }
    if (tEnter > best || tEnter > 1) break;
  }
  const t = out.hit ? best : 1;
  out.t = t;
  out.x = x0 + dx * t;
  out.y = y0 + dy * t;
  return out;
}
