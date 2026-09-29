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
import { crestIndex, glitterPath, sunSeen } from '../../../src/render/water/glitter';
import { AMBIENT_WAVES, CAUSTICS, DEPTH, FOAM, GLITTER, IMMERSION, LIGHT_FLOORS, LUMA as WATER_LUMA, MOTION_CLOCK, motionRate, SKY } from '../../../src/render/water/params';
import { LUMA } from '../../../src/render/post/grading';
import { waterSettingsFrom } from '../../../src/render/water/settings';
import { createSkyInput, paletteRgb, waterSkyInto } from '../../../src/render/water/sky';
import { daySky } from '../../../src/render/water/state';
import { TERRAIN_SHADING } from '../../../src/render/world/shading';
import { PALETTE_RAMPS } from '../../../src/generated/palette';
import { glslScalar } from './grading-glslScalar';

const DEFINES = waterShaderDefines();
/** The surface shader's own constants a scalar mirror needs besides the defines. */
const CONSTANTS = { ...DEFINES, TAU: '6.2831853' };
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
    expect(SURFACE).toContain('if (uGlitter > 0.0 && foam < FOAM_SHADED && mirrored < 0.5 && !calm) {');
    expect(SURFACE).toContain('float seen = sunSeen(dot(lit, LUMA) / max(dot(albedo, LUMA), DH_FLOOR_ALBEDO_LUMA), dot(uDaylight, LUMA), uSunShare);');
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

describe('M5-42: der Kammindex des Glitzerns übersteht den Umbruch des Laufwegs', () => {
  it('crestIndex: die Kämme eines Zugs modulo travelWaves gezählt – GLSL = TypeScript, unverändert um travelWaves Wellen', () => {
    const glsl = glslScalar('water_surface.frag', 'crestIndex', CONSTANTS);
    const n = AMBIENT_WAVES.travelWaves;
    for (const target of [0, Math.PI]) {
      for (let k = -300; k <= 300; k += 7) {
        // A phase 0.1 rad beside the k-th crest line (the glints lie within half a pixel of it).
        const x = target + 2 * Math.PI * k + 0.1;
        const i = crestIndex(x, target);
        expect(glsl(x, target), `${k}`).toBe(i);
        expect(i).toBe(((k % n) + n) % n);
        // The travel's wrap moves the phase by travelWaves whole waves: the same count.
        expect(crestIndex(x + 2 * Math.PI * n, target)).toBe(i);
        expect(crestIndex(x - 2 * Math.PI * n, target)).toBe(i);
      }
    }
  });

  it('der Strich würfelt mit der Zelle aus Kammindex und Segment; der Laufweg bricht erst nach travelWaves Wellenlängen um', () => {
    expect(body('trainGlint')).toContain('ivec2 cell = ivec2(int(crestIndex(x, target)), int(segment));');
    expect(DEFINES.DH_TRAVEL_WAVES).toBe(AMBIENT_WAVES.travelWaves.toFixed(1));
    // At full motion no train's travel wraps within a minute.
    for (const wl of AMBIENT_WAVES.wavelengthsPx) expect((wl * AMBIENT_WAVES.travelWaves) / AMBIENT_WAVES.speedPxPerSecond).toBeGreaterThanOrEqual(60);
  });
});

