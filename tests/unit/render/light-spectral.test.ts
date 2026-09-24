/**
 * M1-26 (§4.1 „warme Lichtinseln in kühler, bedrohlicher Dunkelheit“, §4.3, ADR-0018): the light
 * colour of the composition. White light keeps every palette colour exact (daylight identity), the
 * spectral model is linear in the light's intensity, the warm hue shift turns a rising fire light from
 * orange towards warm yellow without touching white or cold light. Through the whole CPU mirror of the
 * composition (ambient + banded point light, reflected, tonemapped) torch light on grass reads warm
 * (red above green – the plain RGB product read lime) and the moonlit dark reads cool (blue above red
 * and green – the plain product read green-black). The light colours come from the palette ramps.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../src/generated/palette';
import { lightBandScale } from '../../../src/render/light/banding';
import { FIRE, LUMEN, MOONLIGHT, MOONLIGHT_SATURATION, paletteLight, withSaturation, type Rgb } from '../../../src/render/light/lightColors';
import {
  lightReflectance,
  reflectLight,
  SPECTRAL_WEIGHT,
  spectralShare,
  WARM_SHIFT,
  WARM_SHIFT_FULL_LEVEL,
  WARM_SHIFT_START_LEVEL,
  warmLight,
  warmShare,
} from '../../../src/render/light/spectral';
import { parseHexColor } from '../../../src/render/palette/lut';
import { paletteRefHex } from '../../../src/render/palette/rows';
import { tonemap } from '../../../src/render/passes/postPass';

type Vec = [number, number, number];

function color(ref: string): Vec {
  const [r, g, b] = parseHexColor(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX));
  return [r / 255, g / 255, b / 255];
}

function scaled(c: Rgb, k: number): Vec {
  return [c[0] * k, c[1] * k, c[2] * k];
}

function reflect(a: Vec, light: Vec): Vec {
  return reflectLight(a[0], a[1], a[2], light[0], light[1], light[2], [0, 0, 0]);
}

/** Hue in degrees (0 = red, 60 = yellow, 120 = green, 240 = blue). */
function hue([r, g, b]: Vec): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Light bands of the default graphics settings (8 per unit) without dither. */
const BANDS = 8;
const ROUNDING = 0.5;

/**
 * CPU mirror of composite.frag + tonemapping for a lit pixel: ambient and the banded, warm-shifted
 * point light, each reflected with its spectral colour, then the post chain's tonemap.
 */
function composite(albedo: Vec, ambient: Vec, point: Vec): Vec {
  const band = lightBandScale(Math.max(...point), BANDS, ROUNDING);
  const warm = warmLight(point[0] * band, point[1] * band, point[2] * band, [0, 0, 0]);
  const a = reflect(albedo, ambient);
  const p = reflect(albedo, warm);
  return tonemap(a[0] + p[0], a[1] + p[1], a[2] + p[2], [0, 0, 0]);
}

const GRASS = ['gras.1', 'gras.2', 'gras.3', 'gras.4'] as const;
/** Night ambient of the Grünhain title scene and the torch levels across its light pools. */
const NIGHT = scaled(MOONLIGHT, 0.34);
const TORCH_LEVELS = [0.25, 0.5, 0.8, 1.2, 1.6, 2.2] as const;
/** Point light level from which on a pixel counts as the pool's heart. */
const CORE_LEVEL = 0.8;
/** Fire light and night ambient of the scenes before M1-26 (plain RGB product). */
const OLD_FIRE: Vec = [1, 0.58, 0.26];
const OLD_AMBIENT: Vec = [0.42, 0.5, 1];

