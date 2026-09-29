/**
 * M5-08, M5-23: the sky the water mirrors (`src/render/water/sky.ts`) and the water's settings (§6.3). By day the
 * mirror holds the palette's sky colours and the sun's glitter, at night – clear – the stars and the moon with its
 * phase and its place by its position (east → right, high → nearer the viewer), under clouds neither; underground no
 * sky at all. The quality levels switch reflection, refraction, waves and caustics exactly as the §6.3 table says.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings, QUALITY_PRESETS, type QualityLevel } from '../../../src/engine/settings';
import { MOON, SKY } from '../../../src/render/water/params';
import { DEFAULT_WATER_SETTINGS, waterSettingsFrom } from '../../../src/render/water/settings';
import { createSkyInput, paletteRgb, twilightShare, waterSkyInto } from '../../../src/render/water/sky';
import { daySky } from '../../../src/render/water/state';
import { glslColour, waterShaderDefines, WATER_COLOURS } from '../../../src/render/water/defines';

function sky(patch: Partial<ReturnType<typeof createSkyInput>>) {
  const input = { ...createSkyInput(), ...patch };
  return waterSkyInto(daySky(), input);
}

describe('mirrored sky', () => {
  it('a clear day mirrors the palette sky, the sun glitters, no stars, no moon', () => {
    const s = sky({ daylight: 1, sunElevationDeg: 50, sunStrength: 1, cloudCover: 0 });
    const [zr, zg, zb] = paletteRgb(SKY.dayZenith);
    expect(s.zenithR).toBeCloseTo(zr, 6);
    expect(s.zenithG).toBeCloseTo(zg, 6);
    expect(s.zenithB).toBeCloseTo(zb, 6);
    expect(s.share).toBeCloseTo(SKY.dayShare, 6);
    expect(s.stars).toBe(0);
    expect(s.moon).toBe(0);
    expect(s.glitter).toBe(1);
    expect(s.sunlight).toBe(1);
  });

  it('a clear full-moon night mirrors stars and the moon; the night sky is darker than the day sky', () => {
    const night = sky({ daylight: 0, sunElevationDeg: -20, sunStrength: 0, moonElevationDeg: 40, moonShadowX: 0, moonIllumination: 1, cloudCover: 0 });
    const day = sky({ daylight: 1 });
    expect(night.stars).toBe(1);
    expect(night.moon).toBe(1);
    expect(night.moonLit).toBe(1);
    expect(night.glitter).toBe(0);
    expect(night.sunlight).toBe(0);
    expect(night.share).toBeCloseTo(SKY.nightShare, 6);
    expect(night.zenithR + night.zenithG + night.zenithB).toBeLessThan((day.zenithR + day.zenithG + day.zenithB) / 4);
  });

  it('the moon: its phase dims it, its place follows it across the sky, clouds hide it', () => {
    const base = { daylight: 0, moonElevationDeg: 30, moonIllumination: 0.5, cloudCover: 0 } as const;
    expect(sky(base).moon).toBeCloseTo(0.5, 6);
    expect(sky({ ...base, moonIllumination: 0 }).moon).toBe(0);
    expect(sky({ ...base, moonElevationDeg: -2 }).moon).toBe(0);
    expect(sky({ ...base, cloudCover: 1 }).moon).toBe(0);
    // Shadows falling west (−x): the moon stands in the east – its mirror lies right of the centre.
    expect(sky({ ...base, moonShadowX: -1 }).moonX).toBeCloseTo(0.5 + MOON.swingShare, 6);
    expect(sky({ ...base, moonShadowX: 1 }).moonX).toBeCloseTo(0.5 - MOON.swingShare, 6);
    const low = sky({ ...base, moonElevationDeg: 5 }).moonY;
    const high = sky({ ...base, moonElevationDeg: 60 }).moonY;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThanOrEqual(Math.fround(MOON.topShare));
    expect(high).toBeLessThanOrEqual(Math.fround(MOON.bottomShare));
  });

  it('clouds hide the stars and grey the sky; twilight colours peak halfway through dawn and dusk', () => {
    expect(sky({ daylight: 0, cloudCover: 0.8 }).stars).toBe(0);
    expect(sky({ daylight: 0, cloudCover: 0.3 }).stars).toBeGreaterThan(0);
    const overcast = sky({ daylight: 1, cloudCover: 1 });
    const [gr, gg, gb] = paletteRgb(SKY.overcast);
    expect(overcast.zenithR).toBeCloseTo(gr * SKY.overcastShare + paletteRgb(SKY.dayZenith)[0] * (1 - SKY.overcastShare), 6);
    expect(overcast.zenithB - overcast.zenithR).toBeLessThan(paletteRgb(SKY.dayZenith)[2] - paletteRgb(SKY.dayZenith)[0]);
    expect([gr, gg, gb].every((v) => v > 0)).toBe(true);
    expect(twilightShare(0)).toBe(0);
    expect(twilightShare(1)).toBe(0);
    expect(twilightShare(0.5)).toBe(1);
  });

  it('M5-54: the mirrored sky is blue to cyan at every hour and weather – no violet (corruption, ART §8), no brown dusk', () => {
    // The palette references of every sky colour: water, ice and stone greys only.
    for (const ref of [SKY.dayZenith, SKY.dayHorizon, SKY.duskZenith, SKY.duskHorizon, SKY.nightZenith, SKY.nightHorizon, SKY.overcast]) {
      expect(ref, ref).not.toMatch(/^(verderb|laub|feuer|holz|erde|haut|sand)\./);
    }
    /** Hue [degrees] and chroma (max − min) of a linear RGB colour. */
    const hue = (r: number, g: number, b: number): { h: number; chroma: number } => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const c = max - min;
      if (c <= 0) return { h: Number.NaN, chroma: 0 };
      const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
      return { h: (h * 60 + 360) % 360, chroma: c };
    };
    let checked = 0;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      for (const cloudCover of [0, 0.05, 0.3, 0.75, 1]) {
        const s = sky({ daylight: d, cloudCover, sunElevationDeg: d > 0.2 ? 20 : -10 });
        for (const [r, g, b] of [
          [s.zenithR, s.zenithG, s.zenithB],
          [s.horizonR, s.horizonG, s.horizonB],
        ] as const) {
          const { h, chroma } = hue(r, g, b);
          if (chroma < 0.02) continue;
          checked++;
          expect(h, `Tageslicht ${d.toFixed(2)}, Bedeckung ${cloudCover}: ${[r, g, b].map((v) => v.toFixed(3)).join(' ')}`).toBeGreaterThanOrEqual(180);
          expect(h).toBeLessThanOrEqual(240);
          // Blue dominates red: never a warm or purple mirror.
          expect(b).toBeGreaterThan(r);
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
    // Halfway through dusk (twilight colours at their fullest) the zenith lies between the day's and the night's.
    const dusk = sky({ daylight: 0.5 });
    const day = sky({ daylight: 1 });
    const night = sky({ daylight: 0 });
    expect(dusk.zenithB).toBeLessThan(day.zenithB);
    expect(dusk.zenithB).toBeGreaterThan(night.zenithB);
  });

  it('underground there is no sky to mirror', () => {
    const s = sky({ daylight: 1, underground: true, moonElevationDeg: 30, moonIllumination: 1 });
    expect([s.share, s.stars, s.moon, s.glitter, s.sunlight, s.zenithR + s.horizonB]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('water settings (§6.3 "Wasser: vereinfacht / voll ohne Spiegelung / voll")', () => {
  const at = (q: QualityLevel, reducedMotion = false) => {
    const s = defaultSettings();
    return waterSettingsFrom({ graphics: { ...s.graphics, ...QUALITY_PRESETS[q], quality: q }, accessibility: { ...s.accessibility, reducedMotion } });
  };

  it('Niedrig: simplified – no refraction, reflection, simulated waves or caustics', () => {
    expect(at('low')).toMatchObject({ refraction: false, reflection: false, waves: false, caustics: false });
  });

  it('Mittel: everything but the mirror', () => {
    expect(at('medium')).toMatchObject({ refraction: true, reflection: false, waves: true, caustics: true });
  });

  it('Hoch and Ultra: everything; the fresh profile is Hoch', () => {
    for (const q of ['high', 'ultra'] as const) expect(at(q)).toMatchObject({ refraction: true, reflection: true, waves: true, caustics: true });
    expect(DEFAULT_WATER_SETTINGS).toEqual(at('high'));
  });

  it('reduced motion calms the ambient waves', () => {
    expect(at('high').motionScale).toBe(1);
    expect(at('high', true).motionScale).toBeLessThan(1);
  });
});

describe('palette colours of the water shaders', () => {
  it('every colour is a palette colour, written as a GLSL vec3', () => {
    const defines = waterShaderDefines();
    for (const [name, ref] of Object.entries(WATER_COLOURS)) {
      const [r, g, b] = paletteRgb(ref);
      expect(defines[name]).toBe(glslColour(ref));
      expect(defines[name]).toBe(`vec3(${r.toFixed(5)}, ${g.toFixed(5)}, ${b.toFixed(5)})`);
    }
  });
});
