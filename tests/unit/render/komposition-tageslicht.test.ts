/**
 * M5-04, M5-06: Komposition (MASTERPROMPT §6.1 Pass 6) – Albedo × Licht mit dem Tageslicht aus Himmelslicht × SDF-AO
 * und dem gerichteten Licht von Sonne oder Mond, dem Punktlicht (optional in 6–10 Bändern mit 4×4-Bayer-Dither),
 * Emission und Glanzlichtern. Geprüft: die Aufteilung des Umgebungslichts, die die Komposition als Uniforms bekommt
 * (auf einem flachen, besonnten Pixel genau das Umgebungslicht), die SDF-Umgebungsverdeckung am Fuß der Occluder
 * (CPU-Spiegel), die Bandzahl aus den Einstellungen und dass der Shader die Teile so zusammensetzt.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings, SETTING_RANGES } from '../../../src/engine/settings';
import { GLOSS } from '../../../src/render/gbuffer';
import { OccluderField, sdfOcclusion } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { DAYLIGHT_STEPS, lightStrandDefines, OCCLUDER_CLASS, POINT_OVER_DAYLIGHT, SDF, SDF_AO, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { lightSettingsFrom } from '../../../src/render/light/settings';
import { SkyState } from '../../../src/render/light/sky';
import { daylightParts, lightDirection, splitDaylight, type Rgb3 } from '../../../src/render/light/skyMath';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { bandThreshold, bayerThreshold, dayLevel, daylightStep, pointOverDaylight, pointOverPeak } from '../../../src/render/light/banding';
import { SHADERS } from '../../../src/render/shaderLib';
import { glslScalar } from './grading-glslScalar';

const rgb = (): Rgb3 => ({ r: 0, g: 0, b: 0 });

describe('Tageslicht der Komposition (M5-04)', () => {
  it('ohne gerichtetes Licht ist alles Himmelslicht (das Umgebungslicht von M1)', () => {
    const sky = new SkyState();
    sky.beginFrame();
    const s = rgb();
    const d = rgb();
    daylightParts(0.2, 0.3, 0.5, sky, s, d);
    expect([s.r, s.g, s.b, d.r, d.g, d.b]).toEqual([0.2, 0.3, 0.5, 0, 0, 0]);
  });

  it('mit Sonne: Himmel + Sonne = Umgebungslicht; im Schatten bleibt nur das kühlere Himmelslicht', () => {
    const sky = new SkyState();
    sky.beginFrame();
    splitDaylight(0.5, 0.14, sky.directional);
    lightDirection(0, -1, 60, sky.directional);
    const s = rgb();
    const d = rgb();
    daylightParts(1, 0.95, 0.9, sky, s, d);
    expect(s.r + d.r).toBeCloseTo(1, 12);
    expect(s.g + d.g).toBeCloseTo(0.95, 12);
    expect(s.b + d.b).toBeCloseTo(0.9, 12);
    // In the sun's shadow: half the light, leaning blue.
    expect(s.b / 0.9).toBeGreaterThan(s.r / 1);
    expect(s.g).toBeCloseTo(0.95 * 0.5, 12);
    // A flat pixel facing the viewer gets exactly the directed part: shade = 1 + relief · (n·l − l_z) = 1 for n = +z.
    const n = [0, 0, 1];
    const l = sky.directional;
    expect(1 + l.relief * (n[0]! * l.lx + n[1]! * l.ly + n[2]! * l.lz - l.lz)).toBe(1);
  });

  it('der Shader setzt Himmel × AO, Sonne × Relief × Silhouette × Wolke und das Punktlicht zusammen', () => {
    const src = (SHADERS['composite.frag'] ?? '').replace(/\s+/g, ' ');
    // Under a roof less sky reaches the floor (roofs and crowns on top keep all of it).
    // (Beyond the flood frame the occluder ring answers: `roofedAt`, M5 review M2.)
    expect(src).toContain('float roof = uHasFields == 1 && !top && roofedAt(uMask, ground) ? DH_ROOF_SKY : 1.0;');
    expect(src).toContain('vec3 day = uSkyLight * ao * roof;');
    expect(src).toContain('float shade = max(0.0, 1.0 + uDirRelief * (dot(gbufferNormal(g1), uDirDir) - uDirDir.z));');
    expect(src).toContain('float cloud = cloudShade(ground);');
    expect(src).toContain('day += uDirLight * shade * sun * cloud;');
    // The point light is banded in light levels, glints too; emission tops the light up.
    expect(src).toContain('dynamic = lightBands(dynamic, uBands, threshold);');
    expect(src).toContain('float threshold = dither ? bandThreshold(bayer4(floor(screen))) : 0.5;');
    expect(src).toContain('oColor = encodeHdr(max(lit, albedo * emission) + glint);');
  });

  it('M5-Review M1: das Punktlicht kommt weich über das Tageslicht – bei Tag bekommt ein besonntes Pixel nichts dazu, in Dämmerung und Nacht fast alles', () => {
    expect(POINT_OVER_DAYLIGHT.suppression).toBe(1);
    // The scene's daylight level: the brightest channel of the ambient, 0 … 1.
    expect(dayLevel(1, 0.97, 0.93)).toBe(1);
    expect(dayLevel(1.4, 1.2, 1)).toBe(1);
    expect(dayLevel(0.1, 0.12, 0.18)).toBeCloseTo(0.18, 12);
    expect(dayLevel(0, 0, 0)).toBe(0);
    // Noon on a flat, sunlit pixel: sky + sun = the ambient (1): the hearth adds nothing – no halo, no ray shadows.
    expect(pointOverDaylight(1, 1, 1, 1)).toBe(0);
    expect(pointOverDaylight(1.3, 1.2, 1.1, 1)).toBe(0);
    // By day in a shadow or a room only the sky's half lights the pixel: the torch keeps the other half.
    expect(pointOverDaylight(0.5, 0.5, 0.57, 1)).toBeCloseTo(0.43, 12);
    // Dusk (the scene's daylight 0.45 on a pixel lit by it): more than four fifths stay; a moonlit night nearly all; a
    // cave all of it.
    expect(pointOverDaylight(0.4, 0.42, 0.45, 0.45)).toBeGreaterThan(0.79);
    expect(pointOverDaylight(0.05, 0.07, 0.12, 0.12)).toBeGreaterThan(0.98);
    expect(pointOverDaylight(0, 0, 0, 0)).toBe(1);
    // A light never darkens, never adds more than before (day + point: the doubled light by day was the defect), adds
    // nothing to full daylight and all of it to the dark; a stronger light adds more; the lower the scene's daylight,
    // the more it keeps.
    for (const level of [0, 0.12, 0.45, 1]) {
      for (const day of [0, 0.1, 0.3, 0.5, 0.8, 1, 1.2]) {
        let last = -1;
        for (const point of [0, 0.4, 1, 1.6]) {
          const sum = day + point * pointOverDaylight(day, day, day, level);
          expect(sum).toBeGreaterThanOrEqual(day);
          expect(sum).toBeLessThanOrEqual(day + point + 1e-12);
          if (day >= 1 && level === 1) expect(sum).toBe(day);
          if (day === 0 || level === 0) expect(sum).toBe(day + point);
          expect(sum).toBeGreaterThanOrEqual(last);
          last = sum;
          if (level < 1) expect(pointOverDaylight(day, day, day, level)).toBeGreaterThanOrEqual(pointOverDaylight(day, day, day, 1));
        }
      }
    }
    // The shader: the factor from the daylight and the scene's level, applied to the light and its glints before their bands.
    const src = (SHADERS['composite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('float over = pointOverDaylight(day, uDayLevel);');
    expect(src).toContain('vec3 dynamic = decodeHdr(texelFetch(uDiffuse, p, 0)) * over;');
    expect(src).toContain('glint = decodeHdr(texelFetch(uSpecular, p, 0)) * over;');
    expect(src.indexOf('float over = pointOverDaylight(day, uDayLevel);')).toBeLessThan(src.indexOf('dynamic = lightBands(dynamic, uBands, threshold);'));
    // The function lives in its own include (M5-41: particles and fog add the same way) and the composition includes it.
    const glsl = (SHADERS['composite_daylight.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('return 1.0 - DH_POINT_DAY_SUPPRESSION * clamp(peak, 0.0, 1.0) * level;');
    expect(glsl).toContain('float pointOverDaylight(vec3 day, float level) { return pointOverPeak(max(max(day.r, day.g), day.b), level); }');
    expect(SHADERS['composite.frag']).toMatch(/^#include "composite_daylight\.glsl"$/m);
    expect(SHADERS['composite.glsl']).not.toContain('pointOverDaylight(');
    // GLSL = TypeScript mirror (the scalar core evaluated with the defines of the composition program).
    const glslOver = glslScalar('composite_daylight.glsl', 'pointOverPeak', lightStrandDefines());
    for (const level of [0, 0.04, 0.12, 0.36, 0.45, 0.8, 1]) {
      for (const peak of [-0.2, 0, 0.1, 0.36, 0.5, 0.9, 1, 1.4]) {
        expect(glslOver(peak, level)).toBeCloseTo(pointOverPeak(peak, level), 12);
        expect(pointOverDaylight(peak, peak * 0.5, peak * 0.25, level)).toBe(pointOverPeak(peak, level));
      }
    }
    // The light target is untouched: the light map comparison reads what the light pass drew.
    const point = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(point).not.toContain('pointOverDaylight');
  });

  it('M5-Review Minor 6: AO, Halbschatten und Wolkenränder in Bayer-Stufen – 1 bleibt 1, Übergänge in Pixelgröße', () => {
    expect(DAYLIGHT_STEPS.levels).toBe(8);
    // Unshadowed daylight stays exact (palette colours as painted).
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(daylightStep(1, bandThreshold(bayerThreshold(x, y)))).toBe(1);
    // Every value lands on a step of 1/8, at most one step from where it was.
    for (let v = 0.3; v <= 1; v += 0.01) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const s = daylightStep(v, bandThreshold(bayerThreshold(x, y)));
          expect(Math.abs(s * DAYLIGHT_STEPS.levels - Math.round(s * DAYLIGHT_STEPS.levels))).toBeLessThan(1e-9);
          expect(Math.abs(s - v)).toBeLessThanOrEqual(1 / DAYLIGHT_STEPS.levels);
        }
      }
    }
    // A smooth ramp (a cloud edge from 0.38 to 1 over 32 px) becomes a few flat steps with dithered seams: the
    // 4×4 cell's average follows the ramp, each pixel holds a step.
    const values = new Set<number>();
    for (let x = 0; x < 32; x++) {
      const v = 0.38 + (0.62 * x) / 31;
      let mean = 0;
      for (let y = 0; y < 4; y++) {
        const s = daylightStep(v, bandThreshold(bayerThreshold(x, y)));
        values.add(s);
        mean += s / 4;
      }
      expect(Math.abs(mean - v)).toBeLessThan(0.75 / DAYLIGHT_STEPS.levels);
    }
    expect(values.size).toBeLessThanOrEqual(DAYLIGHT_STEPS.levels);
    // The shader steps AO, sun visibility (by its brightest channel: stained glass keeps its hue) and the cloud shade.
    const src = (SHADERS['composite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('if (dither) ao = daylightStep(ao, threshold);');
    expect(src).toContain('sun = lightBands(sun, DH_DAY_STEPS, threshold);');
    expect(src).toContain('cloud = daylightStep(cloud, threshold);');
  });
});

describe('SDF-Umgebungsverdeckung (M5-04: Umgebungslicht × SDF-AO)', () => {
  const list = new OccluderList();
  list.rect(40, 40, 60, 50, 24, OCCLUDER_CLASS.decor);
  list.rect(80, 20, 84, 70, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  const f = new OccluderField(0, 0, 128, 96);
  f.draw(list);
  f.flood(jumpFloodSteps(SDF.firstStepPx));

  it('am Fuß eines Occluders am dunkelsten, ab dem Radius frei', () => {
    const foot = sdfOcclusion(f, [50.5, 50.5], 0);
    expect(foot).toBeCloseTo(1 - SDF_AO.strength * (1 - 0), 1);
    expect(foot).toBeLessThan(0.7);
    expect(sdfOcclusion(f, [50.5, 50.5 + SDF_AO.radiusPx + 1], 0)).toBe(1);
    // Monotone with the distance.
    let last = 0;
    for (let d = 0; d <= SDF_AO.radiusPx; d++) {
      const v = sdfOcclusion(f, [50.5, 50.5 + d], 0);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
    // Beside a wall too.
    expect(sdfOcclusion(f, [86.5, 40.5], 0)).toBeLessThan(0.8);
  });

  it('eine Kontaktverdeckung: hoch über dem Boden und über der Oberkante des Occluders keine', () => {
    expect(sdfOcclusion(f, [50.5, 51.5], SDF_AO.reachHeightPx + 1)).toBe(1);
    expect(sdfOcclusion(f, [50.5, 51.5], 30)).toBe(1);
    expect(sdfOcclusion(f, [50.5, 51.5], 6)).toBeGreaterThan(sdfOcclusion(f, [50.5, 51.5], 0));
    const glsl = (SHADERS['shadow.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('return 1.0 - DH_AO_STRENGTH * near * (1.0 - smoothstep(0.0, DH_AO_REACH_HEIGHT, above));');
  });
});

describe('Lichtbänder und Glanz (M5-06)', () => {
  it('die Bandzahl kommt aus den Einstellungen, auf 6–10 begrenzt; Bänder und Dither einzeln schaltbar', () => {
    const s = defaultSettings();
    const range = SETTING_RANGES['graphics.lightBands'];
    expect([range.min, range.max]).toEqual([6, 10]);
    for (const [asked, got] of [
      [3, 6],
      [6, 6],
      [8, 8],
      [10, 10],
      [14, 10],
    ] as const) {
      expect(lightSettingsFrom({ graphics: { ...s.graphics, lightBands: asked }, accessibility: s.accessibility }).bands).toBe(got);
    }
    const off = lightSettingsFrom({ graphics: { ...s.graphics, lightBanding: false, dither: false }, accessibility: s.accessibility });
    expect([off.banding, off.dither]).toEqual([false, false]);
  });

  it('Glanzlichter: Metall glänzt am stärksten, dann Eis, dann Nässe; Matt nie', () => {
    expect(GLOSS.metal).toBeGreaterThan(GLOSS.ice);
    expect(GLOSS.ice).toBeGreaterThan(GLOSS.wet);
    expect(GLOSS.matte).toBe(0);
    const glsl = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('if (gloss <= 0.0) return 0.0;');
    const point = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(point).toContain('lightSpecular(n, l, texelFetch(uSurface, p, 0).g) * vis.x');
  });
});
