/**
 * Small math toolkit for the simulation and presentation (MASTERPROMPT §3.3 "Kollision").
 *
 * Vectors are plain `{ x, y }` objects; every vector operation writes into a caller provided
 * `out` so hot loops do not allocate. Intersection tests use strict inequalities: shapes that
 * merely touch do not overlap. Lengths use `Math.sqrt` (correctly rounded by IEEE 754, so
 * identical in every engine) instead of `Math.hypot` (implementation defined and slower).
 */

/** Full turn in radians. */
export const TAU = Math.PI * 2;
/** Tolerance for degenerate geometry (zero length vectors, parallel rays). */
export const GEOM_EPSILON = 1e-9;

/** Mutable 2D vector. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Axis aligned bounding box (min ≤ max on both axes). */
export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Result of a swept test: time of impact in [0, 1] and the surface normal at impact. */
export interface SweepHit {
  t: number;
  nx: number;
  ny: number;
}

// ---------------------------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------------------------

/** Clamps `v` into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Clamps `v` into [0, 1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear interpolation from `a` to `b` by `t` (not clamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of `lerp`: where `v` lies between `a` and `b` (0 when `a === b`, not clamped). */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Maps `v` from [inMin, inMax] to [outMin, outMax] (not clamped). */
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, invLerp(inMin, inMax, v));
}

/** Hermite smoothstep of `x` between the two edges, result in [0, 1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Fractional part, always in [0, 1) (also for negative inputs). */
export function fract(v: number): number {
  const f = v - Math.floor(v);
  // Tiny negative inputs (e.g. -1e-20) round `1 - ε` up to exactly 1.
  return f < 1 ? f : 0;
}

/** Modulo with the sign of the divisor: `mod(-1, 4) === 3`. The result never equals `n`. */
export function mod(a: number, n: number): number {
  const r = a % n;
  if (r === 0 || r < 0 === n < 0) return r + 0;
  const m = r + n;
  // A tiny remainder of the opposite sign can round `r + n` to exactly `n`.
  return m === n ? 0 : m;
}

/** Integer division rounding towards negative infinity: `floorDiv(-1, 32) === -1`. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Moves `current` towards `target` by at most `maxDelta` (never overshoots). */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

/** Sign that returns 0 for 0 (and for -0). */
export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Whether two numbers are within `eps` of each other. */
export function nearlyEqual(a: number, b: number, eps = GEOM_EPSILON): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------------------------

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  // `w` is in [-π, π); map -π to π so the range is (-π, π].
  return w <= -Math.PI ? w + TAU : w;
}

/** Shortest signed rotation from `from` to `to`, in (-π, π]. */
export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Interpolates angles along the shortest arc. The result is wrapped into (-π, π]. */
export function angleLerp(from: number, to: number, t: number): number {
  return wrapAngle(from + angleDiff(from, to) * t);
}

/** Rotates `current` towards `target` by at most `maxDelta` radians along the shortest arc. */
export function angleApproach(current: number, target: number, maxDelta: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxDelta);
}

// ---------------------------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------------------------

/** Euclidean distance between two points. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance between two points (cheap, for comparisons). */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------------------------
// Vec2 (in place helpers)
// ---------------------------------------------------------------------------------------------

/** Allocates a new vector (use outside hot loops). */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/** out = (x, y) */
export function v2Set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

/** out = a */
export function v2Copy(out: Vec2, a: Readonly<Vec2>): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

