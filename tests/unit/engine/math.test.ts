import { describe, expect, it } from 'vitest';
import {
  TAU,
  aabb,
  aabbClosestPoint,
  aabbContains,
  aabbFromCenter,
  aabbOverlap,
  angleApproach,
  angleDiff,
  angleLerp,
  approach,
  circleAabbOverlap,
  circleAabbPenetration,
  circleOverlap,
  clamp,
  clamp01,
  dist,
  dist2,
  floorDiv,
  fract,
  invLerp,
  lerp,
  mod,
  nearlyEqual,
  rayCircleToi,
  remap,
  sign,
  smoothstep,
  sweepCircleAabb,
  v2Add,
  v2AddScaled,
  v2Angle,
  v2ClampLen,
  v2Copy,
  v2Cross,
  v2Dist,
  v2Dot,
  v2FromAngle,
  v2Len,
  v2Len2,
  v2Lerp,
  v2Normalize,
  v2Rotate,
  v2Scale,
  v2Set,
  v2Sub,
  vec2,
  wrapAngle,
  type SweepHit,
} from '../../../src/engine/math';

describe('scalars', () => {
  it('clamp / lerp / invLerp / remap / smoothstep', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(clamp01(1.5)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(invLerp(10, 20, 12.5)).toBe(0.25);
    expect(invLerp(3, 3, 7)).toBe(0);
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 12);
  });

  it('fract / mod / floorDiv handle negatives', () => {
    expect(fract(1.25)).toBe(0.25);
    expect(fract(-0.25)).toBe(0.75);
    expect(mod(-1, 4)).toBe(3);
    expect(mod(5, 4)).toBe(1);
    expect(mod(-4, 4)).toBe(0);
    expect(Object.is(mod(-4, 4), -0)).toBe(false);
    expect(mod(5.5, 2)).toBe(1.5);
    expect(floorDiv(-1, 32)).toBe(-1);
    expect(floorDiv(-32, 32)).toBe(-1);
    expect(floorDiv(-33, 32)).toBe(-2);
    expect(floorDiv(31, 32)).toBe(0);
  });

  it('fract and mod never return the upper bound for tiny negative inputs', () => {
    expect(fract(-1e-20)).toBe(0);
    expect(fract(-Number.MIN_VALUE)).toBe(0);
    for (const v of [-1e-17, -1e-300, -3.0000000000000004, 1 - 1e-17]) {
      const f = fract(v);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(mod(-1e-20, 4)).toBe(0);
    expect(mod(1e-20, -4)).toBe(0);
    for (const n of [4, 32, 0.1, 360]) {
      for (const a of [-1e-18, -1e-300, -n * 3 - 1e-15]) {
        const m = mod(a, n);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThan(n);
      }
    }
  });

  it('approach never overshoots', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(10, 0, 4)).toBe(6);
    expect(approach(1, 0, 4)).toBe(0);
    expect(approach(5, 5, 1)).toBe(5);
  });

  it('sign and nearlyEqual', () => {
    expect(sign(-3)).toBe(-1);
    expect(sign(0)).toBe(0);
    expect(sign(-0)).toBe(0);
    expect(sign(2)).toBe(1);
    expect(nearlyEqual(1, 1 + 1e-12)).toBe(true);
    expect(nearlyEqual(1, 1.1, 0.05)).toBe(false);
  });
});

