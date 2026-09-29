/**
 * B2 und Minor 3 der M5-Prüfung: Wasser bei Tag.
 * - **Sonnenglitzern** liegt auf dem Spiegelpfad der Sonne (nach Azimut und Höhe platziert wie der Mondpfad), nur wo die
 *   Sonne das Wasser erreicht (das Licht der Komposition verrät Baum-, Haus- und Wolkenschatten), als kurze Striche
 *   entlang der Wellenkämme, unter der Bloom-Schwelle (kein Hof) – nie ein Sternenfeld.
 * - **Der tiefe See** ist bei Tag blau statt schwarz: das Terrain dunkelt tiefes Wasser um höchstens eine Rampenstufe,
 *   der Wasser-Pass absorbiert zum Tiefblau (nicht `wasser.0`), der Himmel hat bei Tag ≈ 0,45 Anteil – auch auf
 *   „Wasser vereinfacht“ und „ohne Spiegelung“, dort nur ohne Objekte, Sterne und Mond.
 * - **Barrierefreiheit:** Blitz- und Flackerreduktion verlangsamt Glitzern, Funkeln, Mondpfad und Gischt; reduzierte
 *   Bewegung verlangsamt die kleinen Wellen (nicht nur ihre Höhe), und das Glitzern wird dabei ruhiger, nicht stärker.
 * GLSL-Funktionen werden gegen ihre TypeScript-Spiegel gerechnet (`glslScalar`).
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { REDUCED_FLICKER_SCALE } from '../../../src/render/light/settings';
import { BLOOM } from '../../../src/render/passes/bloomPass';
import { SHADERS } from '../../../src/render/shaderLib';
import { waterShaderDefines } from '../../../src/render/water/defines';
import { glitterPath, sunSeen } from '../../../src/render/water/glitter';
import { AMBIENT_WAVES, DEPTH, GLITTER, SKY } from '../../../src/render/water/params';
import { waterSettingsFrom } from '../../../src/render/water/settings';
import { createSkyInput, paletteRgb, waterSkyInto } from '../../../src/render/water/sky';
import { daySky } from '../../../src/render/water/state';
import { TERRAIN_SHADING } from '../../../src/render/world/shading';
import { PALETTE_RAMPS } from '../../../src/generated/palette';
import { glslScalar } from './grading-glslScalar';

const DEFINES = waterShaderDefines();
/** The surface shader with its whitespace folded (for the checks of what it does where). */
const SURFACE = (SHADERS['water_surface.frag'] ?? '').replace(/\s+/g, ' ');

/** The body of GLSL function `name` of the surface shader (folded whitespace). */
function body(name: string): string {
  const src = SHADERS['water_surface.frag'] ?? '';
  const m = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (m === null) throw new Error(`water_surface.frag: ${name} fehlt`);
  return (m[1] ?? '').replace(/\s+/g, ' ');
}

function sky(patch: Partial<ReturnType<typeof createSkyInput>>) {
  return waterSkyInto(daySky(), { ...createSkyInput(), ...patch });
}

