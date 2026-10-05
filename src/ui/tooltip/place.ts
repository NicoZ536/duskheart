/**
 * Where a tooltip goes (MASTERPROMPT §26): to the right of its anchor (the hovered or focused slot),
 * top edges aligned; to the left when the right side lacks room; then pushed inside the viewport.
 * All positions land on whole design pixels (`step` CSS px), so frame and text stay crisp.
 *
 * The tooltip never grazes a panel frame (M6-Gate, §31.5 "UI-Ausrichtung"): an upper or lower edge of the
 * tooltip that would lie on a frame's rim, or within `clear` of it, makes a sliver of wood or parchment
 * stand above or below the tooltip – a near-tangent. The tooltip then moves to the nearest height at
 * which each of its edges clears every rim of a frame it overlaps sideways by at least `clear`: above the
 * rim (the tooltip covers it decisively) or below it (the panel shows a clear strip of its inside).
 *
 * Nor does it graze what the covered panels show inside (M6-Gate, second picture review):
 * - a thin line (the divider under a heading) is kept clear like a rim, by `lineClear`: a 1-px line and the tooltip's
 *   dark outline two pixels apart pair into a double rule;
 * - text: the upper and lower edge never cut through a row of glyphs and keep `clear` from glyphs outside the tooltip
 *   (a glyph inside it is covered); the far side edge (away from the anchor) never cuts a glyph and never touches one –
 *   a glyph beside the tooltip keeps at least the font's letter spacing from the outline, as the next letter does where
 *   the tooltip ends a word at a letter. For that the tooltip grows up to `shift` wider on its far side (its content
 *   keeps its lines; the caller checks that), to the nearest width that cuts and touches the fewest glyphs. The near
 *   edge stays where the anchor puts it: moving it would bare a strip of the anchor's own panel (slots next to it).
 * The rims stay the stronger rule: when no height clears rims, lines and text together, the tooltip clears the rims
 * alone (ADR-0177).
 */
import type { NavRect } from '../focus/nav';

export interface TooltipSize {
  readonly width: number;
  readonly height: number;
}

export interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
  /** Whether the tooltip sits left of its anchor. */
  readonly flipped: boolean;
  /** The width the tooltip grows to on its far side to clear a glyph there; absent when it keeps its own. */
  readonly width?: number;
}

/** A panel frame on the screen: its outer rectangle and the thickness of its rim (same unit as the rectangle). */
export interface TooltipFrame {
  readonly rect: NavRect;
  readonly rim: number;
}