describe('M5-47: Wasser-Shader ohne Zahlen im Code, eine Luma, reduzierte Bewegung vollständig', () => {
  /** The shader without its comments. */
  const code = (SHADERS['water_surface.frag'] ?? '').replace(/\/\/.*$/gm, '');

  it('keine Zahlen im Code: nur Pixelgeometrie (Mitte, Hälfte, Nachbarn) und benannte Konstanten; Spreizung und Schritt der Zeitschlitze sind Parameter', () => {
    const geometry = new Set(['0.0', '0.5', '1.0', '1.5', '2.0', '0.25']);
    const stray: string[] = [];
    for (const line of code.split('\n')) {
      // Named constants (TAU, codes, sentinels) are the one place a number may stand.
      if (/^\s*const (float|int|vec3) [A-Z_0-9]+ =/.test(line)) continue;
      for (const m of line.matchAll(/(?<![A-Za-z_0-9.])\d+\.\d+(?:e-?\d+)?/g)) if (!geometry.has(m[0])) stray.push(`${m[0]}: ${line.trim()}`);
    }
    expect(stray).toEqual([]);
    // Time slots of every sparkle: spread and stride from the parameters (no `* 4.0`, `* 8.0`, `* 13`).
    for (const fn of ['fallFoam', 'moonAt', 'trainGlint']) expect(body(fn), fn).toMatch(/_SLOT_SPREAD\)/);
    expect(code).not.toMatch(/int\(slot\) \* \d/);
    // The second caustic layer, the Voronoi wobble, the foam and the stars read their parameters.
    expect(body('causticAt')).toContain('DH_CAUSTIC_LAYER_OFFSET');
    expect(body('causticAt')).toContain('DH_CAUSTIC_LINE_B');
    expect(body('voronoiEdge')).toContain('DH_CAUSTIC_WOBBLE * vec2(sin(wobble.x + TAU * h1), cos(wobble.y + TAU * h2))');
    expect(body('foamAt')).toContain('DH_FOAM_RIM_SHADE');
    expect(body('starAt')).toContain('DH_STAR_CROSS * level * twinkle');
    expect(DEFINES.DH_FOAM_OUTER_SURGE).toBe(String(FOAM.outerSurge));
    expect(DEFINES.DH_CAUSTIC_LAYER_OFFSET).toBe(`vec2(${CAUSTICS.layerOffsetPx[0].toFixed(1)}, ${CAUSTICS.layerOffsetPx[1].toFixed(1)})`);
  });

  it('eine Luma: das Wasser misst Licht mit der Luma der Post (Rec. 601) und benannten Böden', () => {
    expect(WATER_LUMA).toBe(LUMA);
    expect(DEFINES.DH_LUMA).toBe(`vec3(${LUMA.join(', ')})`);
    expect(code).toContain('const vec3 LUMA = DH_LUMA;');
    expect(code).not.toMatch(/0\.3, 0\.55|0\.55, 0\.15/);
    expect(body('lightOf')).toContain('max(dot(albedo, LUMA), DH_FLOOR_ALBEDO_LUMA)');
    expect(body('throughWater')).toContain('max(dot(light, LUMA), DH_FLOOR_LIGHT_LUMA)');
    expect(DEFINES.DH_FLOOR_ALBEDO_LUMA).toBe(String(LIGHT_FLOORS.albedoLuma));
  });

  it('reduzierte Bewegung vollständig: Kaustik-Zellwabern, Ufer-Brandung und die Wasserlinie laufen auf der Bewegungsuhr (Uhr × motionScale, integriert)', () => {
    // No part of the surface runs on the plain presentation clock any more.
    expect(code).not.toMatch(/\buTime\b/);
    expect(body('causticAt')).toContain('uMotionTime * DH_CAUSTIC_WOBBLE_A');
    expect(body('causticAt')).toContain('uMotionTime * DH_CAUSTIC_WOBBLE_B');
    expect(body('foamAt')).toContain('sin(uMotionTime * DH_FOAM_SURGE_RATE');
    expect(code).toContain('sin(uMotionTime * DH_IMMERSE_WOBBLE_SPEED');
    // Every speed on the motion clock is whole turns per its period: the wrap shows no seam.
    const P = MOTION_CLOCK.periodSeconds;
    const rates = [
      ['DH_CAUSTIC_WOBBLE_A', motionRate(CAUSTICS.wobbleSpeed[0]), CAUSTICS.wobbleSpeed[0]],
      ['DH_CAUSTIC_WOBBLE_B', motionRate(CAUSTICS.wobbleSpeed[1] * CAUSTICS.layerWobble), CAUSTICS.wobbleSpeed[1] * CAUSTICS.layerWobble],
      ['DH_FOAM_SURGE_RATE', motionRate((2 * Math.PI) / FOAM.surgePeriodSeconds), (2 * Math.PI) / FOAM.surgePeriodSeconds],
      ['DH_IMMERSE_WOBBLE_SPEED', motionRate(IMMERSION.wobbleSpeed), IMMERSION.wobbleSpeed],
    ] as const;
    for (const [name, rate, authored] of rates) {
      expect(DEFINES[name], name).toContain(String(rate));
      expect(Math.abs(((rate * P) / (2 * Math.PI)) % 1), name).toBeLessThan(1e-9);
      expect(Math.abs(rate - authored), name).toBeLessThanOrEqual(Math.PI / P + 1e-12);
      for (const t of [-900.25, -3.5, 0, 17.0625, 1023.9375]) expect(Math.sin(rate * (t + P)), `${name} ${t}`).toBeCloseTo(Math.sin(rate * t), 9);
    }
  });
});
