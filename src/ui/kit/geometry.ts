/**
 * Pixel math of the UI kit (MASTERPROMPT §26 "ganzzahlige UI-Skalierung"): every size is given in
 * design pixels at 1× and multiplied by `--dh-ui-scale` in CSS, so borders, fills and text always
 * land on whole screen pixels. Values that depend on data (bar fill, scroll thumb) are rounded to
 * whole design pixels here, never in CSS.
 */
import { UI_SCALE_VAR } from '../theme';

/** CSS length of `n` design pixels at the current UI scale. */
export function uiPx(n: number): string {
  return n === 0 ? '0' : `calc(${n}px * var(${UI_SCALE_VAR}))`;
}

/**
 * Filled width of a bar [design px] for `value` of `max` in an inner width of `inner` px. Rounded to
 * whole pixels, but a non-zero value always shows at least one pixel and a value below the maximum
 * never shows a full bar – "almost dead" and "not quite full" stay visible.
 */
export function barFillPx(value: number, max: number, inner: number): number {
  if (!(max > 0) || !(inner > 0) || !(value > 0)) return 0;
  if (value >= max) return inner;
  const px = Math.round((value / max) * inner);
  return Math.min(inner - 1, Math.max(1, px));
}

export interface ThumbGeometry {
  /** Thumb length [design px]. */
  readonly size: number;
  /** Thumb offset from the top of the track [design px]. */
  readonly offset: number;
  /** Whether there is anything to scroll. */
  readonly scrollable: boolean;
}

/**
 * Scrollbar thumb for a viewport of `view` px showing content of `content` px scrolled by `scroll` px,
 * in a track of `track` px (all in design px). The thumb is at least `minSize` px long and moves in
 * whole pixels from 0 to `track − size`.
 */
export function thumbGeometry(view: number, content: number, scroll: number, track: number, minSize: number): ThumbGeometry {
  const t = Math.max(0, Math.floor(track));
  if (content <= view || t === 0) return { size: t, offset: 0, scrollable: false };
  const size = Math.min(t, Math.max(minSize, Math.round((view / content) * t)));
  const range = content - view;
  const travel = t - size;
  const offset = Math.round((Math.min(range, Math.max(0, scroll)) / range) * travel);
  return { size, offset, scrollable: true };
}

/** Scroll position [px] that puts the thumb at `offset` (inverse of `thumbGeometry`, for dragging). */
export function scrollForThumb(offset: number, view: number, content: number, track: number, size: number): number {
  const travel = track - size;
  const range = content - view;
  if (travel <= 0 || range <= 0) return 0;
  return (Math.min(travel, Math.max(0, offset)) / travel) * range;
}

/** Snaps a scroll position [CSS px] to whole design pixels at scale `step` (keeps pixel art on the grid). */
export function snapScroll(scroll: number, step: number): number {
  if (!(step > 0)) return scroll;
  return Math.round(scroll / step) * step;
}