/** out = a + b */
export function v2Add(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

/** out = a - b */
export function v2Sub(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

/** out = a * s */
export function v2Scale(out: Vec2, a: Readonly<Vec2>, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** out = a + b * s */
export function v2AddScaled(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>, s: number): Vec2 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  return out;
}

/** Dot product. */
export function v2Dot(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (z component of the 3D cross product). */
export function v2Cross(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.y - a.y * b.x;
}

/** Length. */
export function v2Len(a: Readonly<Vec2>): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

/** Squared length. */
export function v2Len2(a: Readonly<Vec2>): number {
  return a.x * a.x + a.y * a.y;
}

/** Distance between two vectors. */
export function v2Dist(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** out = a / |a|; a zero vector stays zero. */
export function v2Normalize(out: Vec2, a: Readonly<Vec2>): Vec2 {
  const len = Math.sqrt(a.x * a.x + a.y * a.y);
  if (len < GEOM_EPSILON) return v2Set(out, 0, 0);
  out.x = a.x / len;
  out.y = a.y / len;
  return out;
}

/** Scales `a` down so its length is at most `maxLen`. */
export function v2ClampLen(out: Vec2, a: Readonly<Vec2>, maxLen: number): Vec2 {
  const len2 = a.x * a.x + a.y * a.y;
  if (len2 <= maxLen * maxLen) return v2Copy(out, a);
  const s = maxLen / Math.sqrt(len2);
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** out = lerp(a, b, t) */
export function v2Lerp(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** out = a rotated by `angle` radians (counter clockwise in a y-up frame). */
export function v2Rotate(out: Vec2, a: Readonly<Vec2>, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = a.x * c - a.y * s;
  const y = a.x * s + a.y * c;
  out.x = x;
  out.y = y;
  return out;
}

/** out = unit vector at `angle`, scaled by `len`. */
export function v2FromAngle(out: Vec2, angle: number, len = 1): Vec2 {
  out.x = Math.cos(angle) * len;
  out.y = Math.sin(angle) * len;
  return out;
}

/** Angle of a vector in (-π, π]. */
export function v2Angle(a: Readonly<Vec2>): number {
  return Math.atan2(a.y, a.x);
}

// ---------------------------------------------------------------------------------------------
// AABB & circles
// ---------------------------------------------------------------------------------------------

/** Allocates a new AABB. */
export function aabb(minX: number, minY: number, maxX: number, maxY: number): Aabb {
  return { minX, minY, maxX, maxY };
}

/** Writes an AABB from a center and half extents into `out`. */
export function aabbFromCenter(out: Aabb, cx: number, cy: number, halfW: number, halfH: number): Aabb {
  out.minX = cx - halfW;
  out.minY = cy - halfH;
  out.maxX = cx + halfW;
  out.maxY = cy + halfH;
  return out;
}

/** Whether two AABBs overlap (touching edges do not count). */
export function aabbOverlap(a: Readonly<Aabb>, b: Readonly<Aabb>): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** Whether a point lies inside an AABB (min inclusive, max exclusive). */
export function aabbContains(box: Readonly<Aabb>, x: number, y: number): boolean {
  return x >= box.minX && x < box.maxX && y >= box.minY && y < box.maxY;
}

/** Closest point of `box` to (x, y), written into `out`. */
export function aabbClosestPoint(out: Vec2, box: Readonly<Aabb>, x: number, y: number): Vec2 {
  out.x = clamp(x, box.minX, box.maxX);
  out.y = clamp(y, box.minY, box.maxY);
  return out;
}

/** Whether two circles overlap (touching does not count). */
export function circleOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const r = ar + br;
  return dist2(ax, ay, bx, by) < r * r;
}

/** Whether a circle overlaps an AABB (touching does not count). */
export function circleAabbOverlap(cx: number, cy: number, r: number, box: Readonly<Aabb>): boolean {
  const px = clamp(cx, box.minX, box.maxX);
  const py = clamp(cy, box.minY, box.maxY);
  return dist2(cx, cy, px, py) < r * r;
}

/**
 * Minimal translation that pushes a circle out of an AABB. Writes the push vector into `out` and
 * returns `true` when they overlap; returns `false` (and zeroes `out`) otherwise.
 */
export function circleAabbPenetration(out: Vec2, cx: number, cy: number, r: number, box: Readonly<Aabb>): boolean {
  const px = clamp(cx, box.minX, box.maxX);
  const py = clamp(cy, box.minY, box.maxY);
  const dx = cx - px;
  const dy = cy - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) {
    v2Set(out, 0, 0);
    return false;
  }
  if (d2 > GEOM_EPSILON * GEOM_EPSILON) {
    const d = Math.sqrt(d2);
    const push = r - d;
    v2Set(out, (dx / d) * push, (dy / d) * push);
    return true;
  }
  // Center inside the box: leave through the nearest face.
  const left = cx - box.minX;
  const right = box.maxX - cx;
  const top = cy - box.minY;
  const bottom = box.maxY - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) v2Set(out, -(left + r), 0);
  else if (m === right) v2Set(out, right + r, 0);
  else if (m === top) v2Set(out, 0, -(top + r));
  else v2Set(out, 0, bottom + r);
  return true;
}

/**
 * Earliest time t ∈ [0, 1] at which a ray from (ox, oy) along (dx, dy) hits a circle of radius
 * `r` at (cx, cy). Returns -1 for no hit. Starting inside the circle returns 0.
 */
export function rayCircleToi(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const mx = ox - cx;
  const my = oy - cy;
  const c = mx * mx + my * my - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < GEOM_EPSILON) return -1;
  const b = mx * dx + my * dy;
  if (b >= 0) return -1; // moving away
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Swept circle vs. AABB (continuous collision for fast projectiles). The circle of radius `r`
 * moves from (cx, cy) by (dx, dy) during one step. On a hit, writes the time of impact
 * t ∈ [0, 1] and the surface normal into `out` and returns `true`. A circle that already
 * overlaps the box reports t = 0 with the normal pointing from the box towards the circle.
 *
 * Exact against the Minkowski sum (rounded rectangle): slab test against the box expanded by
 * `r`, then a corner circle test when the entry point lies in a corner region.
 */
export function sweepCircleAabb(
  cx: number,
  cy: number,
  r: number,
  dx: number,
  dy: number,
  box: Readonly<Aabb>,
  out: SweepHit,
): boolean {
  // Already overlapping?
  const qx = clamp(cx, box.minX, box.maxX);
  const qy = clamp(cy, box.minY, box.maxY);
  const ox = cx - qx;
  const oy = cy - qy;
  const o2 = ox * ox + oy * oy;
  if (o2 < r * r) {
    out.t = 0;
    if (o2 > GEOM_EPSILON * GEOM_EPSILON) {
      const d = Math.sqrt(o2);
      out.nx = ox / d;
      out.ny = oy / d;
    } else {
      const bx = (box.minX + box.maxX) * 0.5;
      const by = (box.minY + box.maxY) * 0.5;
      const hx = (box.maxX - box.minX) * 0.5;
      const hy = (box.maxY - box.minY) * 0.5;
      const px = (cx - bx) / (hx > GEOM_EPSILON ? hx : 1);
      const py = (cy - by) / (hy > GEOM_EPSILON ? hy : 1);
      if (Math.abs(px) >= Math.abs(py)) {
        out.nx = px < 0 ? -1 : 1;
        out.ny = 0;
      } else {
        out.nx = 0;
        out.ny = py < 0 ? -1 : 1;
      }
    }
    return true;
  }

  // Slab test against the box expanded by r.
  const exMinX = box.minX - r;
  const exMaxX = box.maxX + r;
  const exMinY = box.minY - r;
  const exMaxY = box.maxY + r;
  let tEnter = -Infinity;
  let tExit = Infinity;
  let nx = 0;
  let ny = 0;
  if (Math.abs(dx) < GEOM_EPSILON) {
    if (cx <= exMinX || cx >= exMaxX) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (exMinX - cx) * inv;
    let t2 = (exMaxX - cx) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      nx = n;
      ny = 0;
    }
    if (t2 < tExit) tExit = t2;
  }
  if (Math.abs(dy) < GEOM_EPSILON) {
    if (cy <= exMinY || cy >= exMaxY) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (exMinY - cy) * inv;
    let t2 = (exMaxY - cy) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tExit) tExit = t2;
  }
  if (tEnter > tExit || tExit < 0 || tEnter > 1) return false;

  // Where does the swept center enter the expanded box? In a corner region the true shape is
  // the rounded corner, so test the corner circle instead.
  const te = tEnter > 0 ? tEnter : 0;
  const hx = cx + dx * te;
  const hy = cy + dy * te;
  const outsideX = hx < box.minX ? box.minX : hx > box.maxX ? box.maxX : NaN;
  const outsideY = hy < box.minY ? box.minY : hy > box.maxY ? box.maxY : NaN;
  if (!Number.isNaN(outsideX) && !Number.isNaN(outsideY)) {
    const t = rayCircleToi(cx, cy, dx, dy, outsideX, outsideY, r);
    if (t < 0) return false;
    const px = cx + dx * t - outsideX;
    const py = cy + dy * t - outsideY;
    const len = Math.sqrt(px * px + py * py);
    out.t = t;
    out.nx = len > GEOM_EPSILON ? px / len : 0;
    out.ny = len > GEOM_EPSILON ? py / len : 0;
    return true;
  }
  // A start inside the expanded box is either an overlap (handled first) or a corner region
  // (handled above); anything left here is a numerical grazing case.
  if (tEnter < 0) return false;
  out.t = tEnter;
  out.nx = nx;
  out.ny = ny;
  return true;
}
