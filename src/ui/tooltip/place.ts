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
 * Nor does it graze what the covered panels show inside (M6-Gate, second and third picture review):
 * - a thin line (the divider under a heading) is kept clear like a rim, by `lineClear`: a 1-px line and the tooltip's
 *   dark outline two pixels apart pair into a double rule;
 * - text: the upper and lower edge never cut through a row of glyphs and keep `clear` from glyphs outside the tooltip
 *   (a glyph inside it is covered – unless it reaches into a corner `notch` of the tooltip's frame, which is transparent
 *   and would show a crumb of it); the far side edge (away from the anchor) never cuts a glyph and never touches one – a
 *   glyph beside the tooltip keeps at least the font's letter spacing from the outline – and it cuts no word: a value of a
 *   panel ("100/100", "None", "37.0 °C" – a run of glyphs without a breaking space) lies wholly under the tooltip or wholly
 *   beside it. A word cut at a letter reads as another, complete value ("100" from "100/100", "one" from "None"). For
 *   that the tooltip grows up to `shift` wider on its far side, in steps of `widthStep` (its frame's edge tiles stay on
 *   whole pixels), to the least width that cuts the fewest glyphs, then the fewest words (its content keeps its lines; the
 *   caller checks that). The near edge stays where the anchor puts it: moving it would bare a strip of the anchor's own
 *   panel (slots next to it).
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
  /** The width the tooltip grows to on its far side to clear the glyphs and words there; absent when it keeps its own. */
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
   * Glyphs of the text inside the panels and their words (the ink of each run of glyphs without a breaking space, on one
   * line), the least distance of the far side edge to a glyph or word beside it (the font's letter spacing), how much
   * wider the tooltip may grow on that side for them and in which steps (default `step`).
   */
  readonly glyphs?: readonly TooltipGlyph[];
  readonly words?: readonly TooltipGlyph[];
  readonly spacing?: number;
  readonly shift?: number;
  readonly widthStep?: number;
  /** Side of the transparent square in each outer corner of the tooltip's own frame (`frameNotch`); 0 without. */
  readonly notch?: number;
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
 * a glyph (cut, outside the tooltip nearer than `clear`, or under it in a corner notch, where it shows through).
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
    if (inNotch(g, left, top, right, bottom, o.notch ?? 0, true)) return true;
  }
  return false;
}

/**
 * Whether glyph `g` reaches into a corner notch (side `n`) of a tooltip over [`left`, `right`) × [`top`, `bottom`) – into
 * any of the four, or with `both` unset only into the two at `right`.
 */
function inNotch(g: TooltipGlyph, left: number, top: number, right: number, bottom: number, n: number, both: boolean): boolean {
  if (n <= 0) return false;
  const rows = overlap(g.top, g.bottom, top, top + n) || overlap(g.top, g.bottom, bottom - n, bottom);
  return rows && ((both && overlap(g.left, g.right, left, left + n)) || overlap(g.left, g.right, right - n, right));
}

/**
 * What the far side edge of a tooltip at `x` (its right edge, or its left edge when `flipped`) over the rows [`top`,
 * `bottom`) cuts: the glyphs it cuts or comes nearer to than the letter spacing, or that show in its corner notches (each
 * glyph should lie wholly under the tooltip or at least `spacing` outside it), and the words it cuts (each should lie
 * wholly under the tooltip or at least `spacing` outside it). `cut` receives both counts (glyphs, words).
 */
function farEdgeCuts(x: number, flipped: boolean, top: number, bottom: number, o: TooltipObstacles, cut: [number, number]): void {
  const s = o.spacing ?? 0;
  const n = o.notch ?? 0;
  const across = (g: TooltipGlyph) => (flipped ? between(x, g.left, g.right + s) : between(x, g.left - s, g.right));
  cut[0] = 0;
  cut[1] = 0;
  for (const g of o.glyphs ?? []) {
    if (!overlap(g.top, g.bottom, top, bottom)) continue;
    // The notches of the far corners: mirrored for a flipped tooltip, whose far edge is its left one.
    if (across(g) || (flipped ? inNotch(g, x, top, x + n, bottom, n, false) : inNotch(g, x - n, top, x, bottom, n, false))) cut[0]++;
  }
  for (const w of o.words ?? []) if (overlap(w.top, w.bottom, top, bottom) && across(w)) cut[1]++;
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
 * How much wider (up to `o.shift`, in steps of `o.widthStep`, inside [`min`, `max`] for the far edge) a tooltip of `size` at
 * `left`, `top` grows on its far side so that edge cuts the fewest glyphs, then the fewest words (`farEdgeCuts`) – the
 * least of those widths; with `keep` set, only widths at which its upper and lower edge stay clear (`grazes`, the rims alone
 * for `'rims'`). 0 when the edge is free or nothing within reach is better.
 */
function growPastText(left: number, top: number, size: TooltipSize, min: number, max: number, step: number, flipped: boolean, o: TooltipObstacles, keep: boolean | 'rims'): number {
  const far = flipped ? left : left + size.width;
  const dir = flipped ? -1 : 1;
  const bottom = top + size.height;
  const cut: [number, number] = [0, 0];
  farEdgeCuts(far, flipped, top, bottom, o, cut);
  let best = 0;
  let [glyphs, words] = cut;
  const unit = o.widthStep ?? (step > 0 ? step : 1);
  for (let d = unit; glyphs + words > 0 && d <= (o.shift ?? 0); d += unit) {
    const x = far + dir * d;
    if (x < min || x > max) break;
    farEdgeCuts(x, flipped, top, bottom, o, cut);
    if (cut[0] > glyphs || (cut[0] === glyphs && cut[1] >= words)) continue;
    const from = flipped ? x : left;
    if (keep !== false && grazes(top, size.height, from, from + size.width + d, o, keep === 'rims')) continue;
    best = d;
    [glyphs, words] = cut;
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
  if ((obstacles.glyphs?.length ?? 0) + (obstacles.words?.length ?? 0) === 0) return { left, top, flipped };
  const keep = all !== null ? true : rims !== null ? 'rims' : false;
  const grow = growPastText(left, top, size, low(margin), snap(viewport.width - margin, step), step, flipped, obstacles, keep);
  if (grow === 0) return { left, top, flipped };
  return { left: flipped ? left - grow : left, top, flipped, width: size.width + grow };
}
