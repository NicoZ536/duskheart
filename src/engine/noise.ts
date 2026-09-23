/**
 * Seeded gradient and value noise (docs/ARCHITEKTUR.md "Determinismus").
 *
 * All generators are pure functions of (seed, coordinates): no global state, no `Math.random`.
 * Outputs of the base generators are in [-1, 1].
 */
import { Rng, hash2, hashToUnit } from './rng';

/** A 2D noise function returning values in [-1, 1]. */
export type Noise2 = (x: number, y: number) => number;
/** A 3D noise function returning values in [-1, 1]. */
export type Noise3 = (x: number, y: number, z: number) => number;

/** Size of the permutation table (must be a power of two). */
const PERM_SIZE = 256;
/** Mask for wrapping lattice coordinates into the permutation table. */
const PERM_MASK = PERM_SIZE - 1;
/** Number of gradient directions in `GRAD3`. */
const GRAD_COUNT = 12;

/** 2D skew factor: (sqrt(3) - 1) / 2. */
const F2 = 0.5 * (Math.sqrt(3) - 1);
/** 2D unskew factor: (3 - sqrt(3)) / 6. */
const G2 = (3 - Math.sqrt(3)) / 6;
/** 3D skew factor. */
const F3 = 1 / 3;
/** 3D unskew factor. */
const G3 = 1 / 6;
/** Radius² of a simplex corner's influence in 2D. */
const SIMPLEX2_FALLOFF = 0.5;
/** Radius² of a simplex corner's influence in 3D (0.6 is the classic, seam free choice). */
const SIMPLEX3_FALLOFF = 0.6;
/** Scale that maps the raw 2D simplex sum into roughly [-1, 1]. */
const SIMPLEX2_SCALE = 70;
/** Scale that maps the raw 3D simplex sum into roughly [-1, 1]. */
const SIMPLEX3_SCALE = 32;

/** Edge midpoints of a cube: the 12 classic simplex gradients (x, y, z triples). */
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/** Per-octave coordinate offset so octaves do not share their lattice origin. */
export const OCTAVE_OFFSET = 17.31;
/** Offsets that decorrelate the two axes of a domain warp that uses a single noise function. */
export const WARP_OFFSET_X = 31.7;
export const WARP_OFFSET_Y = 91.3;

/** Default fBm parameters: 5 octaves, doubled frequency and halved amplitude per octave. */
export const FBM_DEFAULTS: Readonly<Required<FbmOptions>> = { octaves: 5, lacunarity: 2, gain: 0.5, frequency: 1 };

/** Options for `fbm` and `ridged`. All fields are optional (see `FBM_DEFAULTS`). */
export interface FbmOptions {
  /** Number of layered octaves (≥ 1). */
  octaves?: number;
  /** Frequency multiplier per octave. */
  lacunarity?: number;
  /** Amplitude multiplier per octave. */
  gain?: number;
  /** Base frequency applied to the input coordinates. */
  frequency?: number;
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Builds the doubled permutation table (and gradient index table) for a seed. */
function buildPermutation(seed: number): { perm: Uint8Array; permMod12: Uint8Array } {
  const source: number[] = [];
  for (let i = 0; i < PERM_SIZE; i++) source.push(i);
  new Rng(seed).shuffle(source);
  const perm = new Uint8Array(PERM_SIZE * 2);
  const permMod12 = new Uint8Array(PERM_SIZE * 2);
  for (let i = 0; i < PERM_SIZE * 2; i++) {
    const v = source[i & PERM_MASK] as number;
    perm[i] = v;
    permMod12[i] = v % GRAD_COUNT;
  }
  return { perm, permMod12 };
}

/** Creates a seeded 2D simplex noise function with output in [-1, 1]. */
export function createSimplex2(seed: number): Noise2 {
  const { perm, permMod12 } = buildPermutation(seed);
  return (x: number, y: number): number => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & PERM_MASK;
    const jj = j & PERM_MASK;
    let n = 0;
    let t0 = SIMPLEX2_FALLOFF - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = (permMod12[ii + (perm[jj] as number)] as number) * 3;
      t0 *= t0;
      n += t0 * t0 * ((GRAD3[g] as number) * x0 + (GRAD3[g + 1] as number) * y0);
    }
    let t1 = SIMPLEX2_FALLOFF - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = (permMod12[ii + i1 + (perm[jj + j1] as number)] as number) * 3;
      t1 *= t1;
      n += t1 * t1 * ((GRAD3[g] as number) * x1 + (GRAD3[g + 1] as number) * y1);
    }
    let t2 = SIMPLEX2_FALLOFF - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = (permMod12[ii + 1 + (perm[jj + 1] as number)] as number) * 3;
      t2 *= t2;
      n += t2 * t2 * ((GRAD3[g] as number) * x2 + (GRAD3[g + 1] as number) * y2);
    }
    return clampUnit(SIMPLEX2_SCALE * n);
  };
}

