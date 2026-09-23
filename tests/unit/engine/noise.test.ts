import { describe, expect, it } from 'vitest';
import {
  FBM_DEFAULTS,
  createSimplex2,
  createSimplex3,
  createValueNoise2,
  domainWarp,
  fbm,
  noiseTo01,
  ridged,
  type Noise2,
} from '../../../src/engine/noise';

function sampleGrid(fn: Noise2, n = 64, step = 0.173): number[] {
  const out: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push(fn(x * step - 5, y * step + 3));
  return out;
}

function stats(values: number[]): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  return { min, max, mean: sum / values.length };
}

describe('simplex 2D', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = sampleGrid(createSimplex2(11));
    const b = sampleGrid(createSimplex2(11));
    const c = sampleGrid(createSimplex2(12));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('stays in [-1, 1], is centered and uses most of the range', () => {
    const s = stats(sampleGrid(createSimplex2(3), 128, 0.091));
    expect(s.min).toBeGreaterThanOrEqual(-1);
    expect(s.max).toBeLessThanOrEqual(1);
    expect(Math.abs(s.mean)).toBeLessThan(0.1);
    expect(s.max).toBeGreaterThan(0.6);
    expect(s.min).toBeLessThan(-0.6);
  });

  it('is continuous', () => {
    const n = createSimplex2(5);
    let maxJump = 0;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37 - 40;
      const y = i * 0.11 + 7;
      maxJump = Math.max(maxJump, Math.abs(n(x, y) - n(x + 1e-4, y + 1e-4)));
    }
    expect(maxJump).toBeLessThan(0.01);
  });

  it('handles negative and large coordinates', () => {
    const n = createSimplex2(9);
    for (const [x, y] of [
      [-1000.5, -2000.25],
      [123456.7, -98765.4],
      [0, 0],
    ] as const) {
      const v = n(x, y);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('simplex 3D', () => {
  it('is deterministic, bounded and continuous in time', () => {
    const a = createSimplex3(21);
    const b = createSimplex3(21);
    let min = Infinity;
    let max = -Infinity;
    let mismatches = 0;
    let maxJump = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i % 50) * 0.21;
      const y = Math.floor(i / 50) * 0.19;
      const t = i * 0.003;
      const v = a(x, y, t);
      if (v !== b(x, y, t)) mismatches++;
      min = Math.min(min, v);
      max = Math.max(max, v);
      maxJump = Math.max(maxJump, Math.abs(v - a(x, y, t + 1e-4)));
    }
    expect(mismatches).toBe(0);
    expect(maxJump).toBeLessThan(0.01);
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1);
    expect(createSimplex3(22)(0.3, 0.7, 0.1)).not.toBe(a(0.3, 0.7, 0.1));
  });
});

describe('value noise', () => {
  it('is deterministic, bounded and interpolates lattice values', () => {
    const n = createValueNoise2(4);
    const s = stats(sampleGrid(n, 64, 0.23));
    expect(s.min).toBeGreaterThanOrEqual(-1);
    expect(s.max).toBeLessThanOrEqual(1);
    expect(sampleGrid(createValueNoise2(4))).toEqual(sampleGrid(n));
    expect(sampleGrid(createValueNoise2(5))).not.toEqual(sampleGrid(n));
    // Continuity across a lattice line.
    expect(Math.abs(n(2 - 1e-6, 3.5) - n(2 + 1e-6, 3.5))).toBeLessThan(1e-4);
  });
});

describe('fbm / ridged / domainWarp', () => {
  const base = createSimplex2(8);

  it('fbm is normalized and deterministic', () => {
    const values = sampleGrid((x, y) => fbm(base, x, y, { octaves: 6, frequency: 0.5 }), 48);
    const s = stats(values);
    expect(s.min).toBeGreaterThanOrEqual(-1);
    expect(s.max).toBeLessThanOrEqual(1);
    expect(values).toEqual(sampleGrid((x, y) => fbm(base, x, y, { octaves: 6, frequency: 0.5 }), 48));
  });

  it('fbm with one octave equals the base noise', () => {
    expect(fbm(base, 1.3, 2.7, { octaves: 1 })).toBeCloseTo(base(1.3, 2.7), 12);
    expect(fbm(base, 1.3, 2.7)).toBe(fbm(base, 1.3, 2.7, FBM_DEFAULTS));
  });

  it('fbm rejects invalid octave counts', () => {
    expect(() => fbm(base, 0, 0, { octaves: 0 })).toThrow(RangeError);
    expect(() => ridged(base, 0, 0, { octaves: 1.5 })).toThrow(RangeError);
  });

  it('more octaves add detail (higher local variation)', () => {
    const rough = (oct: number): number => {
      let acc = 0;
      for (let i = 0; i < 400; i++) {
        const x = i * 0.05;
        acc += Math.abs(fbm(base, x, 1, { octaves: oct }) - fbm(base, x + 0.01, 1, { octaves: oct }));
      }
      return acc;
    };
    expect(rough(6)).toBeGreaterThan(rough(1));
  });

  it('ridged stays in [0, 1]', () => {
    const s = stats(sampleGrid((x, y) => ridged(base, x, y, { octaves: 4 }), 48));
    expect(s.min).toBeGreaterThanOrEqual(0);
    expect(s.max).toBeLessThanOrEqual(1);
    expect(s.max).toBeGreaterThan(0.7);
  });

  it('domainWarp writes into the output object and is bounded by strength', () => {
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 200; i++) {
      const x = i * 0.7;
      const y = -i * 0.3;
      const r = domainWarp(base, x, y, 4, 0.1, out);
      expect(r).toBe(out);
      expect(Math.abs(out.x - x)).toBeLessThanOrEqual(4);
      expect(Math.abs(out.y - y)).toBeLessThanOrEqual(4);
    }
    domainWarp(base, 3, 3, 0, 0.1, out);
    expect(out).toEqual({ x: 3, y: 3 });
  });

  it('noiseTo01 maps the range', () => {
    expect(noiseTo01(-1)).toBe(0);
    expect(noiseTo01(0)).toBe(0.5);
    expect(noiseTo01(1)).toBe(1);
  });
});

describe('golden values (world generation depends on these staying bit-identical)', () => {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [0.5, 0.25],
    [-17.3, 4.2],
    [123.456, -789.01],
    [1e5 + 0.3, -2e5 + 0.7],
  ];

  it('simplex, value noise, fbm and ridged are stable for seed 1234', () => {
    const s2 = createSimplex2(1234);
    const s3 = createSimplex3(1234);
    const v2 = createValueNoise2(1234);
    expect(pts.map(([x, y]) => s2(x, y))).toEqual([-0.7342936161846805, -0.159873145427753, -0.2172545165465344, 0.24133274961460704]);
    expect(pts.map(([x, y]) => s3(x, y, x * 0.5 - y))).toEqual([0.01821881510416662, 0.11251108183333727, 0.3103909449807462, -0.347124376408521]);
    expect(pts.map(([x, y]) => v2(x, y))).toEqual([-0.6403219577073287, -0.06703075748849838, -0.05070234539763441, 0.4456120273100153]);
    expect(pts.map(([x, y]) => fbm(s2, x * 0.01, y * 0.01))).toEqual([
      -0.0695744343573415, 0.12758507667966704, 0.12338232325195056, 0.008914329002223095,
    ]);
    expect(pts.map(([x, y]) => ridged(s2, x * 0.01, y * 0.01))).toEqual([0.6822736820112203, 0.33106934525965126, 0.5094970253094765, 0.7700795629086226]);
  });
});
