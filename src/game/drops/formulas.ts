/**
 * Pure formulas of dropped items (MASTERPROMPT §11.4 "Aufheben: Kleinteile im Radius 1,5 Tiles
 * automatisch (Magnet), sonst E", §14 "fliegende Drops mit Magnet"; M3-10).
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import { TILE_PX } from '../../world/model/coords';

const I = BALANCE.interaction;

/** Whether the magnet takes an item by itself: small items – everything that stacks (§11.4 "Kleinteile"); single pieces (tools, weapons, armour) need E. */
export function isSmallItem(def: ItemDef): boolean {
  return def.stapel > 1;
}

/** Magnet radius [px]: the base radius of §11.4 plus the `magnetradius` stat of worn jewellery [tiles]. */
export function magnetRadiusPx(bonusTiles: number): number {
  return (I.magnetRadiusTiles + Math.max(0, bonusTiles)) * TILE_PX;
}

/** A point [px]. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Landing spot of a drop thrown from (x, y) at `angle` [rad] over `distance` [px], written into `out`.
 * Angle and distance come from the caller's random stream.
 */
export function landingSpot(x: number, y: number, angle: number, distance: number, out: Point): Point {
  out.x = x + Math.cos(angle) * distance;
  out.y = y + Math.sin(angle) * distance;
  return out;
}

/** Landing distance [px] for a uniform random number `u` ∈ [0, 1): between `landingMinTiles` and `landingMaxTiles`. */
export function landingDistancePx(u: number): number {
  const d = I.drops;
  return (d.landingMinTiles + (d.landingMaxTiles - d.landingMinTiles) * u) * TILE_PX;
}

/** Position on the flight from (fx, fy) to (tx, ty) after `t` ∈ [0, 1] of it (ground track, linear). */
export function flightPoint(fx: number, fy: number, tx: number, ty: number, t: number, out: Point): Point {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = fx + (tx - fx) * k;
  out.y = fy + (ty - fy) * k;
  return out;
}

/**
 * Height of the flight arc above the ground track after `t` ∈ [0, 1] [share of the peak]: a parabola,
 * 0 at start and landing, 1 at half time (the presentation scales it to pixels).
 */
export function flightArc(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return PARABOLA_PEAK_NORM * k * (1 - k);
}

/** 1 / max(t(1 − t)) on [0, 1]: scales the parabola to a peak of 1 at t = ½. */
const PARABOLA_PEAK_NORM = 4;

/**
 * One magnet step: moves `p` towards (tx, ty) by at most `stepPx`. Returns the remaining distance [px]
 * (0 when it arrived).
 */
export function magnetStep(p: Point, tx: number, ty: number, stepPx: number): number {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= stepPx) {
    p.x = tx;
    p.y = ty;
    return 0;
  }
  p.x += (dx / d) * stepPx;
  p.y += (dy / d) * stepPx;
  return d - stepPx;
}
