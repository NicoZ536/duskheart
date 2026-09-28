/**
 * M5-13 (and the heat shimmer of M5-10): the distortion field – the shock wave profile (TypeScript = GLSL),
 * a wave's course over its life, the pooled source list, the debug pin of a repeating wave, and the pass on
 * a fake GL context: nothing drawn without sources, one fullscreen draw for view-wide heat or water, one
 * instanced call for the sources in view, additive blending; the post pass reads through the field only in
 * the frames it was drawn.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { DISTORTION_CAUSTIC, distortionDefines, DistortionPass, distortionShade } from '../../../src/render/passes/distortionPass';
import { DISTORTION_KIND, DISTORTION_RANGE_PX, DistortionList, shockwaveAt, shockwaveProfile } from '../../../src/render/post/distortion';
import { PostOverrides } from '../../../src/render/post/overrides';
import { atmospherePostSettingsFrom } from '../../../src/render/post/settings';
import { PostState } from '../../../src/render/post/state';
import { GradingState } from '../../../src/render/post/grading';
import { CorruptionState } from '../../../src/render/post/corruption';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { defaultSettings } from '../../../src/engine/settings';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

function renderer() {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  return { fake, r };
}

function scene(): RenderScene {
  const s = new RenderScene();
  s.beginFrame(0.5);
  s.camera.set(0, 0);
  return s;
}

describe('Schockwellen-Profil', () => {
  it('is zero at the ring edges, in its middle and outside; antisymmetric; never beyond 1', () => {
    for (const u of [-1.5, -1, 0, 1, 1.5]) expect(shockwaveProfile(u)).toBeCloseTo(0, 12);
    for (let i = 1; i < 20; i++) {
      const u = i / 20;
      expect(shockwaveProfile(-u)).toBeCloseTo(-shockwaveProfile(u), 12);
      expect(Math.abs(shockwaveProfile(u))).toBeLessThan(1);
    }
    // The inner half reads from further out, the outer half from further in.
    expect(shockwaveProfile(-0.4)).toBeGreaterThan(0);
    expect(shockwaveProfile(0.4)).toBeLessThan(0);
  });

  it('distortion.glsl shockwaveProfile equals the TypeScript profile', () => {
    const glsl = glslScalar('distortion.glsl', 'shockwaveProfile', distortionDefines());
    for (let i = -30; i <= 30; i++) expect(glsl(i / 20)).toBeCloseTo(shockwaveProfile(i / 20), 6);
  });

  it('bending shades the picture: a ring darkens its magnified middle and brightens its compressed rims (TypeScript = GLSL)', () => {
    expect(distortionShade(0)).toBe(1);
    // The gentle bends of heat and water stay as bright as they are.
    expect(distortionShade(DISTORTION_CAUSTIC.dead * 0.9)).toBe(1);
    expect(distortionShade(-DISTORTION_CAUSTIC.dead * 0.9)).toBe(1);
    expect(distortionShade(0.3)).toBeGreaterThan(1);
    expect(distortionShade(-0.3)).toBeLessThan(1);
    expect(distortionShade(-10)).toBe(DISTORTION_CAUSTIC.min);
    expect(distortionShade(10)).toBe(DISTORTION_CAUSTIC.max);
    const glsl = glslScalar('distortion.glsl', 'distortionShade', distortionDefines());
    for (let i = -20; i <= 20; i++) expect(glsl(i / 10)).toBeCloseTo(distortionShade(i / 10), 6);
    // Across a ring of width 24 with a 4.5 px peak: the radial offset falls through its middle (dark) and rises at its rims (bright).
    const width = 24;
    const peak = 4.5;
    const slope = (u: number): number => ((shockwaveProfile(u + 0.01) - shockwaveProfile(u - 0.01)) / 0.02) * (peak / width);
    expect(distortionShade(slope(0))).toBeLessThan(0.7);
    expect(distortionShade(slope(0.8))).toBeGreaterThan(1);
    expect(distortionShade(slope(-0.8))).toBeGreaterThan(1);
  });

  it('a wave grows at its speed, fades quadratically and ends at its life', () => {
    const w = { radius: 0, strength: 0 };
    expect(shockwaveAt(0.5, 100, 1, 8, w)).toEqual({ radius: 50, strength: 2 });
    expect(shockwaveAt(0, 100, 1, 8, w).strength).toBe(8);
    expect(shockwaveAt(1, 100, 1, 8, w)).toEqual({ radius: 0, strength: 0 });
    expect(shockwaveAt(-0.1, 100, 1, 8, w).strength).toBe(0);
  });
});

describe('Verzerrungsquellen', () => {
  it('pools shock waves and heat areas, grows by doubling, refuses empty sources and caps the offset', () => {
    const list = new DistortionList(2);
    expect(list.shockwave(10, 20, 30, 8, 4)).toBe(0);
    expect(list.heat(1, 2, 12, 6, 1.5)).toBe(1);
    expect(list.shockwave(0, 0, 10, 4, 99)).toBe(2);
    expect(list.count).toBe(3);
    expect(list.kind[0]).toBe(DISTORTION_KIND.shockwave);
    expect(list.kind[1]).toBe(DISTORTION_KIND.heat);
    expect(list.strength[2]).toBe(DISTORTION_RANGE_PX);
    expect(list.shockwave(0, 0, 10, 4, 0)).toBe(-1);
    expect(list.heat(0, 0, 0, 4, 1)).toBe(-1);
    list.clear();
    expect(list.count).toBe(0);
  });

  it('the debug pin of a shock wave pushes one ring per frame, repeating every period', () => {
    const o = new PostOverrides();
    const post = new PostState();
    o.shockwave = { x: 100, y: 50, start: 1, period: 2, speed: 100, life: 1, width: 10, strength: 6 };
    o.applyTo(post, new GradingState(), new CorruptionState(), 1.5);
    expect(post.distortion.count).toBe(1);
    expect(post.distortion.a[0]).toBeCloseTo(50, 6);
    post.beginFrame();
    o.applyTo(post, new GradingState(), new CorruptionState(), 3.5);
    expect(post.distortion.a[0]).toBeCloseTo(50, 6);
    post.beginFrame();
    o.applyTo(post, new GradingState(), new CorruptionState(), 2.5);
    expect(post.distortion.count).toBe(0);
  });
});

describe('Verzerrungs-Pass (Fake-GL)', () => {
  it('draws nothing without sources; the post pass then reads straight', () => {
    const { fake, r } = renderer();
    r.render(scene(), 960, 540, 'sharp');
    const d = r.atmosphere.distortion;
    expect(d.activeInFrame(r.stats.frames - 1)).toBe(false);
    expect(d.sourcesDrawn).toBe(0);
    expect(fake.count('drawArraysInstanced')).toBe(0);
  });

  it('view-wide heat: one fullscreen draw; sources: one instanced call for those in view, additive', () => {
    const { fake, r } = renderer();
    const s = scene();
    s.env.heat = 0.7;
    s.post.distortion.shockwave(0, 0, 40, 12, 5);
    s.post.distortion.heat(30, 10, 20, 12, 2);
    s.post.distortion.shockwave(50_000, 0, 40, 12, 5);
    fake.calls.length = 0;
    r.render(s, 960, 540, 'sharp');
    const d = r.atmosphere.distortion;
    expect(d.activeInFrame(r.stats.frames - 1)).toBe(true);
    expect(d.sourcesDrawn).toBe(2);
    expect(fake.calls.filter((c) => c.name === 'drawArraysInstanced').map((c) => c.args[3])).toEqual([2]);
    expect(fake.count('blendFunc')).toBeGreaterThanOrEqual(1);
  });

  it('follows the settings: shock waves scale with the screen shake, sway calms with reduced motion', () => {
    const s = defaultSettings();
    const pass = new DistortionPass(null as never);
    pass.configure(atmospherePostSettingsFrom({ graphics: s.graphics, accessibility: { ...s.accessibility, screenshake: 0.25, reducedMotion: true } }));
    expect(pass.shockwaveScale).toBe(0.25);
    expect(pass.motionScale).toBeLessThan(1);
  });
});
