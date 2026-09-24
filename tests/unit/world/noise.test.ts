/**
 * M2-01: noise and sampling library for world generation. Hash snapshots pin every generator bit for
 * bit (a changed bit would silently change every generated world), the Poisson tests check the
 * minimum distance, maximal coverage and mask, the blue-noise tests the rank permutation, spacing
 * and seamless wrap.
 */
import { describe, expect, it } from 'vitest';
import { fnv1a64Hex } from '../../../src/engine/binary';
import { createSimplex2, createSimplex3, createValueNoise2, domainWarp, fbm, ridged, type Noise2 } from '../../../src/engine/noise';
import { Rng } from '../../../src/engine/rng';
import { BLUE_NOISE_MAX_SIZE, BLUE_NOISE_MIN_SIZE, blueNoiseAt, createBlueNoiseTile, poissonDisc, type PointSet } from '../../../src/world/gen/sampling';

const SEED = 20260924;

/** Hash of a 64×64 sample grid (offset, non-lattice coordinates). */
function gridHash(fn: Noise2): string {
  const a = new Float64Array(64 * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) a[y * 64 + x] = fn(x * 0.173 - 5.1, y * 0.219 + 3.7);
  return fnv1a64Hex(a);
}

/** Smallest pairwise distance of a point set (brute force). */
function minPairDistance(p: PointSet): number {
  let best = Infinity;
  for (let i = 0; i < p.count; i++) {
    for (let j = i + 1; j < p.count; j++) {
      const dx = (p.xs[i] as number) - (p.xs[j] as number);
      const dy = (p.ys[i] as number) - (p.ys[j] as number);
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
    }
  }
  return best;
}

/** Distance from (x, y) to the nearest point. */
function nearest(p: PointSet, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < p.count; i++) best = Math.min(best, Math.hypot((p.xs[i] as number) - x, (p.ys[i] as number) - y));
  return best;
}

describe('noise hash snapshots (world generation depends on these staying bit-identical)', () => {
  const s2 = createSimplex2(SEED);
  const s3 = createSimplex3(SEED);
  const v2 = createValueNoise2(SEED);
  const out = { x: 0, y: 0 };

  it('simplex 2D/3D and value noise', () => {
    expect(gridHash(s2)).toBe('fd8d429f111e09b2');
    expect(gridHash((x, y) => s3(x, y, x * 0.3 - y * 0.7))).toBe('5997e2b0ee0318e4');
    expect(gridHash(v2)).toBe('faa472511705c9e1');
  });

  it('fBm, ridged and domain warp', () => {
    expect(gridHash((x, y) => fbm(s2, x, y, { octaves: 6, frequency: 0.37 }))).toBe('4edb8cacc06d0e4a');
    expect(gridHash((x, y) => ridged(v2, x, y, { octaves: 4, frequency: 0.5, gain: 0.6 }))).toBe('2c2a0da56c7db9a3');
    expect(
      gridHash((x, y) => {
        domainWarp(s2, x, y, 3, 0.21, out);
        return out.x * 1000 + out.y;
      }),
    ).toBe('97d1c8e64a0cdccc');
  });

  it('different seeds give different fields', () => {
    expect(gridHash(createSimplex2(SEED + 1))).not.toBe(gridHash(s2));
    expect(gridHash(createValueNoise2(SEED + 1))).not.toBe(gridHash(v2));
  });
});

