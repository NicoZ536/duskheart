/**
 * Where a tooltip goes (MASTERPROMPT §26): to the right of its anchor (the hovered or focused slot),
 * top edges aligned; to the left when the right side lacks room; then pushed inside the viewport.
 * All positions land on whole design pixels (`step` CSS px), so frame and text stay crisp.
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

/** Rounds `v` down to a multiple of `step`. */
function snap(v: number, step: number): number {
  return step > 0 ? Math.floor(v / step) * step : Math.floor(v);
}

/**
 * Top-left corner [CSS px] of a tooltip of `size` for `anchor` in a viewport of `viewport`, `gap` CSS
 * px away from the anchor, `margin` CSS px from the viewport edges.
 */
export function placeTooltip(anchor: NavRect, size: TooltipSize, viewport: TooltipSize, gap: number, margin: number, step: number): TooltipPlacement {
  const rightLeft = anchor.left + anchor.width + gap;
  const fitsRight = rightLeft + size.width <= viewport.width - margin;
  const leftLeft = anchor.left - gap - size.width;
  const flipped = !fitsRight && leftLeft >= margin;
  let left = flipped ? leftLeft : rightLeft;
  left = Math.min(left, viewport.width - margin - size.width);
  left = Math.max(margin, left);
  let top = Math.min(anchor.top, viewport.height - margin - size.height);
  top = Math.max(margin, top);
  return { left: snap(left, step), top: snap(top, step), flipped };
}