describe('angles', () => {
  it('wrapAngle maps into (-π, π]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(TAU + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(-TAU - 0.5)).toBeCloseTo(-0.5, 12);
    for (let a = -20; a < 20; a += 0.37) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
    }
  });

  it('angleDiff takes the shortest way', () => {
    expect(angleDiff(0.1, TAU - 0.1)).toBeCloseTo(-0.2, 12);
    expect(angleDiff(TAU - 0.1, 0.1)).toBeCloseTo(0.2, 12);
    expect(angleDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('angleLerp crosses the seam', () => {
    const mid = angleLerp(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(mid)).toBeCloseTo(Math.PI, 9);
    expect(angleLerp(0, 1, 0.25)).toBeCloseTo(0.25, 12);
  });

  it('angleApproach limits the rotation', () => {
    expect(angleApproach(0, 1, 0.25)).toBeCloseTo(0.25, 12);
    expect(angleApproach(0, 0.1, 0.25)).toBeCloseTo(0.1, 12);
    expect(angleApproach(Math.PI - 0.05, -Math.PI + 0.05, 0.05)).toBeCloseTo(Math.PI, 9);
  });
});

describe('distances and Vec2', () => {
  it('dist / dist2', () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
    expect(dist2(1, 1, 4, 5)).toBe(25);
  });

  it('in-place vector operations write into out', () => {
    const a = vec2(3, 4);
    const b = vec2(1, 2);
    const out = vec2();
    expect(v2Add(out, a, b)).toBe(out);
    expect(out).toEqual({ x: 4, y: 6 });
    expect(v2Sub(out, a, b)).toEqual({ x: 2, y: 2 });
    expect(v2Scale(out, a, 2)).toEqual({ x: 6, y: 8 });
    expect(v2AddScaled(out, a, b, 3)).toEqual({ x: 6, y: 10 });
    expect(v2Copy(out, b)).toEqual({ x: 1, y: 2 });
    expect(v2Set(out, 7, 8)).toEqual({ x: 7, y: 8 });
    expect(v2Dot(a, b)).toBe(11);
    expect(v2Cross(a, b)).toBe(2);
    expect(v2Len(a)).toBe(5);
    expect(v2Len2(a)).toBe(25);
    expect(v2Dist(a, b)).toBeCloseTo(Math.hypot(2, 2), 12);
    expect(v2Lerp(out, a, b, 0.5)).toEqual({ x: 2, y: 3 });
  });

  it('normalize, clampLen, rotate, fromAngle, angle', () => {
    const out = vec2();
    v2Normalize(out, vec2(3, 4));
    expect(out.x).toBeCloseTo(0.6, 12);
    expect(out.y).toBeCloseTo(0.8, 12);
    expect(v2Normalize(out, vec2(0, 0))).toEqual({ x: 0, y: 0 });
    v2ClampLen(out, vec2(30, 40), 5);
    expect(v2Len(out)).toBeCloseTo(5, 12);
    expect(v2ClampLen(out, vec2(1, 1), 5)).toEqual({ x: 1, y: 1 });
    const v = vec2(1, 0);
    v2Rotate(v, v, Math.PI / 2);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    v2FromAngle(out, Math.PI, 2);
    expect(out.x).toBeCloseTo(-2, 12);
    expect(v2Angle(vec2(0, 1))).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('intersection tests', () => {
  const box = aabb(0, 0, 10, 10);

  it('aabb overlap / contains / closest point', () => {
    expect(aabbOverlap(box, aabb(5, 5, 15, 15))).toBe(true);
    expect(aabbOverlap(box, aabb(10, 0, 20, 10))).toBe(false); // touching
    expect(aabbOverlap(box, aabb(-5, -5, -1, -1))).toBe(false);
    expect(aabbOverlap(box, aabb(2, 2, 3, 3))).toBe(true); // contained
    expect(aabbContains(box, 0, 0)).toBe(true);
    expect(aabbContains(box, 10, 5)).toBe(false);
    expect(aabbClosestPoint(vec2(), box, -5, 20)).toEqual({ x: 0, y: 10 });
    expect(aabbFromCenter(aabb(0, 0, 0, 0), 5, 5, 2, 3)).toEqual({ minX: 3, minY: 2, maxX: 7, maxY: 8 });
  });

  it('circle-circle and circle-aabb', () => {
    expect(circleOverlap(0, 0, 1, 1.5, 0, 1)).toBe(true);
    expect(circleOverlap(0, 0, 1, 2, 0, 1)).toBe(false);
    expect(circleAabbOverlap(-0.5, 5, 1, box)).toBe(true);
    expect(circleAabbOverlap(-1, 5, 1, box)).toBe(false);
    // Near a corner: the diagonal distance counts, not the box extent.
    expect(circleAabbOverlap(-0.8, -0.8, 1, box)).toBe(false);
    expect(circleAabbOverlap(-0.6, -0.6, 1, box)).toBe(true);
    expect(circleAabbOverlap(5, 5, 0.1, box)).toBe(true);
  });

  it('circle-aabb penetration pushes the circle out', () => {
    const out = vec2();
    expect(circleAabbPenetration(out, -0.5, 5, 1, box)).toBe(true);
    expect(out.x).toBeCloseTo(-0.5, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(circleAabbPenetration(out, 5, 9, 1, box)).toBe(true);
    expect(out).toEqual({ x: 0, y: 2 });
    expect(circleAabbPenetration(out, 1, 5, 1, box)).toBe(true);
    expect(out).toEqual({ x: -2, y: 0 });
    expect(circleAabbPenetration(out, -5, 5, 1, box)).toBe(false);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('rayCircleToi', () => {
    expect(rayCircleToi(-10, 0, 20, 0, 0, 0, 1)).toBeCloseTo(0.45, 12);
    expect(rayCircleToi(-10, 5, 20, 0, 0, 0, 1)).toBe(-1);
    expect(rayCircleToi(10, 0, 20, 0, 0, 0, 1)).toBe(-1);
    expect(rayCircleToi(0.5, 0, 1, 0, 0, 0, 1)).toBe(0);
    expect(rayCircleToi(-10, 0, 5, 0, 0, 0, 1)).toBe(-1); // does not reach within t ≤ 1
  });
});

describe('sweepCircleAabb', () => {
  const box = aabb(0, 0, 10, 10);
  const hit: SweepHit = { t: -1, nx: 0, ny: 0 };

  it('hits a face with the right time and normal', () => {
    expect(sweepCircleAabb(-10, 5, 1, 20, 0, box, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(9 / 20, 12);
    expect(hit.nx).toBe(-1);
    expect(hit.ny).toBe(0);
    expect(sweepCircleAabb(5, 30, 2, 0, -40, box, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(18 / 40, 12);
    expect(hit.nx).toBe(0);
    expect(hit.ny).toBe(1);
  });

  it('misses when the path passes by or stops short', () => {
    expect(sweepCircleAabb(-10, 12, 1, 20, 0, box, hit)).toBe(false);
    expect(sweepCircleAabb(-10, 5, 1, 5, 0, box, hit)).toBe(false);
    expect(sweepCircleAabb(-10, 5, 1, -20, 0, box, hit)).toBe(false);
    expect(sweepCircleAabb(-10, 5, 1, 0, 0, box, hit)).toBe(false);
  });

  it('uses the rounded corner, not the expanded box corner', () => {
    // Passes through the expanded corner square but outside the corner circle.
    // Line x + y = -1.6 crosses the square [-1, 0]² at distance 1.13 > r from the corner.
    expect(sweepCircleAabb(-2.6, 1, 1, 3.6, -3.6, box, hit)).toBe(false);
    // Same line shifted to x + y = -1.2 (distance 0.85 < r) hits the corner circle.
    expect(sweepCircleAabb(-2.2, 1, 1, 3.6, -3.6, box, hit)).toBe(true);
    expect(hit.nx).toBeLessThan(0);
    expect(hit.ny).toBeLessThan(0);
    // Diagonal approach to the corner (0,0): center must stop at distance r from the corner.
    expect(sweepCircleAabb(-5, -5, 1, 10, 10, box, hit)).toBe(true);
    const cx = -5 + 10 * hit.t;
    const cy = -5 + 10 * hit.t;
    expect(Math.hypot(cx, cy)).toBeCloseTo(1, 9);
    expect(hit.nx).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(hit.ny).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('agrees with brute force sampling (tunneling check for fast projectiles)', () => {
    const r = 0.5;
    for (let k = 0; k < 200; k++) {
      const sx = -20 + (k % 20) * 0.37;
      const sy = -15 + Math.floor(k / 20) * 3.1;
      const dx = 30 + (k % 7);
      const dy = 12 - (k % 11) * 1.9;
      const hitFound = sweepCircleAabb(sx, sy, r, dx, dy, box, hit);
      let first = -1;
      const steps = 4000;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (circleAabbOverlap(sx + dx * t, sy + dy * t, r, box)) {
          first = t;
          break;
        }
      }
      if (first < 0) expect(hitFound).toBe(false);
      else {
        expect(hitFound).toBe(true);
        expect(Math.abs(hit.t - first)).toBeLessThanOrEqual(1 / steps + 1e-9);
      }
    }
  });

  it('reports t = 0 when already overlapping', () => {
    expect(sweepCircleAabb(-0.5, 5, 1, 10, 0, box, hit)).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.nx).toBe(-1);
    expect(sweepCircleAabb(5, 9, 1, 1, 0, box, hit)).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.ny).toBe(1);
  });
});