/** Creates a seeded 3D simplex noise function with output in [-1, 1] (e.g. z = time for animation). */
export function createSimplex3(seed: number): Noise3 {
  const { perm, permMod12 } = buildPermutation(seed);
  const corner = (gi: number, x: number, y: number, z: number): number => {
    let t = SIMPLEX3_FALLOFF - x * x - y * y - z * z;
    if (t <= 0) return 0;
    const g = gi * 3;
    t *= t;
    return t * t * ((GRAD3[g] as number) * x + (GRAD3[g + 1] as number) * y + (GRAD3[g + 2] as number) * z);
  };
  return (x: number, y: number, z: number): number => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
    const ii = i & PERM_MASK;
    const jj = j & PERM_MASK;
    const kk = k & PERM_MASK;
    const g0 = permMod12[ii + (perm[jj + (perm[kk] as number)] as number)] as number;
    const g1 = permMod12[ii + i1 + (perm[jj + j1 + (perm[kk + k1] as number)] as number)] as number;
    const g2 = permMod12[ii + i2 + (perm[jj + j2 + (perm[kk + k2] as number)] as number)] as number;
    const g3 = permMod12[ii + 1 + (perm[jj + 1 + (perm[kk + 1] as number)] as number)] as number;
    const n =
      corner(g0, x0, y0, z0) +
      corner(g1, x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3) +
      corner(g2, x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3) +
      corner(g3, x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3);
    return clampUnit(SIMPLEX3_SCALE * n);
  };
}

/** Quintic fade curve 6t^5 - 15t^4 + 10t^3 (C2 continuous). */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Lattice value in [-1, 1] for an integer coordinate. */
function latticeValue(ix: number, iy: number, seed: number): number {
  return hashToUnit(hash2(ix, iy, seed)) * 2 - 1;
}

/** Creates seeded 2D value noise (hashed lattice values, quintic interpolation), output in [-1, 1]. */
export function createValueNoise2(seed: number): Noise2 {
  const s = seed | 0;
  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const v00 = latticeValue(x0, y0, s);
    const v10 = latticeValue(x0 + 1, y0, s);
    const v01 = latticeValue(x0, y0 + 1, s);
    const v11 = latticeValue(x0 + 1, y0 + 1, s);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  };
}

function resolveOctaves(opts: FbmOptions | undefined): number {
  const octaves = opts?.octaves ?? FBM_DEFAULTS.octaves;
  if (!Number.isInteger(octaves) || octaves < 1) throw new RangeError(`octaves must be an integer ≥ 1, got ${String(octaves)}`);
  return octaves;
}

/**
 * Fractal Brownian motion: layered octaves of `noise`, normalized by the amplitude sum so the
 * result stays in [-1, 1].
 */
export function fbm(noise: Noise2, x: number, y: number, opts?: FbmOptions): number {
  const octaves = resolveOctaves(opts);
  const lacunarity = opts?.lacunarity ?? FBM_DEFAULTS.lacunarity;
  const gain = opts?.gain ?? FBM_DEFAULTS.gain;
  let freq = opts?.frequency ?? FBM_DEFAULTS.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const off = o * OCTAVE_OFFSET;
    sum += amp * noise(x * freq + off, y * freq - off);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Ridged multifractal: octaves of (1 - |noise|)², sharp crests along the zero lines of the base
 * noise (mountain ridges, rivers). Output in [0, 1].
 */
export function ridged(noise: Noise2, x: number, y: number, opts?: FbmOptions): number {
  const octaves = resolveOctaves(opts);
  const lacunarity = opts?.lacunarity ?? FBM_DEFAULTS.lacunarity;
  const gain = opts?.gain ?? FBM_DEFAULTS.gain;
  let freq = opts?.frequency ?? FBM_DEFAULTS.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const off = o * OCTAVE_OFFSET;
    const r = 1 - Math.abs(noise(x * freq + off, y * freq - off));
    sum += amp * r * r;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Domain warp: displaces (x, y) by `strength` times the noise sampled at `frequency`, using two
 * decorrelated samples of the same noise for the two axes. Writes the warped position into `out`
 * (no allocation) and returns it.
 */
export function domainWarp<T extends { x: number; y: number }>(
  noise: Noise2,
  x: number,
  y: number,
  strength: number,
  frequency: number,
  out: T,
): T {
  const fx = x * frequency;
  const fy = y * frequency;
  const wx = noise(fx + WARP_OFFSET_X, fy + WARP_OFFSET_Y);
  const wy = noise(fx - WARP_OFFSET_Y, fy - WARP_OFFSET_X);
  out.x = x + strength * wx;
  out.y = y + strength * wy;
  return out;
}

/** Maps a noise value from [-1, 1] to [0, 1]. */
export function noiseTo01(v: number): number {
  return v * 0.5 + 0.5;
}
