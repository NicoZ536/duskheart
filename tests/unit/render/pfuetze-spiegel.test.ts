/**
 * M5-20 „Pfützen in Senken, die Lichter spiegeln“: the terrain program marks puddle pixels in the G-buffer (G2.A bit
 * `puddle` = 8, docs/RENDER.md §4) – dark, flat, very glossy; the pass `pfuetzen` at slot 520 (after the composition,
 * which does not read the bit) adds what a level water surface shows: the sky and each light mirrored at its footprint
 * (a light at height h appears h px below it in the 3/4 view), as a streak whose length grows with that height – only
 * on puddle pixels, through `encodeHdr` (RGBA8 fallback), and only with the water quality "voll" (§6.3).
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { GBUFFER_MASK } from '../../../src/render/gbuffer';
import { PASS_ORDER } from '../../../src/render/passes/registry';
import { mirrorExtent } from '../../../src/render/surface/puddlePass';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { surfaceSettingsFrom } from '../../../src/render/surface/settings';
import { defaultSettings, QUALITY_PRESETS } from '../../../src/engine/settings';

const M = SURFACE_PARAMS.puddleMirror;

describe('Pfützen spiegeln Lichter', () => {
  it('Vertrag: Maskenbit 8 der Welt-Oberfläche, Platz 520 nach der Komposition, vor dem Wasser', () => {
    expect(GBUFFER_MASK.puddle).toBe(8);
    expect(GBUFFER_MASK.snow).toBe(4);
    expect(PASS_ORDER.surfacePuddles).toBe(520);
    expect(PASS_ORDER.surfacePuddles).toBeGreaterThan(PASS_ORDER.composite);
    expect(PASS_ORDER.surfacePuddles).toBeLessThan(PASS_ORDER.water);
  });

  it('das Spiegelbild wird mit der Lichthöhe länger, nie kürzer als das Minimum, gleich breit', () => {
    const e = { halfWidth: 0, halfLength: 0 };
    expect(mirrorExtent(0, e).halfLength).toBe(M.minLengthPx / 2);
    expect(mirrorExtent(-5, e).halfLength).toBe(M.minLengthPx / 2);
    const high = mirrorExtent(20, e).halfLength;
    expect(high).toBe((20 * M.lengthPerHeight) / 2);
    expect(mirrorExtent(40, e).halfLength).toBeGreaterThan(high);
    expect(mirrorExtent(40, e).halfWidth).toBe(M.halfWidthPx);
  });

  it('nur auf Pfützenpixeln, über encodeHdr, in drei Helligkeitsstufen', () => {
    const mirror = SHADERS['world/puddle_mirror.frag'] ?? '';
    const sky = SHADERS['world/puddle_sky.frag'] ?? '';
    for (const src of [mirror, sky]) {
      expect(src).toContain('if (!gbufferHasMask(texelFetch(uSurface, ivec2(gl_FragCoord.xy), 0), DH_MASK_PUDDLE)) discard;');
      expect(src).toContain('encodeHdr(');
    }
    expect(mirror).toContain('level = floor(level * 3.0 + 0.5) / 3.0;');
    const terrain = SHADERS['world/terrain.frag'] ?? '';
    expect(terrain).toContain('mask |= DH_MASK_PUDDLE;');
  });

  it('spiegelt nur mit Wasserqualität „voll“ (Niedrig: vereinfacht, Mittel: ohne Spiegelung)', () => {
    for (const [level, preset] of Object.entries(QUALITY_PRESETS)) {
      const s = defaultSettings();
      s.graphics = { ...s.graphics, ...preset };
      expect(surfaceSettingsFrom(s).puddleMirror, level).toBe(preset.water === 'full');
    }
  });
});
