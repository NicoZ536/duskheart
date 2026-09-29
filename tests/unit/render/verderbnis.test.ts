/**
 * M5-22: corruption – the palette shift maps every palette colour exactly onto the colour the row
 * `verderbnis` gives its index (5 bits per channel tell all 64 apart), everything else onto a darker violet
 * shift; the corrupted area grows with the region's strength (none at 0, all at 1, about half at 0.5 over
 * the real noise tile; TypeScript = GLSL); veins are thin lines of a few pixels over a small share of the
 * ground, wider and more with the strength, weak corruption shows them only deep in its patches; the pass
 * draws only with corruption, from a copy of the HDR target, and rebuilds its lookup when the atlas changes;
 * the grade of corrupted land pulls violet.
 * - Review M4: veins crack only the terrain's open ground – the bit G2.A `terrain` that world/terrain.frag alone
 *   writes (no figure, item, flat decor or standing sprite: sprites never set it) – and the patches lie at each
 *   pixel's ground point from the occluder mask (a tree on a plateau shows the plateau's patch, not one 16 px further
 *   south); the pass binds the mask when the occluder pass ran.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { parseHexColor } from '../../../src/render/palette/lut';
import { CORRUPTION_GRADING } from '../../../src/render/post/atmosphereTable';
import {
  buildCorruptionLut,
  corruptGeneric,
  CORRUPTION_LUT_SIZE,
  CORRUPTION_ROW,
  corruptionCovers,
  corruptionGroundPoint,
  corruptionKey,
  corruptionSpread,
  corruptionThreshold,
  CORRUPTION_PATCH_PX,
  veinAt,
  veinDistance,
  VEIN_FIELD,
  veinField,
  VEINS,
  veinsMayCrack,
  veinsReach,
  veinSwell,
} from '../../../src/render/post/corruption';
import { GBUFFER_MASK, gbufferDefines } from '../../../src/render/gbuffer';
import { OccluderField } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS } from '../../../src/render/light/params';
import { WAND_PX_JE_STUFE } from '../../../src/world/autotile';
import { corruptionDefines, MIN_CORRUPTION } from '../../../src/render/post/corruptionPass';
import { createGrading, gradeColor } from '../../../src/render/post/grading';
import { buildNoiseTexels, sampleNoise } from '../../../src/render/post/noise';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

function verderbnisRow(): readonly number[] {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const row = manifestFromGenerated(mod).paletteRows.find((r) => r.name === CORRUPTION_ROW);
  if (row === undefined) throw new Error('Palettenzeile verderbnis fehlt');
  return Array.from(row.map);
}

describe('Verderbnis: Paletten-Shift', () => {
  it('every palette colour has its own cell and maps exactly onto its colour in the row `verderbnis`', () => {
    const row = verderbnisRow();
    const lut = buildCorruptionLut(PALETTE_HEX, row);
    expect(lut).toHaveLength(CORRUPTION_LUT_SIZE ** 3 * 4);
    PALETTE_HEX.forEach((hex, i) => {
      const [r, g, b] = parseHexColor(hex);
      const o = corruptionKey(r, g, b) * 4;
      const target = parseHexColor(PALETTE_HEX[(row[i] as number) - 1] as string);
      expect([lut[o], lut[o + 1], lut[o + 2], lut[o + 3]], hex).toEqual([...target, 255]);
    });
    // The row keeps the ramps' order: grass stays darker than light sand after the shift, and nothing turns bright.
    const lum = (hex: string): number => {
      const [r, g, b] = parseHexColor(hex);
      const o = corruptionKey(r, g, b) * 4;
      return 0.299 * (lut[o] as number) + 0.587 * (lut[o + 1] as number) + 0.114 * (lut[o + 2] as number);
    };
    expect(lum('#2f6b3a')).toBeLessThan(lum('#dcc27f'));
  });

  it('cells without a palette colour take the generic violet shift; without the row every cell does', () => {
    const lut = buildCorruptionLut(PALETTE_HEX, null);
    const key = corruptionKey(250, 10, 250);
    expect(lut[key * 4 + 3]).toBe(0);
    const g: [number, number, number] = [0, 0, 0];
    for (let v = 0; v <= 10; v++) {
      corruptGeneric(v / 10, v / 10, v / 10, g);
      expect(g[2]).toBeGreaterThanOrEqual(g[1]);
      expect(g.every((c) => c >= 0 && c <= 1)).toBe(true);
    }
    // Brighter in, brighter out (shading stays readable).
    const a = corruptGeneric(0.2, 0.3, 0.2, [0, 0, 0]);
    const b = corruptGeneric(0.6, 0.7, 0.6, [0, 0, 0]);
    expect(a[0] + a[1] + a[2]).toBeLessThan(b[0] + b[1] + b[2]);
  });

  it('refuses a palette whose colours share a cell', () => {
    expect(() => buildCorruptionLut(['#101010', '#111111'], null)).toThrow(/teilen eine Zelle/);
  });
});

describe('Verderbnis: Fläche nach Stärke', () => {
  it('none at 0, everything at 1, grows with the strength, about half at 0.5 over the real noise tile', () => {
    const texels = buildNoiseTexels();
    const share = (strength: number): number => {
      let n = 0;
      let covered = 0;
      for (let i = 0; i < texels.length; i += 4 * 7) {
        const bayer = ((i / 4) % 16) / 16 + 1 / 32;
        if (corruptionCovers((texels[i] as number) / 255, strength, bayer)) covered++;
        n++;
      }
      return covered / n;
    };
    expect(share(0)).toBe(0);
    expect(share(1)).toBe(1);
    const half = share(0.5);
    expect(half).toBeGreaterThan(0.35);
    expect(half).toBeLessThan(0.65);
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const v = share(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('atmosphere_corruption.frag corruptionThreshold, corruptionSpread and veinDistance equal the TypeScript mirrors', () => {
    const glsl = glslScalar('atmosphere_corruption.frag', 'corruptionThreshold', corruptionDefines());
    for (let i = 0; i <= 20; i++) expect(glsl(i / 20)).toBeCloseTo(corruptionThreshold(i / 20), 6);
    const spread = glslScalar('atmosphere_corruption.frag', 'corruptionSpread', corruptionDefines());
    for (let i = 0; i <= 20; i++) expect(spread(i / 20)).toBeCloseTo(corruptionSpread(i / 20), 6);
    const vein = glslScalar('atmosphere_corruption.frag', 'veinDistance', corruptionDefines());
    for (let i = 0; i <= 20; i++) for (const g of [0, 0.001, 0.01, 0.05]) expect(vein(i / 20, g)).toBeCloseTo(veinDistance(i / 20, g), 6);
    const swell = glslScalar('atmosphere_corruption.frag', 'veinSwell', corruptionDefines());
    for (let i = 0; i <= 20; i++) expect(swell(i / 20)).toBeCloseTo(veinSwell(i / 20), 6);
    expect(veinSwell(0)).toBe(VEINS.swell[0]);
    expect(veinSwell(1)).toBe(VEINS.swell[1]);
  });

  it('veins: thin lines over a small share of the ground, wider and more with the strength, only deep in weak patches', () => {
    const texels = buildNoiseTexels();
    // Share of the ground in cracks and cores at `strength` over 352 × 352 px of world (every second pixel), as the shader
    // draws them (`veinAt`: the vein field of M5-55; the patch field the red channel at the patch tile).
    const shares = (strength: number): { crack: number; core: number } => {
      let crack = 0;
      let core = 0;
      let n = 0;
      for (let y = 0; y < 2 * VEINS.tilePx; y += 2) {
        for (let x = 0; x < 2 * VEINS.tilePx; x += 2) {
          n++;
          if (!veinsReach(corruptionSpread(sampleNoise(texels, x / CORRUPTION_PATCH_PX, y / CORRUPTION_PATCH_PX, 0)), strength)) continue;
          const v = veinAt(texels, x, y, strength);
          if (v >= 1) crack++;
          if (v === 2) core++;
        }
      }
      return { crack: crack / n, core: core / n };
    };
    const full = shares(1);
    const half = shares(0.5);
    expect(full.crack).toBeGreaterThan(0.03);
    expect(full.crack).toBeLessThan(0.2);
    expect(full.core).toBeLessThan(full.crack);
    expect(half.crack).toBeGreaterThan(0);
    expect(half.crack).toBeLessThan(full.crack * 0.6);
    expect(shares(0).crack).toBe(0);
  });

  it('M5-55: the vein pattern does not repeat – self-similarity at the tile shift under 10 % (one tile alone: 100 %)', () => {
    const texels = buildNoiseTexels();
    const W = 1100;
    const H = 700;
    // The glowing cores of full corruption (the pixels a picture shows as veins) over 1100 × 700 px of ground.
    const core = new Uint8Array(W * H);
    // The same with the vein tile alone (before M5-55: the field was its channel A).
    const single = new Uint8Array(W * H);
    const s = VEINS.stepPx;
    const t = VEINS.tilePx;
    const a = (x: number, y: number): number => sampleNoise(texels, x / t, y / t, 3);
    let count = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (veinAt(texels, x, y, 1) === 2) {
          core[y * W + x] = 1;
          count++;
        }
        const d = veinDistance(a(x, y), Math.hypot(a(x + s, y) - a(x - s, y), a(x, y + s) - a(x, y - s)) / (2 * s)) / veinSwell(sampleNoise(texels, x / t, y / t, 2));
        if (d < VEINS.core[1]) single[y * W + x] = 1;
      }
    }
    /** Share of vein pixels that lie on a vein again `dx`, `dy` px further. */
    const similarity = (mask: Uint8Array, dx: number, dy: number): number => {
      let on = 0;
      let again = 0;
      for (let y = 0; y + dy < H; y++) {
        for (let x = 0; x + dx < W; x++) {
          if (mask[y * W + x] !== 1) continue;
          on++;
          if (mask[(y + dy) * W + x + dx] === 1) again++;
        }
      }
      return again / on;
    };
    const coverage = count / (W * H);
    expect(coverage).toBeGreaterThan(0.03);
    expect(coverage).toBeLessThan(0.1);
    // One tile alone repeated exactly: every vein pixel lay on a vein again a tile further.
    expect(similarity(single, t, 0)).toBe(1);
    // Every shift within sight that brings one of the two lookups back (the vein tile and its multiples across the view,
    // the second tile): under 10 %, near the share of vein pixels itself (what an unrelated pattern gives).
    const shifts: readonly (readonly [number, number])[] = [
      [t, 0],
      [0, t],
      [2 * t, 0],
      [0, 2 * t],
      [3 * t, 0],
      [VEIN_FIELD.tilePx, 0],
      [0, VEIN_FIELD.tilePx],
      [2 * VEIN_FIELD.tilePx, 0],
    ];
    for (const [dx, dy] of shifts) {
      const v = similarity(core, dx, dy);
      expect(v, `${dx},${dy}`).toBeLessThan(0.1);
      expect(v, `${dx},${dy}`).toBeLessThan(2 * coverage);
    }
  });

  it('M5-55: the shader reads the vein field as its TypeScript mirror (two lookups, the second turned and shifted)', () => {
    const d = corruptionDefines();
    expect([d.DH_VEIN_TILE_PX, d.DH_VEIN_TILE2_PX, d.DH_VEIN_WEIGHT, d.DH_VEIN_OFFSET_X, d.DH_VEIN_OFFSET_Y]).toEqual([`${VEINS.tilePx}.0`, `${VEIN_FIELD.tilePx}.0`, String(VEIN_FIELD.weight), `${VEIN_FIELD.offsetPx[0]}.0`, `${VEIN_FIELD.offsetPx[1]}.0`]);
    expect(Number(d.DH_VEIN_COS)).toBeCloseTo(Math.cos((VEIN_FIELD.angleDeg * Math.PI) / 180), 12);
    expect(Number(d.DH_VEIN_SIN)).toBeCloseTo(Math.sin((VEIN_FIELD.angleDeg * Math.PI) / 180), 12);
    // The second tile is no whole multiple of the vein tile (nor near one within four tiles).
    for (let k = 1; k <= 4; k++) expect(Math.abs((k * VEINS.tilePx) / VEIN_FIELD.tilePx - Math.round((k * VEINS.tilePx) / VEIN_FIELD.tilePx))).toBeGreaterThan(0.1);
    const frag = (SHADERS['atmosphere_corruption.frag'] ?? '').replace(/\s+/g, ' ');
    expect(frag).toContain('vec2 q = vec2(DH_VEIN_COS * g.x - DH_VEIN_SIN * g.y, DH_VEIN_SIN * g.x + DH_VEIN_COS * g.y) + vec2(DH_VEIN_OFFSET_X, DH_VEIN_OFFSET_Y); return noiseAt(uNoise, q, DH_VEIN_TILE2_PX).a;');
    expect(frag).toContain('return mix(noiseAt(uNoise, g, DH_VEIN_TILE_PX).a, veinSecond(g), DH_VEIN_WEIGHT);');
    expect(frag).toContain('float n = mix(first, veinSecond(g), DH_VEIN_WEIGHT);');
    expect(frag).toContain('float dx = veinField(g + vec2(DH_VEIN_STEP, 0.0)) - veinField(g - vec2(DH_VEIN_STEP, 0.0));');
    expect(frag).toContain('float dy = veinField(g + vec2(0.0, DH_VEIN_STEP)) - veinField(g - vec2(0.0, DH_VEIN_STEP));');
    expect(frag).toContain('vec4 v = noiseAt(uNoise, ground, DH_VEIN_TILE_PX);');
    expect(frag).toContain('float d = veinDistanceAt(ground, v.a) / veinSwell(v.b);');
    // The mirror mixes the same way: at weight 0 it would be the vein tile's channel alone.
    const texels = buildNoiseTexels();
    for (const [x, y] of [[0, 0], [37, 911], [-420, 63], [1234, -77]] as const) {
      const first = sampleNoise(texels, x / VEINS.tilePx, y / VEINS.tilePx, 3);
      const c = Math.cos((VEIN_FIELD.angleDeg * Math.PI) / 180);
      const sn = Math.sin((VEIN_FIELD.angleDeg * Math.PI) / 180);
      const second = sampleNoise(texels, (c * x - sn * y + VEIN_FIELD.offsetPx[0]) / VEIN_FIELD.tilePx, (sn * x + c * y + VEIN_FIELD.offsetPx[1]) / VEIN_FIELD.tilePx, 3);
      expect(veinField(texels, x, y)).toBeCloseTo(first * (1 - VEIN_FIELD.weight) + second * VEIN_FIELD.weight, 12);
    }
  });

  it('the grade of corrupted land drains and cools the colours', () => {
    const grass = parseHexColor('#4b8c3c').map((v) => v / 255) as [number, number, number];
    const [r, g, b] = gradeColor(...grass, createGrading(CORRUPTION_GRADING), [0, 0, 0]);
    expect(g - Math.min(r, b)).toBeLessThan(grass[1] - Math.min(grass[0], grass[2]));
    expect(b / g).toBeGreaterThan(grass[2] / grass[1]);
  });
});

