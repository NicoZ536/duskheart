/**
 * Tiling noise texture of the atmosphere and post passes (fog layers M5-10, corruption patches and
 * veins M5-22, fear shadows and heat shimmer M5-15): four independent seamless fBm fields in one RGBA8
 * texture, sampled with linear filtering and repeat wrapping – one texture fetch instead of several
 * noise evaluations per pixel (the software rasteriser of the headless tests runs every shader on the
 * CPU). Deterministic: the same seed gives the same texels on every machine.
 *
 * | Channel | Content |
 * |---|---|
 * | R | soft fBm, 4 octaves from 4 cells per tile (fog banks, corruption patches) |
 * | G | the same with another seed (second fog layer, tendrils, the pulse along the veins) |
 * | B | finer fBm from 8 cells per tile (ground mist, shimmer) |
 * | A | smoother fBm, 3 octaves from 5 cells (vein field: its 0.5 isolines are long meandering lines) |
 */
import { hash2, hashToUnit } from '../../engine/rng';

/** Texels per side of the noise tile. */
export const NOISE_SIZE = 128;
/** Seed of the noise texture (fixed: screenshots and tests must match). */
export const NOISE_SEED = 0x5eed_f06;
/** Octaves per channel. */
export const NOISE_OCTAVES: readonly [number, number, number, number] = [4, 4, 4, 3];
/** Lattice cells per tile of the first octave, per channel. */
export const NOISE_BASE_CELLS: readonly [number, number, number, number] = [4, 4, 8, 5];
/** Seed offsets of the channels. */
const CHANNEL_SEEDS = [0x1111, 0x2222, 0x3333, 0x4444] as const;
/** Amplitude falloff per octave. */
const PERSISTENCE = 0.5;
const BYTE_MAX = 255;
const RGBA = 4;

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Periodic value noise in [0, 1): lattice of `cells` × `cells` over the unit tile (u, v in [0, 1)). */
export function periodicValueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = quintic(x - x0);
  const ty = quintic(y - y0);
  const xa = ((x0 % cells) + cells) % cells;
  const ya = ((y0 % cells) + cells) % cells;
  const xb = (xa + 1) % cells;
  const yb = (ya + 1) % cells;
  const a = hashToUnit(hash2(xa, ya, seed));
  const b = hashToUnit(hash2(xb, ya, seed));
  const c = hashToUnit(hash2(xa, yb, seed));
  const d = hashToUnit(hash2(xb, yb, seed));
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** Seamless fBm in [0, 1] over the unit tile: `octaves` of periodic value noise from `cells` cells up. */
export function periodicFbm(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValueNoise(u, v, c, seed + o * 0x9e37);
    norm += amp;
    amp *= PERSISTENCE;
    c *= 2;
  }
  return sum / norm;
}

/** The RGBA8 texels of the noise tile (`size`² · 4 bytes, row 0 first). */
export function buildNoiseTexels(size = NOISE_SIZE, seed = NOISE_SEED): Uint8Array {
  const out = new Uint8Array(size * size * RGBA);
  const [cr, cg, cb, ca] = NOISE_BASE_CELLS;
  const [or, og, ob, oa] = NOISE_OCTAVES;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const o = (y * size + x) * RGBA;
      out[o] = Math.round(periodicFbm(u, v, cr, or, seed + CHANNEL_SEEDS[0]) * BYTE_MAX);
      out[o + 1] = Math.round(periodicFbm(u, v, cg, og, seed + CHANNEL_SEEDS[1]) * BYTE_MAX);
      out[o + 2] = Math.round(periodicFbm(u, v, cb, ob, seed + CHANNEL_SEEDS[2]) * BYTE_MAX);
      out[o + 3] = Math.round(periodicFbm(u, v, ca, oa, seed + CHANNEL_SEEDS[3]) * BYTE_MAX);
    }
  }
  return out;
}