describe('poissonDisc', () => {
  it('is deterministic for an Rng state (hash snapshot)', () => {
    const a = poissonDisc(new Rng(2024), 1536, 1536, 150);
    const b = poissonDisc(new Rng(2024), 1536, 1536, 150);
    expect(a.count).toBe(72);
    expect(fnv1a64Hex(a.xs, a.ys)).toBe('9051871d4e44835f');
    expect(fnv1a64Hex(b.xs, b.ys)).toBe(fnv1a64Hex(a.xs, a.ys));
    const small = poissonDisc(new Rng(7), 256, 128, 6.5);
    expect(small.count).toBe(506);
    expect(fnv1a64Hex(small.xs, small.ys)).toBe('b18e64eb5ab63284');
    expect(fnv1a64Hex(poissonDisc(new Rng(2025), 1536, 1536, 150).xs)).not.toBe(fnv1a64Hex(a.xs));
  });

  it('keeps the minimum distance and stays inside the area', () => {
    for (const [seed, w, h, r] of [
      [1, 1536, 1536, 150],
      [2, 1024, 1024, 120],
      [3, 300, 200, 7],
      [4, 64, 64, 1.5],
    ] as const) {
      const p = poissonDisc(new Rng(seed), w, h, r);
      expect(p.count).toBeGreaterThan(0);
      expect(minPairDistance(p)).toBeGreaterThanOrEqual(r);
      for (let i = 0; i < p.count; i++) {
        expect(p.xs[i]).toBeGreaterThanOrEqual(0);
        expect(p.xs[i]).toBeLessThan(w);
        expect(p.ys[i]).toBeGreaterThanOrEqual(0);
        expect(p.ys[i]).toBeLessThan(h);
      }
    }
  });

  it('covers the area: every position lies within 2r of a point (maximal set)', () => {
    const r = 9;
    const p = poissonDisc(new Rng(11), 400, 300, r);
    const probe = new Rng(12);
    for (let k = 0; k < 2000; k++) expect(nearest(p, probe.float(0, 400), probe.float(0, 300))).toBeLessThanOrEqual(2 * r);
    // Density of a maximal Poisson-disc set: between the loose packing bound and hexagonal packing.
    const perArea = (p.count * r * r) / (400 * 300);
    expect(perArea).toBeGreaterThan(0.5);
    expect(perArea).toBeLessThan(1.16);
  });

  it('respects an acceptance mask and reaches disconnected parts of it', () => {
    // Two separate discs 600 apart: the growth front cannot jump the gap, gap filling must seed both.
    const inside = (x: number, y: number): boolean => Math.hypot(x - 200, y - 200) < 120 || Math.hypot(x - 800, y - 200) < 60;
    const p = poissonDisc(new Rng(5), 1000, 400, 25, { accept: inside });
    let left = 0;
    let right = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.xs[i] as number;
      const y = p.ys[i] as number;
      expect(inside(x, y)).toBe(true);
      if (x < 500) left++;
      else right++;
    }
    expect(left).toBeGreaterThan(10);
    expect(right).toBeGreaterThan(2);
    expect(minPairDistance(p)).toBeGreaterThanOrEqual(25);
    // Without gap filling only the component of the first point is sampled.
    const single = poissonDisc(new Rng(5), 1000, 400, 25, { accept: inside, fillGaps: false });
    const sides = new Set(Array.from(single.xs, (x) => x < 500));
    expect(sides.size).toBe(1);
  });

  it('returns an empty set when the mask accepts nothing and rejects invalid input', () => {
    expect(poissonDisc(new Rng(1), 100, 100, 10, { accept: () => false }).count).toBe(0);
    expect(() => poissonDisc(new Rng(1), 0, 10, 1)).toThrow(RangeError);
    expect(() => poissonDisc(new Rng(1), 10, 10, 0)).toThrow(RangeError);
    expect(() => poissonDisc(new Rng(1), 10, 10, 1, { attempts: 0 })).toThrow(RangeError);
  });
});

describe('blue noise tile', () => {
  const tile = createBlueNoiseTile(1234, 64);

  it('is a deterministic permutation of all ranks (hash snapshot)', () => {
    expect(tile.ranks.length).toBe(64 * 64);
    expect(new Set(tile.ranks).size).toBe(64 * 64);
    expect(fnv1a64Hex(tile.ranks)).toBe('e8c6a64db2617219');
    expect(fnv1a64Hex(createBlueNoiseTile(1234, 64).ranks)).toBe('e8c6a64db2617219');
    expect(fnv1a64Hex(createBlueNoiseTile(99, 32).ranks)).toBe('07c9249bb68cd8ed');
    expect(fnv1a64Hex(createBlueNoiseTile(1235, 64).ranks)).not.toBe('e8c6a64db2617219');
  });

  it('spreads points evenly at every density (toroidal nearest-neighbour distance)', () => {
    for (const density of [0.02, 0.08, 0.25]) {
      const pts: Array<[number, number]> = [];
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (blueNoiseAt(tile, x, y) < density) pts.push([x, y]);
      expect(pts.length).toBe(Math.round(64 * 64 * density));
      let minNn = Infinity;
      let sumNn = 0;
      for (const [ax, ay] of pts) {
        let best = Infinity;
        for (const [bx, by] of pts) {
          if (ax === bx && ay === by) continue;
          const dx = Math.min(Math.abs(ax - bx), 64 - Math.abs(ax - bx));
          const dy = Math.min(Math.abs(ay - by), 64 - Math.abs(ay - by));
          best = Math.min(best, Math.hypot(dx, dy));
        }
        minNn = Math.min(minNn, best);
        sumNn += best;
      }
      // Ideal spacing of a square lattice is 1/√density; white noise has clumps at distance 1.
      const ideal = Math.sqrt(1 / density);
      expect(minNn, `min spacing at density ${density}`).toBeGreaterThanOrEqual(0.65 * ideal);
      expect(sumNn / pts.length, `mean spacing at density ${density}`).toBeGreaterThanOrEqual(0.75 * ideal);
    }
  });

  it('wraps seamlessly, also for negative and far coordinates', () => {
    expect(blueNoiseAt(tile, -1, 0)).toBe(blueNoiseAt(tile, 63, 0));
    expect(blueNoiseAt(tile, 64 * 25 + 5, -64 * 3 + 7)).toBe(blueNoiseAt(tile, 5, 7));
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = blueNoiseAt(tile, x, y);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('rejects unsupported sizes', () => {
    expect(() => createBlueNoiseTile(1, BLUE_NOISE_MIN_SIZE - 1)).toThrow(RangeError);
    expect(() => createBlueNoiseTile(1, BLUE_NOISE_MAX_SIZE + 1)).toThrow(RangeError);
    expect(() => createBlueNoiseTile(1, 12.5)).toThrow(RangeError);
  });
});
