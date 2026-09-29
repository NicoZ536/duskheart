/**
 * M5-14: the LUT generator of the colour grading – a neutral grade is the exact identity (every node an
 * exact 8-bit value, trilinear sampling returns every palette colour unchanged), each parameter moves the
 * colours the way its name says, grades blend as vectors, the colour-blind modes of the settings fold into
 * the same LUT (greys stay, confusable colours move apart for that viewer), and the atmosphere table covers
 * every biome and weather of the content with valid palette references.
 */
import { describe, expect, it } from 'vitest';
import { BIOMES } from '../../../src/content/biomes';
import { WEATHER_STATE_IDS } from '../../../src/content/weather';
import { COLORBLIND_MODES } from '../../../src/engine/settings';
import { PALETTE_HEX, RARITY_REFS } from '../../../src/generated/palette';
import { parseHexColor } from '../../../src/render/palette/lut';
import { SHADERS } from '../../../src/render/shaderLib';
import { WEATHER_MIN_LIGHT_FACTOR } from '../../../src/content/weather';
import { EMISSIVE_RANGE, GLOSS, gbufferDefines } from '../../../src/render/gbuffer';
import { HDR_FALLBACK_RANGE } from '../../../src/render/gl/formats';
import { MOONLIGHT } from '../../../src/render/light/lightColors';
import { NIGHT_AMBIENT } from '../../../src/render/world/gameScene';
import { waterShaderDefines } from '../../../src/render/water/defines';
import { LUMA as WATER_LUMA } from '../../../src/render/water/params';
import {
  addGradingDelta,
  colorblindMatrix,
  createGrading,
  daltonize,
  generateGradingLut,
  gradeColor,
  GRADING_INDEX,
  GRADING_KEYS,
  GRADING_LUT_BYTES,
  GRADING_LUT_SIZE,
  GRADING_PARAM_COUNT,
  GRADING_PIVOT,
  gradingDistance,
  GradingState,
  isNeutralGrading,
  luma,
  LUMA,
  mixGrading,
  NEUTRAL_GRADING,
  packGrading,
  sampleGradingLut,
  simulateColorblind,
  type ColorblindMode,
} from '../../../src/render/post/grading';
import { BIOME_ATMOSPHERE, CORRUPTION_GRADING, FALLBACK_BIOME, TWILIGHT_GRADING, WEATHER_ATMOSPHERE, paletteColor } from '../../../src/render/post/atmosphereTable';

const out: [number, number, number] = [0, 0, 0];
const lutOf = (params: Parameters<typeof createGrading>[0]): Uint8Array => generateGradingLut(createGrading(params), new Uint8Array(GRADING_LUT_BYTES));

