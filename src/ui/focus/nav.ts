/**
 * Spatial navigation of the focus frame (MASTERPROMPT §26 "Controller: vollständige Navigation mit
 * Fokusrahmen"): from the focused element, the arrow keys, the D-pad and the left stick move to the
 * nearest navigable element in that direction. Pure geometry on rectangles in any common unit
 * (the focus manager passes client rects), so screens need no hand-written neighbour tables.
 *
 * Rules:
 * - A candidate lies in the direction when its centre is past the start's centre along that axis and
 *   it does not reach back over the start's far edge by more than half its size (items of one row or
 *   column, also slots that touch).
 * - Beam first: a candidate that overlaps the start across the direction (same row for left/right,
 *   same column for up/down) always wins over one that does not – moving along a row never jumps to
 *   the neighbouring row while the row goes on.
 * - Score = gap along the direction + 4 × gap across it + 0.1 × offset of the centres across it:
 *   among beam candidates the nearest (then the better aligned) wins; without any, the next row or
 *   column is chosen by the same score (crossing to a neighbouring panel).
 * - Ties keep the earlier candidate (document order).
 */

/** A direction of the focus movement. */
export type NavDirection = 'up' | 'down' | 'left' | 'right';

/** The four directions. */
export const NAV_DIRECTIONS: readonly NavDirection[] = ['up', 'down', 'left', 'right'];

/** A rectangle (client rect or design pixels). */
export interface NavRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Weight of the gap across the direction (row/column changes cost more than distance within a row). */
const CROSS_GAP_WEIGHT = 4;
/** Weight of the centre offset across the direction (alignment among overlapping candidates). */
const CROSS_CENTRE_WEIGHT = 0.1;
/** Half: a candidate may overlap the start by at most half its own size along the direction. */
const MAX_OVERLAP = 0.5;

/** Distance between the intervals [a0, a1] and [b0, b1] (0 when they overlap). */
function intervalGap(a0: number, a1: number, b0: number, b1: number): number {
  if (b0 > a1) return b0 - a1;
  if (a0 > b1) return a0 - b1;
  return 0;
}

/**
 * Score of moving from `from` to `c` in `dir` (lower is better), or `null` when `c` does not lie in
 * that direction.
 */
export function navScore(from: NavRect, c: NavRect, dir: NavDirection): number | null {
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const fromCentre = horizontal ? from.left + from.width / 2 : from.top + from.height / 2;
  const cCentre = horizontal ? c.left + c.width / 2 : c.top + c.height / 2;
  if ((cCentre - fromCentre) * sign <= 0) return null;
  // Gap between the facing edges along the direction (negative when they overlap).
  const fromNear = horizontal ? (sign > 0 ? from.left + from.width : from.left) : sign > 0 ? from.top + from.height : from.top;
  const cNear = horizontal ? (sign > 0 ? c.left : c.left + c.width) : sign > 0 ? c.top : c.top + c.height;
  const gap = (cNear - fromNear) * sign;
  const cSize = horizontal ? c.width : c.height;
  if (gap < -cSize * MAX_OVERLAP) return null;
  const cross = horizontal
    ? intervalGap(from.top, from.top + from.height, c.top, c.top + c.height)
    : intervalGap(from.left, from.left + from.width, c.left, c.left + c.width);
  const fromCross = horizontal ? from.top + from.height / 2 : from.left + from.width / 2;
  const cCross = horizontal ? c.top + c.height / 2 : c.left + c.width / 2;
  return Math.max(0, gap) + CROSS_GAP_WEIGHT * cross + CROSS_CENTRE_WEIGHT * Math.abs(cCross - fromCross);
}

/** Whether `c` overlaps `from` across `dir` (it lies in the start's beam). */
export function inBeam(from: NavRect, c: NavRect, dir: NavDirection): boolean {
  return dir === 'left' || dir === 'right'
    ? intervalGap(from.top, from.top + from.height, c.top, c.top + c.height) === 0
    : intervalGap(from.left, from.left + from.width, c.left, c.left + c.width) === 0;
}

/** Index of the best candidate from `from` in `dir` (see module comment), or −1; `skip` is left out (the start itself). */
export function pickInDirection(from: NavRect, candidates: readonly NavRect[], dir: NavDirection, skip = -1): number {
  let best = -1;
  let bestBeam = false;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (i === skip || c === undefined || c.width <= 0 || c.height <= 0) continue;
    const score = navScore(from, c, dir);
    if (score === null) continue;
    const beam = inBeam(from, c, dir);
    if ((beam && !bestBeam) || (beam === bestBeam && score < bestScore)) {
      best = i;
      bestBeam = beam;
      bestScore = score;
    }
  }
  return best;
}
