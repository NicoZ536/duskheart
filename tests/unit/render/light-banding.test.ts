/**
 * M1-19: light bands with ordered 4×4 Bayer dither (§6.1 pass 6): full light stays exactly 1, the
 * dither is anchored to the world, keeps the average brightness and only covers the band seams.
 */
import { describe, expect, it } from 'vitest';
import { BAND_DITHER_SPREAD, BAND_ROUNDING, bandThreshold, bayerThreshold, lightBandLevel, lightBandScale } from '../../../src/render/light/banding';

describe('light bands', () => {
  it('full light and darkness stay exact at every band count', () => {
    for (const levels of [6, 7, 8, 9, 10]) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const t = bandThreshold(bayerThreshold(x, y));
          expect(lightBandLevel(1, levels, t)).toBe(1);
          expect(lightBandLevel(0, levels, t)).toBe(0);
        }
      }
    }
    expect(lightBandScale(0, 8, BAND_ROUNDING)).toBe(1);
  });

  it('quantises to `levels` steps per unit (plain rounding without dither)', () => {
    expect(lightBandLevel(0.49, 8, BAND_ROUNDING)).toBe(0.5);
    expect(lightBandLevel(0.56, 8, BAND_ROUNDING)).toBe(0.5);
    expect(lightBandLevel(0.57, 8, BAND_ROUNDING)).toBe(0.625);
    expect(lightBandLevel(1.3, 10, BAND_ROUNDING)).toBe(1.3);
    expect(lightBandScale(0.5, 8, BAND_ROUNDING)).toBe(1);
  });

  it('the Bayer thresholds cover (0, 1) evenly and repeat every 4 world pixels', () => {
    const t: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) t.push(bayerThreshold(x, y));
    expect([...t].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => (i + 0.5) / 16));
    expect(bayerThreshold(-3, 9)).toBe(bayerThreshold(1, 1));
  });

  it('band cores are flat, the seams between them dithered, the average preserved', () => {
    const levels = 8;
    const avg = (v: number): number => {
      let sum = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += lightBandLevel(v, levels, bandThreshold(bayerThreshold(x, y)));
      return sum / 16;
    };
    const core = (3 + 0.5 - BAND_DITHER_SPREAD / 2 - 0.05) / levels;
    expect(new Set(Array.from({ length: 16 }, (_, i) => lightBandLevel(core, levels, bandThreshold(bayerThreshold(i % 4, i >> 2))))).size).toBe(1);
    const seam = 3.5 / levels;
    expect(new Set(Array.from({ length: 16 }, (_, i) => lightBandLevel(seam, levels, bandThreshold(bayerThreshold(i % 4, i >> 2))))).size).toBe(2);
    expect(avg(seam)).toBeCloseTo(seam, 2);
  });
});
