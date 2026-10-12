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

/** The lattice of one octave: `cells`² values `hashToUnit(hash2(x, y, seed))`, row by row (the corners `periodicValueNoise` reads). */
function lattice(cells: number, seed: number): Float64Array {
  const out = new Float64Array(cells * cells);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) out[y * cells + x] = hashToUnit(hash2(x, y, seed));
  return out;
}

/**
 * The RGBA8 texels of the noise tile (`size`² · 4 bytes, row 0 first): per channel `periodicFbm` of the channel's cells,
 * octaves and seed, bit for bit. The lattice corners are hashed once per octave (a few thousand values, not four per texel
 * and octave) and the fBm is written out in one loop – the tile is built while the renderer starts, before any code is
 * optimised, where every call returning a fraction or a hash above 2³⁰ leaves a heap number: 17 MB of them on the loading
 * screen (M7-115).
 */
export function buildNoiseTexels(size = NOISE_SIZE, seed = NOISE_SEED): Uint8Array {
  const out = new Uint8Array(size * size * RGBA);
  for (let ch = 0; ch < RGBA; ch++) {
    const octaves = NOISE_OCTAVES[ch] as number;
    const channelSeed = seed + (CHANNEL_SEEDS[ch] as number);
    const lattices: Float64Array[] = [];
    const cellCounts = new Int32Array(octaves);
    let c = NOISE_BASE_CELLS[ch] as number;
    for (let o = 0; o < octaves; o++) {
      lattices.push(lattice(c, channelSeed + o * 0x9e37));
      cellCounts[o] = c;
      c *= 2;
    }
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        // `periodicFbm` and `periodicValueNoise` written out, the same expressions in the same order.
        let sum = 0;
        let norm = 0;
        let amp = 1;
        for (let o = 0; o < octaves; o++) {
          const cells = cellCounts[o] as number;
          const corners = lattices[o] as Float64Array;
          const px = u * cells;
          const py = v * cells;
          const x0 = Math.floor(px);
          const y0 = Math.floor(py);
          const fx = px - x0;
          const fy = py - y0;
          const tx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
          const ty = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
          const xa = ((x0 % cells) + cells) % cells;
          const ya = ((y0 % cells) + cells) % cells;
          const xb = (xa + 1) % cells;
          const yb = (ya + 1) % cells;
          const a = corners[ya * cells + xa] as number;
          const b = corners[ya * cells + xb] as number;
          const cc = corners[yb * cells + xa] as number;
          const d = corners[yb * cells + xb] as number;
          const top = a + (b - a) * tx;
          const bottom = cc + (d - cc) * tx;
          sum += amp * (top + (bottom - top) * ty);
          norm += amp;
          amp *= PERSISTENCE;
        }
        out[(y * size + x) * RGBA + ch] = Math.round((sum / norm) * BYTE_MAX);
      }
    }
  }
  return out;
}

/**
 * Channel `channel` (0 R … 3 A) of the noise tile `texels` at texture coordinate (u, v) as the passes read it (mirror of
 * `texture(uNoise, …)` with linear filtering and repeat wrapping: the four texels around the point, weighted by its
 * position between their centres). `noiseAt(noise, world, tilePx)` of atmosphere.glsl is (u, v) = world / tilePx.
 */
export function sampleNoise(texels: Uint8Array, u: number, v: number, channel: number, size = NOISE_SIZE): number {
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = ((x0 % size) + size) % size;
  const ya = ((y0 % size) + size) % size;
  const xb = (xa + 1) % size;
  const yb = (ya + 1) % size;
  const t = (i: number, j: number): number => (texels[(j * size + i) * RGBA + channel] ?? 0) / BYTE_MAX;
  const top = t(xa, ya) + (t(xb, ya) - t(xa, ya)) * fx;
  const bottom = t(xa, yb) + (t(xb, yb) - t(xa, yb)) * fx;
  return top + (bottom - top) * fy;
}
