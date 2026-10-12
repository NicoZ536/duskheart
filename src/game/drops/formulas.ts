/**
 * Pure formulas of dropped items (MASTERPROMPT §11.4 "Aufheben: Kleinteile im Radius 1,5 Tiles
 * automatisch (Magnet), sonst E", §14 "fliegende Drops mit Magnet"; M3-10).
 */
import { BALANCE } from '../../content/balance';
import { createHypotRegister, createSinCosRegister, HYPOT_LENGTH, HYPOT_X, HYPOT_Y, hypotIn, SIN_COS_ANGLE, SIN_COS_COS, SIN_COS_SIN, sinCosIn } from '../../engine/portableMath';
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

/** Register of the portable sine and cosine of `landingSpot` (M7-76). */
const LANDING_TRIG = createSinCosRegister();
/** Register of the portable distance (M7-139): every pulled drop's magnet step, every tick. */
const MAGNET_LENGTH = createHypotRegister();

/**
 * Landing spot of a drop thrown from (x, y) at `angle` [rad] over `distance` [px], written into `out`.
 * Angle and distance come from the caller's random stream.
 */
export function landingSpot(x: number, y: number, angle: number, distance: number, out: Point): Point {
  LANDING_TRIG[SIN_COS_ANGLE] = angle;
  sinCosIn(LANDING_TRIG);
  out.x = x + (LANDING_TRIG[SIN_COS_COS] as number) * distance;
  out.y = y + (LANDING_TRIG[SIN_COS_SIN] as number) * distance;
  return out;
}

/** Landing distance [px] for a uniform random number `u` ∈ [0, 1): between `landingMinTiles` and `landingMaxTiles`. */
export function landingDistancePx(u: number): number {
  const d = I.drops;
  return (d.landingMinTiles + (d.landingMaxTiles - d.landingMinTiles) * u) * TILE_PX;
}

/** A flight as `dropFlightPointIn` reads it (the fields of a `DropState`): start, target and progress in ticks. */
export interface DropFlight {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly flightTicks: number;
  readonly flightTotal: number;
}

/**
 * Position on the flight `d` after `flightTicks / flightTotal` of it (ground track, linear), written into `out`: the
 * drops system's form of `flightPoint` – the drop itself goes through the call, no fractional number (ADR-0274, M7-151).
 */
export function dropFlightPointIn(d: DropFlight, out: Point): void {
  const t = d.flightTicks / d.flightTotal;
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = d.fromX + (d.toX - d.fromX) * k;
  out.y = d.fromY + (d.toY - d.fromY) * k;
}

/** The flight `flightPoint` hands to `dropFlightPointIn` (progress `t` as `t / 1` ticks). */
const FLIGHT_SCRATCH = { fromX: 0, fromY: 0, toX: 0, toY: 0, flightTicks: 0, flightTotal: 1 };

/** Position on the flight from (fx, fy) to (tx, ty) after `t` ∈ [0, 1] of it (ground track, linear). */
export function flightPoint(fx: number, fy: number, tx: number, ty: number, t: number, out: Point): Point {
  const f = FLIGHT_SCRATCH;
  f.fromX = fx;
  f.fromY = fy;
  f.toX = tx;
  f.toY = ty;
  f.flightTicks = t;
  f.flightTotal = 1;
  dropFlightPointIn(f, out);
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

/** Register of `magnetStepIn`: the step [px] in, the remaining distance [px] out. */
export const MAGNET_STEP = 0;
export const MAGNET_LEFT = 1;
export function createMagnetRegister(): Float64Array {
  return new Float64Array(2);
}

/**
 * One magnet step: moves `p` towards `target` by at most `r[MAGNET_STEP]` px; the remaining distance [px] (0 when it
 * arrived) goes into `r[MAGNET_LEFT]`. The drops system's form of `magnetStep`: points and a register through the call,
 * no fractional number (ADR-0274, M7-151).
 */
export function magnetStepIn(p: Point, target: Point, r: Float64Array): void {
  const tx = target.x;
  const ty = target.y;
  const stepPx = r[MAGNET_STEP] as number;
  const dx = tx - p.x;
  const dy = ty - p.y;
  MAGNET_LENGTH[HYPOT_X] = dx;
  MAGNET_LENGTH[HYPOT_Y] = dy;
  hypotIn(MAGNET_LENGTH);
  const d = MAGNET_LENGTH[HYPOT_LENGTH] as number;
  if (d <= stepPx) {
    p.x = tx;
    p.y = ty;
    r[MAGNET_LEFT] = 0;
    return;
  }
  p.x += (dx / d) * stepPx;
  p.y += (dy / d) * stepPx;
  r[MAGNET_LEFT] = d - stepPx;
}

/** The target and register `magnetStep` hands to `magnetStepIn`. */
const MAGNET_TARGET: Point = { x: 0, y: 0 };
const MAGNET_SCALARS = createMagnetRegister();

/**
 * One magnet step: moves `p` towards (tx, ty) by at most `stepPx`. Returns the remaining distance [px]
 * (0 when it arrived).
 */
export function magnetStep(p: Point, tx: number, ty: number, stepPx: number): number {
  MAGNET_TARGET.x = tx;
  MAGNET_TARGET.y = ty;
  MAGNET_SCALARS[MAGNET_STEP] = stepPx;
  magnetStepIn(p, MAGNET_TARGET, MAGNET_SCALARS);
  return MAGNET_SCALARS[MAGNET_LEFT] as number;
}
