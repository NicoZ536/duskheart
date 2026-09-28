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
import { OCCLUDER_CLASS, SDF, SDF_AO, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { lightSettingsFrom } from '../../../src/render/light/settings';
import { SkyState } from '../../../src/render/light/sky';
import { daylightParts, lightDirection, splitDaylight, type Rgb3 } from '../../../src/render/light/skyMath';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { SHADERS } from '../../../src/render/shaderLib';

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
    expect(src).toContain('float roof = uHasFields == 1 && !top && sdfRoofed(uMask, ground) ? DH_ROOF_SKY : 1.0;');
    expect(src).toContain('vec3 day = uSkyLight * ao * roof;');
    expect(src).toContain('float shade = max(0.0, 1.0 + uDirRelief * (dot(gbufferNormal(g1), uDirDir) - uDirDir.z));');
    expect(src).toContain('day += uDirLight * shade * sun * cloudShade(ground);');
    // Only the point light is banded (the daylight stays smooth), glints too; emission tops the light up.
    expect(src).toContain('dynamic = lightBands(dynamic, uBands, threshold);');
    expect(src).toContain('float threshold = uDither == 1 ? bandThreshold(bayer4(floor(screen))) : 0.5;');
    expect(src).toContain('oColor = encodeHdr(max(lit, albedo * emission) + glint);');
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