describe('spectral light colour', () => {
  it('white and grey light give the exact RGB product for every palette colour (daylight identity)', () => {
    for (const hex of PALETTE_HEX) {
      const [r, g, b] = parseHexColor(hex).map((v) => v / 255) as Vec;
      for (const k of [0.3, 1, 2.5]) expect(reflectLight(r, g, b, k, k, k, [0, 0, 0])).toEqual([r * k, g * k, b * k]);
      // Full daylight through the whole composition: the palette colour itself.
      expect(composite([r, g, b], [1, 1, 1], [0, 0, 0])).toEqual([r, g, b]);
    }
  });

  it('is linear in the light intensity and dark without light', () => {
    const a = color('erde.3');
    const one = reflect(a, scaled(FIRE, 1));
    const three = reflect(a, scaled(FIRE, 3));
    for (let c = 0; c < 3; c++) expect(three[c]).toBeCloseTo((one[c] ?? 0) * 3, 12);
    expect(reflectLight(0.5, 0.4, 0.3, 0, 0, 0, [1, 1, 1])).toEqual([0, 0, 0]);
  });

  it('pulls towards the light hue by the weighted saturation; a light in one primary stays exact', () => {
    expect(SPECTRAL_WEIGHT).toBeGreaterThan(0);
    expect(SPECTRAL_WEIGHT).toBeLessThanOrEqual(1);
    expect(spectralShare(0, 2)).toBeCloseTo(SPECTRAL_WEIGHT, 12);
    expect(spectralShare(1, 1)).toBe(0);
    expect(spectralShare(0, 0)).toBe(0);
    const a = color('gras.3');
    expect(reflectLight(a[0], a[1], a[2], 2, 0, 0, [0, 0, 0])).toEqual([2 * a[0], 0, 0]);
    expect(lightReflectance(a[0], a[1], a[2], 1, 1, 1)).toBeCloseTo((a[0] + a[1] + a[2]) / 3, 12);
  });
});