describe('Verderbnis-Pass (Fake-GL)', () => {
  function renderer() {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    return { fake, r };
  }

  it('draws only with corruption, from one HDR copy, and rebuilds its lookup when the atlas changes', () => {
    const { fake, r } = renderer();
    const pass = r.atmosphere.corruption;
    const scene = new RenderScene();
    const frame = (strength: number): void => {
      scene.beginFrame(0.5);
      scene.corruption.strength = strength;
      fake.calls.length = 0;
      r.render(scene, 960, 540, 'sharp');
    };
    frame(0);
    expect(pass.drew).toBe(false);
    frame(MIN_CORRUPTION / 2);
    expect(pass.drew).toBe(false);
    frame(1);
    expect(pass.drew).toBe(true);
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
    const manifest = manifestFromGenerated(mod);
    const pixels = new Uint8Array(manifest.width * manifest.height * 4);
    const atlas: AtlasData = { manifest, albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
    scene.atlas = atlas;
    frame(1);
    expect(fake.count('texSubImage3D')).toBe(1);
    frame(1);
    expect(fake.count('texSubImage3D')).toBe(0);
  });
});

describe('Verderbnis: Adern nur im Gelände, Flecken am Bodenpunkt (Prüfung M4)', () => {
  it('the terrain bit is its own bit of G2.A; only the terrain shader writes it, on its open ground', () => {
    const bits = Object.values(GBUFFER_MASK);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) expect(b & (b - 1)).toBe(0);
    expect(GBUFFER_MASK.terrain).toBe(16);
    expect(gbufferDefines().DH_MASK_TERRAIN).toBe('16u');
    const terrain = (SHADERS['world/terrain.frag'] ?? '').replace(/\s+/g, ' ');
    // Open ground: ground, rims (their soil and plants), ramps, stairs – never water, cliff faces, rock tops or waterfalls.
    expect(terrain).toContain('bool open = !water && (kind == KIND_GROUND || kind == KIND_RIM || kind == KIND_RAMP || kind == KIND_STAIRS);');
    expect(terrain).toContain('if (open && (kind != KIND_RIM || soilIndex(painted))) mask |= DH_MASK_TERRAIN;');
    expect(terrain.match(/DH_MASK_TERRAIN/g)).toHaveLength(1);
    // No sprite carries it: figures, items, flat decor and everything standing write their own mask without the bit.
    for (const [name, src] of Object.entries(SHADERS)) if (name !== 'world/terrain.frag' && name !== 'atmosphere_corruption.frag') expect(src, name).not.toContain('DH_MASK_TERRAIN');
  });

  it('veins crack flat terrain only – not a figure at a level height, not a ramp, not flat decor', () => {
    expect(veinsMayCrack(true, 0, 0)).toBe(true);
    // A torso pixel 16 px up, flat-shaded feet, an item on the ground: sprites, no terrain bit (the old guess took them).
    expect(veinsMayCrack(false, 0, 0)).toBe(false);
    // Ramps and stairs slope.
    expect(veinsMayCrack(true, 0, 0.5)).toBe(false);
    expect(veinsMayCrack(true, Math.sqrt(VEINS.flat) * 0.9, 0)).toBe(true);
    const frag = (SHADERS['atmosphere_corruption.frag'] ?? '').replace(/\s+/g, ' ');
    expect(frag).toContain('bool terrain = gbufferHasMask(g2, DH_MASK_TERRAIN);');
    expect(frag).toContain('if (terrain && dot(nxy, nxy) < DH_VEIN_FLAT && spread > threshold + DH_VEIN_DEPTH * (1.0 - strength)) {');
    // The level-grid guess is gone.
    expect(frag).not.toMatch(/DH_VEIN_LEVEL|DH_MAT_CANOPY|DH_MAT_WIND/);
  });

  it('patches lie at the ground point: a tree on a plateau shows the plateau’s patch, terrain pixels their own spot', () => {
    // A plateau one level up (x 32…96, y 16…64) beside level 0.
    const list = new OccluderList();
    list.rect(32, 16, 96, 64, WAND_PX_JE_STUFE, OCCLUDER_CLASS.terrain, false, WAND_PX_JE_STUFE);
    const field = new OccluderField(0, 0, 128, 96);
    field.draw(list);
    // The plateau's ground at (60.5, 40.5) is drawn there (raised levels are not shifted up).
    expect(corruptionGroundPoint(60.5, 40.5, WAND_PX_JE_STUFE, true, field)).toEqual([60.5, 40.5]);
    // A crown pixel 30 px above that plateau, drawn 30 px further north: its ground is the plateau spot – 16 px nearer than
    // the old world + (0, h) put it.
    // (The mask holds the ground height in 8 bits: within a tenth of a pixel.)
    const [gx, gy] = corruptionGroundPoint(60.5, 10.5, WAND_PX_JE_STUFE + 30, false, field);
    expect(gx).toBe(60.5);
    expect(gy).toBeCloseTo(40.5, 0);
    expect(corruptionGroundPoint(60.5, 10.5, WAND_PX_JE_STUFE + 30, false, null)).toEqual([60.5, 10.5 + WAND_PX_JE_STUFE + 30]);
    // On level 0 both agree.
    expect(corruptionGroundPoint(10.5, 50.5, 20, false, field)).toEqual([10.5, 70.5]);
    const frag = (SHADERS['atmosphere_corruption.frag'] ?? '').replace(/\s+/g, ' ');
    // M5-44: beyond the flood frame the occluder ring knows the ground (the crowns at the bottom of the view).
    expect(frag).toContain('#include "sdf_ring.glsl"');
    expect(frag).toContain('vec2 ground = terrain ? world : uHasFields == 1 ? groundPointAt(uMask, world, h) : world + vec2(0.0, h);');
    expect(frag).not.toContain('sdfGroundPoint');
  });

  it('the pass reads the ground heights of the occluder mask when the occluder pass ran, level 0 without it', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const pass = r.atmosphere.corruption;
    const scene = new RenderScene();
    const frame = (lit = false): void => {
      scene.beginFrame(0.5);
      scene.corruption.strength = 1;
      if (lit) {
        const l = scene.light.reset();
        l.radius = 80;
        scene.lights.push(l);
      }
      r.render(scene, 960, 540, 'sharp');
    };
    frame();
    expect([pass.drew, pass.groundFromMask, pass.groundFromRing]).toEqual([true, true, false]);
    // M5-44: with the ring (drawn while the scene has lights or a directed light) the ground beyond the mask's frame too.
    frame(true);
    expect([pass.drew, pass.groundFromMask, pass.groundFromRing]).toEqual([true, true, true]);
    r.passes.setEnabled('occluder', false);
    frame(true);
    expect([pass.drew, pass.groundFromMask, pass.groundFromRing]).toEqual([true, false, false]);
  });
});
