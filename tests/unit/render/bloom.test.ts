/**
 * M5-13: bloom – threshold with a soft knee that never reaches colours at full daylight (TypeScript = GLSL),
 * four levels computed from the internal resolution (1/2 … 1/16), and on a fake GL context one bright pass,
 * three steps down, three up and the composite from a copy of the HDR target (no blending: identical with
 * float targets and the RGBA8 fallback); the setting `graphics.bloom` switches it.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { BLOOM, bloomDefines, bloomLevelSize, bloomShare } from '../../../src/render/passes/bloomPass';
import { atmospherePostSettingsFrom } from '../../../src/render/post/settings';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

function renderer(floatTargets = true) {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  return { fake, r };
}

describe('Bloom-Schwelle', () => {
  it('nothing at or below full daylight (palette colours stay exact), everything above the threshold', () => {
    expect(BLOOM.threshold - BLOOM.knee).toBeGreaterThanOrEqual(1);
    for (let i = 0; i <= 100; i++) expect(bloomShare(i / 100)).toBe(0);
    expect(bloomShare(BLOOM.threshold + BLOOM.knee)).toBeCloseTo(BLOOM.knee / (BLOOM.threshold + BLOOM.knee), 12);
    expect(bloomShare(3)).toBeCloseTo((3 - BLOOM.threshold) / 3, 12);
    let prev = 0;
    for (let p = 1; p < 4; p += 0.05) {
      expect(bloomShare(p)).toBeGreaterThanOrEqual(prev);
      prev = bloomShare(p);
    }
  });

  it('bloom_bright.frag bloomShare equals the TypeScript mirror', () => {
    const glsl = glslScalar('bloom_bright.frag', 'bloomShare', bloomDefines());
    for (let i = 0; i <= 80; i++) expect(glsl(i / 20)).toBeCloseTo(bloomShare(i / 20), 6);
  });

  it('four levels at 1/2, 1/4, 1/8, 1/16 of the internal target (never of the screen)', () => {
    expect(BLOOM.levels).toBe(4);
    const w = 482;
    const h = 272;
    expect([0, 1, 2, 3].map((l) => bloomLevelSize(w, h, l))).toEqual([
      [241, 136],
      [121, 68],
      [61, 34],
      [31, 17],
    ]);
    const { r } = renderer();
    r.render(new RenderScene(), 1920, 1080, 'sharp');
    expect(r.atmosphere.bloom.levelSizes).toEqual([
      [241, 136],
      [121, 68],
      [61, 34],
      [31, 17],
    ]);
  });
});

describe('Bloom-Pass (Fake-GL)', () => {
  it('bright, 3 down, 3 up, composite from one HDR copy – without any blending', () => {
    for (const floatTargets of [true, false]) {
      const { fake, r } = renderer(floatTargets);
      const frame = (): { draws: number; blits: number; blends: number } => {
        const scene = new RenderScene();
        scene.beginFrame(0);
        fake.calls.length = 0;
        r.render(scene, 960, 540, 'sharp');
        return { draws: fake.count('drawArrays'), blits: fake.count('blitFramebuffer'), blends: fake.count('blendFunc') + fake.count('blendFuncSeparate') };
      };
      r.passes.setEnabled('bloom', false);
      const without = frame();
      r.passes.setEnabled('bloom', true);
      const withBloom = frame();
      expect(withBloom.draws - without.draws).toBe(1 + 3 + 3 + 1);
      expect(withBloom.blits - without.blits).toBe(1);
      expect(withBloom.blends).toBe(without.blends);
      expect(r.atmosphere.bloom.texture?.format).toBe(floatTargets ? 'RGBA16F' : 'RGBA8');
    }
  });

  it('follows graphics.bloom', () => {
    const s = defaultSettings();
    expect(s.graphics.bloom).toBe(true);
    const { fake, r } = renderer();
    const blits = (): number => {
      fake.calls.length = 0;
      r.render(new RenderScene(), 960, 540, 'sharp');
      return fake.count('blitFramebuffer');
    };
    const on = blits();
    r.atmosphere.configure(atmospherePostSettingsFrom({ graphics: { ...s.graphics, bloom: false }, accessibility: s.accessibility }));
    expect(r.passes.get('bloom')?.enabled).toBe(false);
    expect(on - blits()).toBe(1);
  });
});
