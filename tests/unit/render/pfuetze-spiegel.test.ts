/**
 * M5-20 „Pfützen in Senken, die Lichter spiegeln“: the terrain program marks puddle pixels in the G-buffer (G2.A bit
 * `puddle` = 8, docs/RENDER.md §4) – dark, flat, very glossy; the pass `pfuetzen` at slot 520 (after the composition,
 * which does not read the bit) adds what a level water surface shows: the sky and each light mirrored at its footprint
 * (a light at height h appears h px below it in the 3/4 view), as a streak whose length grows with that height – only
 * on puddle pixels, through `encodeHdr` (RGBA8 fallback), and only with the water quality "voll" (§6.3).
 *
 * M5 review Minor 4: only the lights the light pass drew (culled to the view, capped at `maxLights`, their flicker as
 * drawn) are mirrored, and none whose way south to its image crosses a wall or a cliff – an interior light's image does
 * not appear in a puddle outside its house.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { GBUFFER_MASK } from '../../../src/render/gbuffer';
import { PASS_ORDER } from '../../../src/render/passes/registry';
import { MIRROR_FLOATS, mirrorExtent, packMirrors } from '../../../src/render/surface/puddlePass';
import { blockedSouthward, FrameLights } from '../../../src/render/light/frameLights';
import { LightBatch } from '../../../src/render/light/lightBatch';
import { OccluderList } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { LightDesc, LightList } from '../../../src/render/scene';
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

/** The view of the tests: 480 × 270 from (0, 0). */
const VIEW = { left: 0, top: 0, width: 480, height: 270 };

/** A light list of lights at (x, y), 12 px up, radius 64, orange; `base` its ground [px] (default unknown). */
function lightList(points: ReadonlyArray<readonly [number, number, number?]>): LightList {
  const list = new LightList(2);
  for (const [x, y, base] of points) {
    const l = new LightDesc();
    l.x = x;
    l.y = y;
    l.height = 12;
    l.radius = 64;
    l.r = 1;
    l.g = 0.5;
    l.b = 0.2;
    if (base !== undefined) l.base = base;
    list.push(l);
  }
  return list;
}

/** What the light pass drew of `list` with `maxLights`, as the puddles read it. */
function drawn(list: LightList, maxLights = 256): FrameLights {
  const batch = new LightBatch();
  const f = new FrameLights();
  f.count = batch.pack(list, VIEW, 0, { maxLights, flickerScale: 1 });
  f.data = batch.data;
  f.frame = 0;
  return f;
}

/** Mirror points (x, y) packed for `lights` with `occluders`. */
function mirrors(lights: FrameLights, occluders = new OccluderList()): Array<[number, number]> {
  const out = new Float32Array(Math.max(1, lights.count) * MIRROR_FLOATS);
  const n = packMirrors(lights, occluders, VIEW.left, VIEW.top, VIEW.left + VIEW.width, VIEW.top + VIEW.height, out, { halfWidth: 0, halfLength: 0 });
  return Array.from({ length: n }, (_, i) => [out[i * MIRROR_FLOATS] ?? NaN, out[i * MIRROR_FLOATS + 1] ?? NaN]);
}

describe('Pfützen spiegeln nur gezeichnete, nicht verdeckte Lichter (M5-Review Minor 4)', () => {
  it('nur die Lichter des Lichtpasses: in der Ansicht, höchstens maxLights (die nächsten), mit ihrem Flackern', () => {
    const list = lightList([
      [240, 100],
      [100, 120],
      [2000, 100],
      [400, 200],
    ]);
    // Far off the view: not drawn, not mirrored.
    expect(mirrors(drawn(list))).toEqual([
      [240, 112],
      [100, 132],
      [400, 212],
    ]);
    // Capped at two: the two nearest to the view's centre, as the light pass keeps them.
    expect(mirrors(drawn(list, 2))).toEqual([
      [240, 112],
      [100, 132],
    ]);
    // The colour is the drawn one (colour × intensity × flicker) × the mirror's strength.
    const out = new Float32Array(MIRROR_FLOATS);
    packMirrors(drawn(lightList([[240, 100]])), new OccluderList(), 0, 0, 480, 270, out, { halfWidth: 0, halfLength: 0 });
    [1, 0.5, 0.2].forEach((c, k) => expect((out[4 + k] ?? 0) / M.strength).toBeCloseTo(c, 6));
  });

  it('ein Licht im Haus spiegelt sich nicht in der Pfütze vor seiner Südwand; im Freien schon', () => {
    // A room's south wall (band y 116–122) between a lamp at y 110 and its image at 110 + 12.
    const walls = new OccluderList();
    walls.rect(200, 116, 280, 122, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    const list = lightList([
      [240, 110],
      [100, 110],
    ]);
    expect(mirrors(drawn(list), walls)).toEqual([[100, 122]]);
    expect(blockedSouthward(walls, 240, 110, 130, 0)).toBe(true);
    expect(blockedSouthward(walls, 240, 90, 112, 0)).toBe(false);
    expect(blockedSouthward(walls, 300, 110, 130, 0)).toBe(false);
  });

  it('eine Klippe sperrt ein tieferes Licht, nicht eines auf ihrer Stufe; ohne bekannten Boden zählen nur Wände', () => {
    const cliff = new OccluderList();
    cliff.rect(0, 116, 480, 140, 16, OCCLUDER_CLASS.terrain, true, 16);
    expect(mirrors(drawn(lightList([[240, 110, 0]])), cliff)).toEqual([]);
    expect(mirrors(drawn(lightList([[240, 110, 16]])), cliff)).toEqual([[240, 122]]);
    expect(mirrors(drawn(lightList([[240, 110]])), cliff)).toEqual([[240, 122]]);
  });
});