describe('Grading-LUT (Generator)', () => {
  it('neutral: every node holds exactly its own 8-bit colour (255 / 15 = 17 is whole)', () => {
    expect((255 / (GRADING_LUT_SIZE - 1)) % 1).toBe(0);
    const lut = lutOf(NEUTRAL_GRADING);
    const n = GRADING_LUT_SIZE;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const o = ((z * n + y) * n + x) * 4;
          expect([lut[o], lut[o + 1], lut[o + 2], lut[o + 3]]).toEqual([x * 17, y * 17, z * 17, 255]);
        }
  });

  it('neutral: trilinear sampling returns every palette colour and every grey level exactly', () => {
    const lut = lutOf(NEUTRAL_GRADING);
    const check = (r: number, g: number, b: number): void => {
      const s = sampleGradingLut(lut, r / 255, g / 255, b / 255, out);
      expect(s.map((v) => Math.round(v * 255))).toEqual([r, g, b]);
    };
    for (const hex of PALETTE_HEX) check(...parseHexColor(hex));
    for (let v = 0; v < 256; v++) check(v, 255 - v, (v * 7) % 256);
  });

  it('neutral grades are recognised (the post pass then skips the LUT); the vignette alone is no grade', () => {
    expect(isNeutralGrading(createGrading())).toBe(true);
    expect(isNeutralGrading(createGrading({ vignette: 0.6 }))).toBe(true);
    expect(isNeutralGrading(createGrading({ saturation: 0.9 }))).toBe(false);
    expect(isNeutralGrading(createGrading(BIOME_ATMOSPHERE['gruenhain']?.day))).toBe(true);
  });

  it('saturation 0 turns every colour grey at its luma; saturation > 1 spreads the channels', () => {
    const p = createGrading({ saturation: 0 });
    for (const hex of PALETTE_HEX) {
      const [r, g, b] = parseHexColor(hex).map((v) => v / 255) as [number, number, number];
      const [gr, gg, gb] = gradeColor(r, g, b, p, out);
      expect(gr).toBeCloseTo(gg, 10);
      expect(gg).toBeCloseTo(gb, 10);
      expect(gr).toBeCloseTo(Math.max(0, Math.min(1, luma(r, g, b))), 10);
    }
    const [r, , b] = gradeColor(0.6, 0.4, 0.2, createGrading({ saturation: 1.3 }), out);
    expect(r - b).toBeGreaterThan(0.4);
  });

  it('temperature warms (red up, blue down) and cools; tint pulls green', () => {
    const [wr, , wb] = gradeColor(0.5, 0.5, 0.5, createGrading({ temperature: 1 }), out);
    expect(wr).toBeGreaterThan(0.5);
    expect(wb).toBeLessThan(0.5);
    const [cr, , cb] = gradeColor(0.5, 0.5, 0.5, createGrading({ temperature: -1 }), out);
    expect(cr).toBeLessThan(0.5);
    expect(cb).toBeGreaterThan(0.5);
    expect(gradeColor(0.5, 0.5, 0.5, createGrading({ tint: -1 }), out)[1]).toBeGreaterThan(0.5);
  });

  it('contrast spreads around the pivot, lift raises the blacks, gain scales, gamma bends the middle', () => {
    const c = createGrading({ contrast: 1.5 });
    // The packed vector is Float32: parameters carry ~7 significant digits.
    expect(gradeColor(GRADING_PIVOT, GRADING_PIVOT, GRADING_PIVOT, c, out)[0]).toBeCloseTo(GRADING_PIVOT, 6);
    expect(gradeColor(0.2, 0.2, 0.2, c, out)[0]).toBeLessThan(0.2);
    expect(gradeColor(0.8, 0.8, 0.8, c, out)[0]).toBeGreaterThan(0.8);
    expect(gradeColor(0, 0, 0, createGrading({ liftR: 0.1, liftG: 0.1, liftB: 0.1 }), out)[0]).toBeCloseTo(0.1, 6);
    expect(gradeColor(0.5, 0.5, 0.5, createGrading({ gainR: 1.2 }), out)[0]).toBeCloseTo(0.6, 6);
    expect(gradeColor(0.25, 0.25, 0.25, createGrading({ gammaG: 2 }), out)[1]).toBeCloseTo(0.5, 6);
  });

  it('split toning tints the shadows and highlights with their colour and leaves black and white', () => {
    const violet = paletteColor('verderb.2');
    // Tints are stored premultiplied by their amount (colour · amount).
    const p = createGrading({ shadowR: violet[0] * 0.5, shadowG: violet[1] * 0.5, shadowB: violet[2] * 0.5, shadowAmount: 0.5 });
    const [r, g, b] = gradeColor(0.2, 0.2, 0.2, p, out);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
    const gold = paletteColor('laub.4');
    const h = createGrading({ highlightR: gold[0] * 0.5, highlightG: gold[1] * 0.5, highlightB: gold[2] * 0.5, highlightAmount: 0.5 });
    const [hr, , hb] = gradeColor(0.8, 0.8, 0.8, h, out);
    expect(hr).toBeGreaterThan(hb);
    expect(gradeColor(0, 0, 0, p, out)).toEqual([0, 0, 0]);
  });

  it('blended tints mix their hues by weight – stacked grades never cancel a tint into a colour blow-up', () => {
    // Dusk (violet-blue shadows) + a night grade + full corruption (violet shadows): weights sum past 1.
    const gruenhain = BIOME_ATMOSPHERE.gruenhain;
    if (gruenhain === undefined) throw new Error('Grünhain fehlt in der Atmosphärentabelle');
    const p = createGrading();
    addGradingDelta(p, TWILIGHT_GRADING.dusk, 1);
    addGradingDelta(p, gruenhain.night, 0.6);
    addGradingDelta(p, CORRUPTION_GRADING, 1);
    const grass = [0x4b / 255, 0x8c / 255, 0x3c / 255] as const;
    const [r, g, b] = gradeColor(...grass, p, out);
    // Shading survives: the graded grass is no single saturated channel and keeps a plausible luma.
    const l = luma(r, g, b);
    const lIn = luma(...grass);
    expect(l).toBeGreaterThan(lIn * 0.5);
    expect(l).toBeLessThan(lIn * 1.5);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.5);
    // The mixed tint lies between its parts: a shadow graded by the sum is violet-blue, not a clipped primary.
    const [sr, sg, sb] = gradeColor(0.15, 0.15, 0.15, p, out);
    expect(sb).toBeGreaterThan(sg);
    expect(Math.max(sr, sg, sb)).toBeLessThan(0.4);
  });

  it('every graded channel stays in 0…1 and rises monotonically with its input (no inverted ramps)', () => {
    const grades = [
      ...Object.values(BIOME_ATMOSPHERE).flatMap((a) => [a.day, a.night]),
      TWILIGHT_GRADING.dusk,
      TWILIGHT_GRADING.dawn,
      CORRUPTION_GRADING,
      ...Object.values(WEATHER_ATMOSPHERE).map((w) => w.grading),
    ];
    for (const g of grades) {
      const p = createGrading(g);
      for (let c = 0; c < 3; c++) {
        let prev = -1;
        for (let i = 0; i <= 32; i++) {
          const v = i / 32;
          const rgb: [number, number, number] = [0.3, 0.3, 0.3];
          rgb[c] = v;
          const gv = gradeColor(rgb[0], rgb[1], rgb[2], p, out)[c] as number;
          expect(gv).toBeGreaterThanOrEqual(0);
          expect(gv).toBeLessThanOrEqual(1);
          expect(gv).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = gv;
        }
      }
    }
  });

  it('the LUT stores what gradeColor computes at its nodes; a too small buffer is refused', () => {
    const p = createGrading(BIOME_ATMOSPHERE['glutsand']?.day);
    const lut = generateGradingLut(p, new Uint8Array(GRADING_LUT_BYTES));
    const x = 3;
    const y = 9;
    const z = 14;
    const o = ((z * GRADING_LUT_SIZE + y) * GRADING_LUT_SIZE + x) * 4;
    const [r, g, b] = gradeColor(x / 15, y / 15, z / 15, p, out);
    expect([lut[o], lut[o + 1], lut[o + 2]]).toEqual([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
    expect(() => generateGradingLut(p, new Uint8Array(16))).toThrow(/reichen nicht/);
  });

  it('grades blend as vectors: deltas from neutral add, mixing interpolates, the distance measures the change', () => {
    const t = createGrading();
    addGradingDelta(t, { saturation: 0.5, temperature: 0.4 }, 0.5);
    expect(t[GRADING_INDEX.saturation]).toBeCloseTo(0.75, 6);
    expect(t[GRADING_INDEX.temperature]).toBeCloseTo(0.2, 6);
    expect(t[GRADING_INDEX.contrast]).toBe(1);
    const a = createGrading({ contrast: 1.2 });
    const b = createGrading({ contrast: 0.8 });
    const m = mixGrading(createGrading(), a, b, 0.25);
    expect(m[GRADING_INDEX.contrast]).toBeCloseTo(1.1, 6);
    expect(gradingDistance(a, b)).toBeCloseTo(0.4, 6);
    expect(packGrading({}, new Float32Array(GRADING_PARAM_COUNT))).toEqual(createGrading());
    expect(GRADING_KEYS).toHaveLength(GRADING_PARAM_COUNT);
    const state = new GradingState();
    state.active = true;
    state.beginFrame();
    expect(state.active).toBe(false);
  });
});

