/**
 * M5-22: corruption – the palette shift maps every palette colour exactly onto the colour the row
 * `verderbnis` gives its index (5 bits per channel tell all 64 apart), everything else onto a darker violet
 * shift; the corrupted area grows with the region's strength (none at 0, all at 1, about half at 0.5 over
 * the real noise tile; TypeScript = GLSL); veins are thin lines of a few pixels over a small share of the
 * ground, wider and more with the strength, weak corruption shows them only deep in its patches; the pass
 * draws only with corruption, from a copy of the HDR target, and rebuilds its lookup when the atlas changes;
 * the grade of corrupted land pulls violet.
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
  corruptionKey,
  corruptionSpread,
  corruptionThreshold,
  veinDistance,
  VEINS,
  veinsReach,
  veinSwell,
  veinWidths,
} from '../../../src/render/post/corruption';
import { corruptionDefines, MIN_CORRUPTION } from '../../../src/render/post/corruptionPass';
import { createGrading, gradeColor } from '../../../src/render/post/grading';
import { buildNoiseTexels, NOISE_SIZE } from '../../../src/render/post/noise';
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
    const px = VEINS.tilePx / NOISE_SIZE;
    const at = (x: number, y: number, c: number): number => (texels[((((y % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE) * NOISE_SIZE + (((x % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE)) * 4 + c] as number) / 255;
    const widths = { crack: 0, core: 0 };
    // Share of texels in cracks and cores at `strength`; the patch field is the red channel at the same place.
    const shares = (strength: number): { crack: number; core: number } => {
      veinWidths(strength, widths);
      let crack = 0;
      let core = 0;
      let n = 0;
      for (let y = 0; y < NOISE_SIZE; y++) {
        for (let x = 0; x < NOISE_SIZE; x++) {
          n++;
          if (!veinsReach(corruptionSpread(at(x, y, 0)), strength)) continue;
          const gx = (at(x + 1, y, 3) - at(x - 1, y, 3)) / (2 * px);
          const gy = (at(x, y + 1, 3) - at(x, y - 1, 3)) / (2 * px);
          const d = veinDistance(at(x, y, 3), Math.hypot(gx, gy)) / veinSwell(at(x, y, 2));
          if (d < widths.crack) crack++;
          if (d < widths.core) core++;
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
