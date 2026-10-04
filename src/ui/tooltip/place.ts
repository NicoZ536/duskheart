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
}

/** A panel frame on the screen: its outer rectangle and the thickness of its rim (same unit as the rectangle). */
export interface TooltipFrame {
  readonly rect: NavRect;
  readonly rim: number;
}

/** What `placeTooltip` keeps clear of: the panel frames of the screen and the least distance to their rims. */
export interface TooltipObstacles {
  readonly frames: readonly TooltipFrame[];
  readonly clear: number;
}

/** Rounds `v` down to a multiple of `step`. */
function snap(v: number, step: number): number {
  return step > 0 ? Math.floor(v / step) * step : Math.floor(v);
}

/** Whether a horizontal edge at `y` lies on the band [`start`, `end`) or closer than `clear` to it. */
function grazes(y: number, start: number, end: number, clear: number): boolean {
  return y > start - clear && y < end + clear;
}

/**
 * Whether a tooltip at `top` with `height` grazes a rim of one of `frames` that overlap the columns
 * [`left`, `right`): its top or bottom edge on or near the top or bottom rim of the frame.
 */
function grazesFrames(top: number, height: number, left: number, right: number, frames: readonly TooltipFrame[], clear: number): boolean {
  const bottom = top + height;
  for (const f of frames) {
    const r = f.rect;
    if (r.width <= 0 || r.height <= 0 || r.left >= right || r.left + r.width <= left) continue;
    const rims: ReadonlyArray<readonly [number, number]> = [
      [r.top, r.top + f.rim],
      [r.top + r.height - f.rim, r.top + r.height],
    ];
    for (const [start, end] of rims) {
      if (grazes(top, start, end, clear) || grazes(bottom, start, end, clear)) return true;
    }
  }
  return false;
}

/**
 * The height nearest to `top` (snapped to `step`, inside [`min`, `max`]) at which a tooltip of `height` over the columns
 * [`left`, `right`) grazes no rim of `frames` by less than `clear`; `top` itself when it is free or no such height exists.
 * Ties go upwards (the tooltip then covers the rim rather than sliding under it).
 */
function clearOfFrames(top: number, height: number, left: number, right: number, min: number, max: number, step: number, o: TooltipObstacles): number {
  if (!grazesFrames(top, height, left, right, o.frames, o.clear)) return top;
  const candidates: number[] = [];
  for (const f of o.frames) {
    const r = f.rect;
    for (const [start, end] of [
      [r.top, r.top + f.rim],
      [r.top + r.height - f.rim, r.top + r.height],
    ] as const) {
      // Each edge of the tooltip just clear above or below the rim.
      candidates.push(start - o.clear, end + o.clear, start - o.clear - height, end + o.clear - height);
    }
  }
  let best = top;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    // Above the rim: round up never into it; below: round down never into it – a snapped candidate is checked again.
    for (const s of [snap(c, step), snap(c, step) + (step > 0 ? step : 1)]) {
      if (s < min || s > max || grazesFrames(s, height, left, right, o.frames, o.clear)) continue;
      const d = Math.abs(s - top);
      if (d < bestDistance || (d === bestDistance && s < best)) {
        best = s;
        bestDistance = d;
      }
    }
  }
  return best;
}

/**
 * Top-left corner [CSS px] of a tooltip of `size` for `anchor` in a viewport of `viewport`, `gap` CSS
 * px away from the anchor, `margin` CSS px from the viewport edges; with `obstacles`, its upper and lower edge
 * keep clear of the rims of the panel frames (see module comment).
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
  if (obstacles !== undefined && obstacles.frames.length > 0) {
    const min = snap(margin, step) < margin ? snap(margin, step) + step : snap(margin, step);
    const max = snap(viewport.height - margin - size.height, step);
    top = clearOfFrames(top, size.height, left, left + size.width, Math.min(min, top), Math.max(max, top), step, obstacles);
  }
  return { left, top, flipped };
}