describe('Farbenblind-Modi (in der Grading-LUT)', () => {
  const corrected = COLORBLIND_MODES.filter((m): m is Exclude<ColorblindMode, 'none'> => m !== 'none');
  const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number));

  it("'none' changes nothing; greys stay grey in every mode; results stay within 0…1", () => {
    for (const hex of PALETTE_HEX) {
      const c = parseHexColor(hex).map((v) => v / 255) as [number, number, number];
      expect(daltonize('none', ...c, [0, 0, 0])).toEqual(c);
      for (const m of corrected) for (const v of daltonize(m, ...c, [0, 0, 0])) expect(v >= 0 && v <= 1).toBe(true);
    }
    for (const m of corrected) {
      for (let i = 0; i <= 10; i++) {
        const [r, g, b] = daltonize(m, i / 10, i / 10, i / 10, [0, 0, 0]);
        expect(Math.abs(r - i / 10)).toBeLessThan(1 / 255);
        expect(Math.abs(g - i / 10)).toBeLessThan(1 / 255);
        expect(Math.abs(b - i / 10)).toBeLessThan(1 / 255);
      }
    }
  });

  it('the rarity colours a viewer confuses most move apart for that viewer', () => {
    const rarity = Object.values(RARITY_REFS).map((ref) => paletteColor(ref));
    for (const m of corrected) {
      let worst = { i: 0, j: 1, d: Infinity };
      for (let i = 0; i < rarity.length; i++) {
        for (let j = i + 1; j < rarity.length; j++) {
          const d = dist(simulateColorblind(m, ...(rarity[i] as [number, number, number]), [0, 0, 0]), simulateColorblind(m, ...(rarity[j] as [number, number, number]), [0, 0, 0]));
          if (d < worst.d) worst = { i, j, d };
        }
      }
      const a = daltonize(m, ...(rarity[worst.i] as [number, number, number]), [0, 0, 0]);
      const b = daltonize(m, ...(rarity[worst.j] as [number, number, number]), [0, 0, 0]);
      const after = dist(simulateColorblind(m, ...a, [0, 0, 0]), simulateColorblind(m, ...b, [0, 0, 0]));
      expect(after, m).toBeGreaterThan(worst.d);
    }
  });

  it('the correction is one matrix in display space: clamp(M · c) is daltonize for every colour; none is the identity', () => {
    expect(colorblindMatrix('none', new Array<number>(9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const colors: Array<[number, number, number]> = PALETTE_HEX.map((hex) => parseHexColor(hex).map((v) => v / 255) as [number, number, number]);
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) for (let k = 0; k <= 6; k++) colors.push([i / 6, j / 6, k / 6]);
    for (const m of corrected) {
      const M = colorblindMatrix(m, new Float32Array(9));
      for (const [r, g, b] of colors) {
        const want = daltonize(m, r, g, b, [0, 0, 0]);
        for (let c = 0; c < 3; c++) {
          const v = Math.max(0, Math.min(1, (M[c * 3] as number) * r + (M[c * 3 + 1] as number) * g + (M[c * 3 + 2] as number) * b));
          expect(v).toBeCloseTo(want[c] as number, 5);
        }
      }
    }
  });

  it('one luma for grading, corruption, the post shaders and the water (review M5 Minor 10, M5-47)', () => {
    expect(LUMA).toEqual([0.299, 0.587, 0.114]);
    expect(luma(1, 0, 0)).toBe(LUMA[0]);
    expect(luma(0, 0, 1)).toBe(LUMA[2]);
    const post = SHADERS['post.glsl'] ?? '';
    expect(post).toContain('dot(c, DH_LUMA)');
    expect(post).not.toMatch(/0\.299|0\.587|0\.114/);
    // The water measures its light with the same luma (lightOf, the sun on the water, a body under water).
    expect(WATER_LUMA).toBe(LUMA);
    expect(waterShaderDefines().DH_LUMA).toBe(`vec3(${LUMA.join(', ')})`);
    const water = SHADERS['water_surface.frag'] ?? '';
    expect(water).toContain('const vec3 LUMA = DH_LUMA;');
    expect(water).not.toMatch(/0\.299|0\.587|0\.114|0\.3, 0\.55/);
  });

  it('one gloss of snow for the terrain and the sprites (review M5 Minor 10)', () => {
    expect(GLOSS.snow).toBeGreaterThan(GLOSS.matte);
    expect(gbufferDefines().DH_GLOSS_SNOW).toBe(String(GLOSS.snow));
    for (const file of ['world/terrain.frag', 'sprite_gbuffer.frag']) expect(SHADERS[file], file).toContain('const float SNOW_GLOSS = DH_GLOSS_SNOW;');
  });

  it('the LUT holds grade then correction at its nodes; the neutral LUT of a mode is no identity', () => {
    const p = createGrading(TWILIGHT_GRADING.dusk);
    const lut = generateGradingLut(p, new Uint8Array(GRADING_LUT_BYTES), GRADING_LUT_SIZE, 'deuteranopia');
    const [x, y, z] = [12, 4, 2];
    const o = ((z * GRADING_LUT_SIZE + y) * GRADING_LUT_SIZE + x) * 4;
    const graded = gradeColor(x / 15, y / 15, z / 15, p, [0, 0, 0]);
    const [r, g, b] = daltonize('deuteranopia', ...graded, [0, 0, 0]);
    expect([lut[o], lut[o + 1], lut[o + 2]]).toEqual([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
    const neutral = generateGradingLut(createGrading(), new Uint8Array(GRADING_LUT_BYTES), GRADING_LUT_SIZE, 'protanopia');
    expect(neutral).not.toEqual(lutOf({}));
  });
});

describe('Atmosphären-Tabelle (Biom × Tageszeit × Wetter)', () => {
  it('covers every biome and weather of the content, with valid palette references', () => {
    expect(Object.keys(BIOME_ATMOSPHERE).sort()).toEqual(BIOMES.map((b) => b.id).sort());
    expect(Object.keys(WEATHER_ATMOSPHERE).sort()).toEqual([...WEATHER_STATE_IDS].sort());
    expect(BIOME_ATMOSPHERE[FALLBACK_BIOME]).toBeDefined();
    for (const a of Object.values(BIOME_ATMOSPHERE)) {
      expect(() => paletteColor(a.fog.color)).not.toThrow();
      expect(a.fog.base).toBeGreaterThanOrEqual(0);
      expect(a.heat).toBeGreaterThanOrEqual(0);
      expect(a.heat).toBeLessThanOrEqual(1);
      expect(a.corruption).toBeGreaterThanOrEqual(0);
    }
    for (const w of Object.values(WEATHER_ATMOSPHERE)) if (w.fogColor !== null) expect(() => paletteColor(w.fogColor as string)).not.toThrow();
  });

  it('Grünhain by day is the neutral reference; the Nachtherz is corrupted land; hot biomes shimmer', () => {
    expect(isNeutralGrading(createGrading(BIOME_ATMOSPHERE['gruenhain']?.day))).toBe(true);
    expect(BIOME_ATMOSPHERE['nachtherz']?.corruption).toBe(1);
    expect(BIOME_ATMOSPHERE['glutsand']?.heat).toBeGreaterThan(0.5);
    expect(BIOME_ATMOSPHERE['nebelmoor']?.fog.base).toBeGreaterThan(BIOME_ATMOSPHERE['gruenhain']?.fog.base ?? 1);
    expect(WEATHER_ATMOSPHERE.hitzewelle.heat).toBeGreaterThan(0);
  });

  it('the night of Grünhain is cooler and bluer than its day, the dusk warmer (ART.md §5)', () => {
    const day = createGrading(BIOME_ATMOSPHERE['gruenhain']?.day);
    const night = createGrading(BIOME_ATMOSPHERE['gruenhain']?.night);
    const dusk = createGrading();
    addGradingDelta(dusk, TWILIGHT_GRADING.dusk, 1);
    const grass = parseHexColor('#4b8c3c').map((v) => v / 255) as [number, number, number];
    const [dr, , db] = gradeColor(...grass, day, [0, 0, 0]);
    const [nr, , nb] = gradeColor(...grass, night, [0, 0, 0]);
    const [ur, , ub] = gradeColor(...grass, dusk, [0, 0, 0]);
    expect(nb / Math.max(1e-6, nr)).toBeGreaterThan(db / Math.max(1e-6, dr));
    expect(ur / Math.max(1e-6, ub)).toBeGreaterThan(dr / Math.max(1e-6, db));
  });
});

describe('RGBA8-Rückfall: das Nachtminimum (Prüfung M5 Minor 5)', () => {
  it('the linear encoding keeps the range of the brightest emission; at the darkest night no palette colour falls to black', () => {
    // Why the range stays 4: the fallback holds what the float targets hold up to the brightest emission (flames at full
    // boost; the light buffer sums lights beyond 2) – a smaller range clips fire, bloom and light; a non-linear encoding
    // (RGBM, log) breaks the blending of fog, particles, puddles, lightning and the light buffer's accumulation.
    expect(HDR_FALLBACK_RANGE).toBeGreaterThanOrEqual(EMISSIVE_RANGE);
    // The darkest open night: new moon under the dimmest weather, in the moonlight's colour.
    const night = NIGHT_AMBIENT.base * WEATHER_MIN_LIGHT_FACTOR;
    for (const hex of PALETTE_HEX) {
      const c = parseHexColor(hex).map((v) => v / 255);
      const encoded = c.map((v, i) => Math.round(((v * (MOONLIGHT[i] as number) * night) / HDR_FALLBACK_RANGE) * 255));
      expect(Math.max(...encoded), hex).toBeGreaterThanOrEqual(1);
    }
  });
});