describe('warm hue shift', () => {
  it('leaves white, grey and cold light alone and keeps the brightest channel and blue', () => {
    for (const k of [0.2, 1, 3]) {
      expect(warmLight(k, k, k, [0, 0, 0])).toEqual([k, k, k]);
      for (const cold of [LUMEN, MOONLIGHT]) expect(warmLight(cold[0] * k, cold[1] * k, cold[2] * k, [0, 0, 0])).toEqual(scaled(cold, k));
      const [r, g, b] = warmLight(FIRE[0] * k, FIRE[1] * k, FIRE[2] * k, [0, 0, 0]);
      expect(r).toBe(FIRE[0] * k);
      expect(b).toBe(FIRE[2] * k);
      expect(g).toBeGreaterThanOrEqual(FIRE[1] * k);
      expect(g).toBeLessThanOrEqual(r);
    }
    expect(warmShare(0, 0)).toBe(0);
  });

  it('turns a rising fire light from the orange of feuer.3 towards the yellow of feuer.4', () => {
    expect(warmShare(WARM_SHIFT_START_LEVEL, 0)).toBe(0);
    expect(warmShare(WARM_SHIFT_FULL_LEVEL, 0)).toBeCloseTo(WARM_SHIFT, 12);
    expect(warmShare(2 * WARM_SHIFT_FULL_LEVEL, 0)).toBeCloseTo(WARM_SHIFT, 12);
    let last = -1;
    for (let level = 0.1; level <= 2.5; level += 0.1) {
      const h = hue(warmLight(FIRE[0] * level, FIRE[1] * level, FIRE[2] * level, [0, 0, 0]));
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
    expect(hue(warmLight(0.3, 0.3 * FIRE[1], 0.3 * FIRE[2], [0, 0, 0]))).toBeCloseTo(hue(color('feuer.3')), 6);
    expect(last).toBeGreaterThan(hue(color('feuer.3')) + 5);
    expect(last).toBeLessThan(hue(color('feuer.4')));
  });
});

describe('the composition: warm light islands in cool darkness (M1-26 pixel probe)', () => {
  it('torch light on grass reads warm (red above green) at every level of its pool; the plain product read lime', () => {
    for (const ref of GRASS) {
      for (const level of TORCH_LEVELS) {
        const lit = composite(color(ref), NIGHT, scaled(FIRE, level));
        expect(lit[0], `${ref} @ ${level}: ${lit.join(', ')}`).toBeGreaterThan(lit[1]);
        // In the pool's heart the pixel is warm through and through (orange to golden); at its rim
        // the cool ambient takes over (a violet-brown seam, red still above green).
        if (level >= CORE_LEVEL) expect(hue(lit), `${ref} @ ${level}`).toBeLessThan(55);
      }
    }
    // The defect M1-26 fixes: the RGB product of the old orange light kept grass green-yellow.
    const a = color('gras.3');
    expect(a[1] * OLD_FIRE[1]).toBeGreaterThan(a[0] * OLD_FIRE[0]);
  });

  it('the moonlit dark reads cool (blue above red and green) on every Grünhain material; the plain product read green-black', () => {
    for (const ref of [...GRASS, 'gras.0', 'erde.2', 'erde.3', 'holz.2', 'stein.3', 'wasser.2', 'haut.3']) {
      const dark = composite(color(ref), NIGHT, [0, 0, 0]);
      expect(dark[2], `${ref}: ${dark.join(', ')}`).toBeGreaterThan(dark[0]);
      expect(dark[2], `${ref}: ${dark.join(', ')}`).toBeGreaterThan(dark[1]);
    }
    const a = color('gras.3');
    expect(a[1] * OLD_AMBIENT[1]).toBeGreaterThan(a[2] * OLD_AMBIENT[2]);
  });

  it('keeps materials apart under a torch: grass golden, earth redder, clothes darker, skin brighter', () => {
    const lum = (v: Vec): number => v[0] + v[1] + v[2];
    const level = 1.2;
    const lit = (ref: string): Vec => composite(color(ref), NIGHT, scaled(FIRE, level));
    const grass = lit('gras.3');
    expect(hue(lit('erde.3'))).toBeLessThan(hue(grass) - 8);
    expect(lum(lit('wasser.2'))).toBeLessThan(lum(grass) * 0.8);
    expect(lum(lit('haut.3'))).toBeGreaterThan(lum(grass) * 1.5);
  });
});

describe('light colours from the palette', () => {
  it('normalises the mean of palette colours to a brightest channel of 1', () => {
    const [r, g, b] = color('feuer.3');
    expect(paletteLight('feuer.3')).toEqual([1, g / r, b / r]);
    expect(() => paletteLight()).toThrow(/mindestens eine/);
    expect(() => paletteLight('glut.9')).toThrow(/Rampe/);
  });

  it('fire burns in the orange of the flame ramp', () => {
    expect(FIRE).toEqual(paletteLight('feuer.3'));
    expect(hue([...FIRE])).toBeCloseTo(hue(color('feuer.3')), 9);
    expect(Math.max(...FIRE)).toBe(1);
  });

  it('moonlight is cool blue-violet at the saturation of a clear night, lumenite cold blue', () => {
    expect(MOONLIGHT[2]).toBe(1);
    expect(hue([...MOONLIGHT])).toBeGreaterThan(230);
    expect(hue([...MOONLIGHT])).toBeLessThan(250);
    expect(spectralShare(Math.min(...MOONLIGHT), 1) / SPECTRAL_WEIGHT).toBeCloseTo(MOONLIGHT_SATURATION, 12);
    expect(LUMEN[2]).toBe(1);
    expect(hue([...LUMEN])).toBeGreaterThan(200);
    expect(hue([...LUMEN])).toBeLessThan(230);
  });

  it('withSaturation keeps hue and brightest channel; grey stays grey', () => {
    const base: Rgb = [0.6, 0.7, 1];
    const s = withSaturation(base, 0.8);
    expect(s[2]).toBe(1);
    expect(1 - Math.min(...s)).toBeCloseTo(0.8, 12);
    expect(hue([...s])).toBeCloseTo(hue([...base]), 9);
    expect(withSaturation([1, 1, 1], 0.5)).toEqual([1, 1, 1]);
    expect(withSaturation([0, 0, 0], 0.5)).toEqual([0, 0, 0]);
  });
});
