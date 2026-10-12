/**
 * The noise tile of the atmosphere and post passes (src/render/post/noise.ts): `buildNoiseTexels` hashes the lattice once per
 * octave and writes the fBm out in one loop (M7-115: the tile is built while the renderer starts, in code not yet optimised),
 * and still gives every texel of `periodicFbm` bit for bit – the shots and the corruption tests read these bytes.
 */
import { describe, expect, it } from 'vitest';
import { buildNoiseTexels, NOISE_BASE_CELLS, NOISE_OCTAVES, NOISE_SEED, NOISE_SIZE, periodicFbm } from '../../../src/render/post/noise';

/** Seed offsets of the four channels (noise.ts `CHANNEL_SEEDS`). */
const CHANNEL_SEEDS = [0x1111, 0x2222, 0x3333, 0x4444] as const;

/** The tile texel by texel through `periodicFbm`, the definition the build must match. */
function reference(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        out[(y * size + x) * 4 + c] = Math.round(periodicFbm(x / size, y / size, NOISE_BASE_CELLS[c] as number, NOISE_OCTAVES[c] as number, seed + (CHANNEL_SEEDS[c] as number)) * 255);
      }
    }
  }
  return out;
}

describe('Rauschkachel', () => {
  it('jedes Texel gleich periodicFbm seines Kanals (Standardkachel und eine andere Größe und Saat)', () => {
    for (const [size, seed] of [
      [NOISE_SIZE, NOISE_SEED],
      [48, 12345],
    ] as const) {
      const built = buildNoiseTexels(size, seed);
      const want = reference(size, seed);
      let differing = 0;
      for (let i = 0; i < want.length; i++) if (built[i] !== want[i]) differing++;
      expect(built.length).toBe(size * size * 4);
      expect(differing).toBe(0);
    }
  });
});
