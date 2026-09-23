/**
 * M1-19: tonemapping of the post chain – palette colours under full light reach the screen exactly,
 * overexposure keeps the hue of the brightest channel and rises smoothly towards white.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { parseHexColor } from '../../../src/render/palette/lut';
import { DEFAULT_EXPOSURE, tonemap, tonemapWhite, TONEMAP_WHITE } from '../../../src/render/passes/postPass';

const out: [number, number, number] = [0, 0, 0];

describe('tonemap', () => {
  it('is the identity for every palette colour at full light (exposure 1)', () => {
    expect(DEFAULT_EXPOSURE).toBe(1);
    for (const hex of PALETTE_HEX) {
      const [r, g, b] = parseHexColor(hex).map((v) => v / 255) as [number, number, number];
      expect(tonemap(r, g, b, out)).toEqual([r, g, b]);
    }
  });

  it('clamps negatives and keeps the brightest channel at 1 above', () => {
    expect(tonemap(-0.5, 0.2, 0.1, out)).toEqual([0, 0.2, 0.1]);
    for (const k of [1.01, 1.5, 3, 12]) {
      const [r, g, b] = tonemap(1 * k, 0.6 * k, 0.2 * k, out);
      expect(r).toBeCloseTo(1, 12);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeLessThan(g);
      expect(g).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('rises continuously towards white with the overexposure, never past TONEMAP_WHITE', () => {
    expect(tonemapWhite(1)).toBe(0);
    expect(tonemapWhite(1.0001)).toBeLessThan(1e-3);
    let prev = 0;
    for (let peak = 1.1; peak < 50; peak *= 1.3) {
      const w = tonemapWhite(peak);
      expect(w).toBeGreaterThan(prev);
      expect(w).toBeLessThan(TONEMAP_WHITE);
      prev = w;
    }
    // Just above 1 the curve continues the identity (no visible step at the shoulder).
    const [, below] = tonemap(1, 0.5, 0.25, [0, 0, 0]);
    const [, above] = tonemap(1.001, 0.5005, 0.25025, [0, 0, 0]);
    expect(Math.abs(above - below)).toBeLessThan(1e-3);
  });
});