describe('Sonnenglitzern: auf dem Spiegelpfad, nur in der Sonne, unter der Bloom-Schwelle', () => {
  it('sunSeen: im vollen Schatten 0, in voller Sonne 1, unter einer Wolke dazwischen – GLSL = TypeScript', () => {
    const glsl = glslScalar('water_surface.frag', 'sunSeen', DEFINES);
    const level = 0.93;
    const share = 0.5;
    // Shade: only the sky part of the daylight reaches the pixel.
    expect(sunSeen(level * (1 - share), level, share)).toBeCloseTo(0, 12);
    // Sun: sky and sun together are the whole daylight.
    expect(sunSeen(level, level, share)).toBeCloseTo(1, 12);
    // A cloud takes 62 % of the sun: 38 % reach the water.
    expect(sunSeen(level * (1 - share + share * 0.38), level, share)).toBeCloseTo(0.38, 12);
    // No sun, no daylight: none.
    expect(sunSeen(1, level, 0)).toBe(0);
    expect(sunSeen(1, 0, share)).toBe(0);
    for (const light of [0, 0.2, 0.47, 0.8, 1.1, 2]) {
      for (const s of [0, 0.2, 0.5]) for (const l of [0, 0.3, 1]) expect(glsl(light, l, s), `${light} ${l} ${s}`).toBeCloseTo(sunSeen(light, l, s), 12);
    }
    // The glints need most of the sun: none in a cloud's shade, all in the open.
    expect(GLITTER.sunFrom).toBeGreaterThan(0.38);
    expect(GLITTER.sunFull).toBeLessThanOrEqual(1);
  });

  it('glitterPath: ein Oval vom Spiegelpunkt zum Betrachter, 1 in der Mitte, 0 am Rand und darüber hinaus – GLSL = TypeScript', () => {
    const glsl = glslScalar('water_surface.frag', 'glitterPath', DEFINES);
    const len = 180;
    const w = 200;
    expect(glitterPath(0, len / 2, len, w)).toBeCloseTo(1, 12);
    // Above the mirror point and beyond the path's near end: nothing.
    expect(glitterPath(0, -1, len, w)).toBe(0);
    expect(glitterPath(0, len + 1, len, w)).toBe(0);
    // Symmetric about its axis, falling off to its rim; narrower at the mirror point than towards the viewer.
    expect(glitterPath(-40, 90, len, w)).toBeCloseTo(glitterPath(40, 90, len, w), 12);
    expect(glitterPath(80, 90, len, w)).toBeLessThan(glitterPath(40, 90, len, w));
    expect(glitterPath(0.9 * w * GLITTER.startWidth, 1, len, w)).toBe(0);
    expect(glitterPath(0.9 * w * GLITTER.startWidth, len - 30, len, w)).toBeGreaterThan(0);
    for (let dx = -260; dx <= 260; dx += 37) {
      for (let dy = -20; dy <= 200; dy += 23) expect(glsl(dx, dy, len, w), `${dx} ${dy}`).toBeCloseTo(glitterPath(dx, dy, len, w), 12);
    }
  });

  it('der Spiegelpunkt folgt der Sonne: Ost rechts, West links; hoch steht er kürzer und breiter, tief lang und schmal; nachts und bedeckt kein Glitzern', () => {
    const morning = sky({ sunElevationDeg: 20, sunShadowX: -0.9 });
    const evening = sky({ sunElevationDeg: 20, sunShadowX: 0.9 });
    const noon = sky({ sunElevationDeg: 62, sunShadowX: 0 });
    expect(morning.sunX).toBeGreaterThan(0.5);
    expect(evening.sunX).toBeLessThan(0.5);
    expect(noon.sunX).toBeCloseTo(0.5, 12);
    expect(noon.sunPath).toBeLessThan(morning.sunPath);
    expect(noon.sunPathWidth).toBeGreaterThan(morning.sunPathWidth);
    // A high sun's mirror lies nearer the viewer (lower in the picture).
    expect(noon.sunY).toBeGreaterThan(morning.sunY);
    expect(noon.glitter).toBeGreaterThan(0);
    // Night and overcast: no glitter at all.
    expect(sky({ sunElevationDeg: -5, daylight: 0 }).glitter).toBe(0);
    expect(sky({ sunElevationDeg: 50, cloudCover: 1 }).glitter).toBe(0);
    // Every mirror path lies in the view.
    for (const s of [morning, evening, noon]) {
      expect(s.sunX).toBeGreaterThan(0);
      expect(s.sunX).toBeLessThan(1);
      expect(s.sunY + s.sunPath).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('ein Glitzerpunkt bleibt unter dem Knie der Bloom-Schwelle: kein Hof um jeden Punkt', () => {
    const peak = Math.max(...paletteRgb(GLITTER.color)) * GLITTER.level;
    expect(peak).toBeLessThanOrEqual(BLOOM.threshold - BLOOM.knee);
    expect(GLITTER.cover).toBeLessThanOrEqual(1);
    // It is laid over the water (mix), not added on top of it.
    expect(SURFACE).toContain('c = mix(c, DH_COL_GLITTER * DH_GLITTER_LEVEL, glitter);');
    expect(SURFACE).not.toMatch(/c \+= DH_COL_GLITTER/);
  });

  it('Striche entlang eines Wellenkamms, eine Richtung, nie ein einzelnes Pixel; nur auf dem Pfad, in der Sonne, ohne gespiegeltes Objekt', () => {
    const glint = body('trainGlint');
    // On the line where the train's flank faces the mirror point most, one pixel wide.
    expect(glint).toContain('if (abs(off) * wl / TAU > 0.5 * DH_GLITTER_LINE) return false;');
    // Segments along the crest, every other one, at least DH_GLITTER_MIN_LENGTH of a segment long.
    expect(glint).toContain('float along = dot(world, vec2(-d.y, d.x)) / DH_GLITTER_SEGMENT;');
    expect(glint).toContain('if (mod(segment, 2.0) > 0.5) return false;');
    expect(glint).toContain('mix(DH_GLITTER_MIN_LENGTH, 1.0,');
    expect(GLITTER.minLength * GLITTER.segmentPx).toBeGreaterThanOrEqual(2);
    // Its slots run on the flicker clock.
    expect(glint).toContain('floor(uFlickerTime * DH_GLITTER_FLICKER');
    const sun = body('sunGlitter');
    expect(sun).toContain('smoothstep(DH_GLITTER_SUN_FROM, DH_GLITTER_SUN_FULL, seen) * uGlitter');
    expect(sun).toContain('glitterPath(d.x, d.y, uSunPath.x, uSunPath.y)');
    // One train: the one whose crests run most nearly across the picture.
    expect(sun).toContain('bool glint = y1 >= y0 && y1 >= y2 ?');
    expect(SURFACE).toContain('if (uGlitter > 0.0 && foam < 0.5 && mirrored < 0.5 && !calm) {');
    expect(SURFACE).toContain('float seen = sunSeen(dot(lit, LUMA) / max(dot(albedo, LUMA), 0.02), dot(uDaylight, LUMA), uSunShare);');
  });

  it('reduzierte Bewegung macht das Glitzern ruhiger, nicht stärker: die Neigung wird nur durch die Wellenhöhe des Windes geteilt', () => {
    const sun = body('sunGlitter');
    // The facing of the small waves over their largest slope in the wind – without the reduced motion's scale, so the
    // calmer waves (× uMotion in their slope) face the mirror point less and glint less.
    expect(sun).toContain('float facing = dot(a.slope, toward) / ambientAmplitude();');
    expect(body('ambientAmplitude')).not.toContain('uMotion');
    expect(body('ambientWaves')).toContain('a.slope = s * ambientAmplitude() * uMotion;');
    // The interactive field's slope is not part of that facing.
    expect(sun).not.toContain('field');
  });
});

describe('der tiefe See bei Tag: blau, nicht schwarz', () => {
  it('das Terrain dunkelt tiefes Wasser um höchstens eine Stufe, der Wasser-Pass absorbiert zum Tiefblau', () => {
    expect(TERRAIN_SHADING.waterMaxSteps).toBeLessThanOrEqual(1);
    const [ramp, step] = DEPTH.deepColor.split('.');
    expect(ramp).toBe('wasser');
    expect(Number(step)).toBeGreaterThanOrEqual(1);
    expect(Number(step)).toBeLessThanOrEqual(2);
    expect(PALETTE_RAMPS.some((r) => r.name === ramp)).toBe(true);
  });

  it('bei Tag ≈ 0,45 Himmel im Wasser; die Nacht behält ihren größeren Anteil für Sterne und Mond', () => {
    expect(SKY.dayShare).toBeCloseTo(0.45, 12);
    expect(SKY.nightShare).toBeGreaterThan(SKY.dayShare);
    expect(sky({ daylight: 1 }).share).toBeCloseTo(0.45, 6);
  });

  it('ohne Spiegelung (Niedrig, Mittel) bleibt die schlichte Himmelstönung; nur Objekte, Sterne, Mond und Glitzern fallen weg', () => {
    const colour = body('waterColour');
    // No early return before the sky: the plain tint is mixed on every level.
    expect(colour).not.toContain('if (!reflect_) return c;');
    expect(colour).toContain('vec4 object = !reflect_ || skyOnly ? vec4(0.0) : objectReflection(');
    expect(colour).toContain('return mix(c, mix(sky, object.rgb, object.a), share);');
    // Stars, moon and glitter are switched off by the mirror flag (uFrame[6].x).
    expect(SURFACE).toContain('#define uStars (uSky[2].x * uFrame[6].x)');
    expect(SURFACE).toContain('#define uGlitter (uSky[2].y * uFrame[6].x)');
    expect(SURFACE).toContain('uSky[2].w * uFrame[6].x');
  });
});

describe('Barrierefreiheit: Flackern und Bewegung', () => {
  const at = (flashReduction: boolean, reducedMotion: boolean) => {
    const s = defaultSettings();
    return waterSettingsFrom({ graphics: s.graphics, accessibility: { ...s.accessibility, flashReduction, reducedMotion } });
  };

  it('Blitz- und Flackerreduktion verlangsamt Glitzern, Sternfunkeln, Mondpfad und Gischt unter Wasserfällen', () => {
    expect(at(false, false).flicker).toBe(1);
    expect(at(true, false).flicker).toBe(REDUCED_FLICKER_SCALE);
    expect(at(true, false).flicker).toBeLessThan(1);
    // Every sparkle, twinkle and churn runs on the flicker clock, none on the plain presentation clock.
    for (const fn of ['trainGlint', 'starAt', 'moonAt', 'fallFoam']) {
      expect(body(fn), fn).toContain('uFlickerTime');
      expect(body(fn), fn).not.toMatch(/\buTime\b/);
    }
  });

  it('reduzierte Bewegung verlangsamt die kleinen Wellen (Laufweg integriert, s. wellen-impulse) statt nur ihre Höhe', () => {
    expect(at(false, true).motionScale).toBe(AMBIENT_WAVES.reducedMotion);
    expect(body('trainPhase')).not.toMatch(/\buTime\b/);
    expect(body('ambientWaves')).toContain('uTravel.x');
  });
});