/** A glyph of the text of a covered panel: the columns [`left`, `right`) and rows [`top`, `bottom`) of its ink. */
export interface TooltipGlyph {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** What `placeTooltip` keeps clear of, and by how much (same unit as the rectangles). */
export interface TooltipObstacles {
  /** The panel frames of the screen and the least distance of an upper or lower edge to their rims. */
  readonly frames: readonly TooltipFrame[];
  readonly clear: number;
  /** Thin lines inside the panels (dividers) and the least distance of an upper or lower edge to them. */
  readonly lines?: readonly NavRect[];
  readonly lineClear?: number;
  /**
   * Glyphs of the text inside the panels, the least distance of the far side edge to a glyph beside it (the font's
   * letter spacing), and how much wider the tooltip may grow on that side for them.
   */
  readonly glyphs?: readonly TooltipGlyph[];
  readonly spacing?: number;
  readonly shift?: number;
}

/** Rounds `v` down to a multiple of `step`. */
function snap(v: number, step: number): number {
  return step > 0 ? Math.floor(v / step) * step : Math.floor(v);
}

/** Whether `y` lies strictly between `low` and `high`. */
function between(y: number, low: number, high: number): boolean {
  return y > low && y < high;
}

/** Whether the columns [`a0`, `a1`) and [`b0`, `b1`) share a column. */
function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

/**
 * Whether a tooltip at `top` with `height` over the columns [`left`, `right`) grazes an obstacle with its upper or lower
 * edge: a rim of `frames` (on it or nearer than `clear`), with `rimsOnly` unset also a line (nearer than `lineClear`) or
 * a glyph (cut, or outside the tooltip nearer than `clear`).
 */
function grazes(top: number, height: number, left: number, right: number, o: TooltipObstacles, rimsOnly: boolean): boolean {
  const bottom = top + height;
  const c = o.clear;
  for (const f of o.frames) {
    const r = f.rect;
    if (r.width <= 0 || r.height <= 0 || !overlap(r.left, r.left + r.width, left, right)) continue;
    const upper = r.top;
    const lower = r.top + r.height - f.rim;
    if (between(top, upper - c, upper + f.rim + c) || between(bottom, upper - c, upper + f.rim + c)) return true;
    if (between(top, lower - c, lower + f.rim + c) || between(bottom, lower - c, lower + f.rim + c)) return true;
  }
  if (rimsOnly) return false;
  const lc = o.lineClear ?? c;
  for (const l of o.lines ?? []) {
    if (!overlap(l.left, l.left + l.width, left, right)) continue;
    const end = l.top + l.height;
    if (between(top, l.top - lc, end + lc) || between(bottom, l.top - lc, end + lc)) return true;
  }
  for (const g of o.glyphs ?? []) {
    if (!overlap(g.left, g.right, left, right)) continue;
    // The upper edge: a glyph below it is covered, one cut or just above it is not; the lower edge mirrored.
    if (between(top, g.top, g.bottom + c) || between(bottom, g.top - c, g.bottom)) return true;
  }
  return false;
}

/**
 * How many glyphs the far side edge of a tooltip at `x` (its right edge, or its left edge when `flipped`) over the rows
 * [`top`, `bottom`) cuts, or comes nearer to than the letter spacing: each glyph should lie wholly under the tooltip or at
 * least `spacing` outside it.
 */
function glyphsCut(x: number, flipped: boolean, top: number, bottom: number, o: TooltipObstacles): number {
  const s = o.spacing ?? 0;
  let n = 0;
  for (const g of o.glyphs ?? []) {
    if (!overlap(g.top, g.bottom, top, bottom)) continue;
    if (flipped ? between(x, g.left, g.right + s) : between(x, g.left - s, g.right)) n++;
  }
  return n;
}

/**
 * The height nearest to `top` (on the grid of `step`, inside [`min`, `max`]) at which a tooltip of `height` over the columns
 * [`left`, `right`) grazes no obstacle (`grazes`); `null` when there is none. Ties go upwards (the tooltip then covers a rim
 * rather than sliding under it).
 */
function clearHeight(top: number, height: number, left: number, right: number, min: number, max: number, step: number, o: TooltipObstacles, rimsOnly: boolean): number | null {
  const unit = step > 0 ? step : 1;
  for (let d = 0; top - d >= min || top + d <= max; d += unit) {
    if (top - d >= min && top - d <= max && !grazes(top - d, height, left, right, o, rimsOnly)) return top - d;
    if (d > 0 && top + d <= max && top + d >= min && !grazes(top + d, height, left, right, o, rimsOnly)) return top + d;
  }
  return null;
}

/**
 * How much wider (up to `o.shift`, on the grid of `step`, inside [`min`, `max`] for the far edge) a tooltip of `size` at
 * `left`, `top` grows on its far side so that edge cuts and touches the fewest glyphs (`glyphsCut`), the least of those
 * widths; with `keep` set, only widths at which its upper and lower edge stay clear (`grazes`, the rims alone for
 * `'rims'`). 0 when the edge is free or nothing within reach is better.
 */
function growPastGlyphs(left: number, top: number, size: TooltipSize, min: number, max: number, step: number, flipped: boolean, o: TooltipObstacles, keep: boolean | 'rims'): number {
  const far = flipped ? left : left + size.width;
  const dir = flipped ? -1 : 1;
  let best = 0;
  let fewest = glyphsCut(far, flipped, top, top + size.height, o);
  const unit = step > 0 ? step : 1;
  for (let d = unit; fewest > 0 && d <= (o.shift ?? 0); d += unit) {
    const x = far + dir * d;
    if (x < min || x > max) break;
    const n = glyphsCut(x, flipped, top, top + size.height, o);
    const from = flipped ? x : left;
    if (n >= fewest || (keep !== false && grazes(top, size.height, from, from + size.width + d, o, keep === 'rims'))) continue;
    best = d;
    fewest = n;
  }
  return best;
}

/**
 * Top-left corner [CSS px] of a tooltip of `size` for `anchor` in a viewport of `viewport`, `gap` CSS
 * px away from the anchor, `margin` CSS px from the viewport edges; with `obstacles`, its edges keep clear of
 * the rims of the panel frames, of the lines and of the text inside them (see module comment).
 */
export function placeTooltip(anchor: NavRect, size: TooltipSize, viewport: TooltipSize, gap: number, margin: number, step: number, obstacles?: TooltipObstacles): TooltipPlacement {
  const rightLeft = anchor.left + anchor.width + gap;
  const fitsRight = rightLeft + size.width <= viewport.width - margin;
  const leftLeft = anchor.left - gap - size.width;
  const flipped = !fitsRight && leftLeft >= margin;
  let left = flipped ? leftLeft : rightLeft;
  left = Math.min(left, viewport.width - margin - size.width);
  left = Math.max(margin, left);
  let top = Math.min(anchor.top, viewport.height - margin - size.height);
  top = Math.max(margin, top);
  left = snap(left, step);
  top = snap(top, step);
  if (obstacles === undefined) return { left, top, flipped };
  const low = (v: number) => (snap(v, step) < v ? snap(v, step) + step : snap(v, step));
  const min = Math.min(low(margin), top);
  const max = Math.max(snap(viewport.height - margin - size.height, step), top);
  // Rims, lines and text; when no height clears them together, the rims alone (ADR-0177); else where it was.
  const all = clearHeight(top, size.height, left, left + size.width, min, max, step, obstacles, false);
  const rims = all === null ? clearHeight(top, size.height, left, left + size.width, min, max, step, obstacles, true) : null;
  top = all ?? rims ?? top;
  if (obstacles.glyphs === undefined || obstacles.glyphs.length === 0) return { left, top, flipped };
  const keep = all !== null ? true : rims !== null ? 'rims' : false;
  const grow = growPastGlyphs(left, top, size, low(margin), snap(viewport.width - margin, step), step, flipped, obstacles, keep);
  if (grow === 0) return { left, top, flipped };
  return { left: flipped ? left - grow : left, top, flipped, width: size.width + grow };
}
