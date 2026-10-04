/**
 * The sight line of a creature (MASTERPROMPT §19.4 "Sichtkegel … Sichtweite"; docs/SPIEL.md §11 "Wahrnehmung"; M6-16d).
 *
 * Whether rock, walls, objects or the void stand between a creature and the player is the point sweep of the collision
 * (`sweepCircle` with radius 0 and flight rules at the higher of both levels): the tiles along the line are walked with the
 * same grid DDA (Amanatides & Woo: the same cell order and ties), and the line is blocked as soon as one of them blocks a
 * flyer of that level (`blocksMover`) and the line touches it as the sweep counts a touch (`segmentVsRoundedBox` with
 * radius 0, written out in `touches`: a line that only grazes a tile's corner or starts on its edge and leaves it does not).
 * The answer is the sweep's `hit` – a unit test compares both on many lines and on the corner and edge cases.
 *
 * Why its own walk: the line's ends are fractional pixels, and a fractional number passed to a call V8 does not inline is
 * boxed (16 B each); the sweep takes eight of them. The sight line holds its ends in fields and its check takes none.
 */
import { blocksMover, type CollisionGrid, type MoverRules } from '../../world/collision/tiles';
import { TILE_PX, type Layer } from '../../world/model/coords';

/** A held sight line (a class: its fields keep a number representation of their own). */
export class SightLine {
  /** Start and end of the line [px] (NaN until set: fractional from the start, see `TurnDirection`). */
  x0 = Number.NaN;
  y0 = Number.NaN;
  x1 = Number.NaN;
  y1 = Number.NaN;

  /**
   * Whether nothing of `rules` at flight level `level` blocks the line on `layer` (`!sweepCircle(…, 0, rules, level).hit`
   * for flight rules).
   */
  clear(grid: CollisionGrid, layer: Layer, rules: MoverRules, level: number): boolean {
    const x0 = this.x0;
    const y0 = this.y0;
    const dx = this.x1 - x0;
    const dy = this.y1 - y0;
    // `v - v === 0` is false exactly for NaN and ±Infinity (the walk would never end).
    if (!(x0 - x0 === 0 && y0 - y0 === 0 && dx - dx === 0 && dy - dy === 0)) throw new RangeError('SightLine: coordinates must be finite');
    grid.beginQuery();
    const ref = grid.info(layer, Math.floor(x0 / TILE_PX), Math.floor(y0 / TILE_PX));
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
    for (;;) {
      if (blocksMover(rules, ref, grid.info(layer, cellX, cellY), level) && this.touches(cellX, cellY)) return false;
      let tEnter: number;
      if (tMaxX < tMaxY) {
        tEnter = tMaxX;
        cellX += stepX;
        tMaxX += tDeltaX;
      } else {
        tEnter = tMaxY;
        cellY += stepY;
        tMaxY += tDeltaY;
      }
      if (tEnter > 1) return true;
    }
  }

  /**
   * Whether the line touches tile (tx, ty) as the sweep counts it: `segmentVsRoundedBox` of the collision with radius 0, the
   * same comparisons in the same order (a start strictly inside; the slabs of the box; a start on its boundary only when
   * the line heads inwards).
   */
  private touches(tx: number, ty: number): boolean {
    const ox = this.x0;
    const oy = this.y0;
    const dx = this.x1 - ox;
    const dy = this.y1 - oy;
    const bx0 = tx * TILE_PX;
    const by0 = ty * TILE_PX;
    const bx1 = bx0 + TILE_PX;
    const by1 = by0 + TILE_PX;
    if (ox > bx0 && ox < bx1 && oy > by0 && oy < by1) return true;
    let tmin = Number.NEGATIVE_INFINITY;
    let tmax = Number.POSITIVE_INFINITY;
    if (dx === 0) {
      if (ox < bx0 || ox > bx1) return false;
    } else {
      const t1 = (bx0 - ox) / dx;
      const t2 = (bx1 - ox) / dx;
      tmin = t1 < t2 ? t1 : t2;
      tmax = t1 < t2 ? t2 : t1;
    }
    if (dy === 0) {
      if (oy < by0 || oy > by1) return false;
    } else {
      const t1 = (by0 - oy) / dy;
      const t2 = (by1 - oy) / dy;
      if ((t1 < t2 ? t1 : t2) > tmin) tmin = t1 < t2 ? t1 : t2;
      if ((t1 < t2 ? t2 : t1) < tmax) tmax = t1 < t2 ? t2 : t1;
    }
    if (tmin > tmax || tmax < 0 || tmin > 1) return false;
    if (tmin >= 0) return true;
    // The start lies on the boundary: a contact only when the line heads inwards.
    const qx = ox < bx0 ? bx0 : ox > bx1 ? bx1 : ox;
    const qy = oy < by0 ? by0 : oy > by1 ? by1 : oy;
    const ex = ox - qx;
    const ey = oy - qy;
    let bnx: number;
    let bny: number;
    if (ex * ex + ey * ey > 0) {
      const d = Math.sqrt(ex * ex + ey * ey);
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
    return dx * bnx + dy * bny < 0;
  }
}
