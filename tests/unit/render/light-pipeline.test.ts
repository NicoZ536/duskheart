/**
 * M1-18/M1-19 on a fake GL context: light pass, composition and post register in §6.1 order, stand
 * in for the unlit fallback and the plain resolve, can each be switched off (the image stays
 * complete), register their render-debugger buffers, follow the graphics settings and draw the lights
 * as one instanced call with additive blending.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { DebugViews } from '../../../src/render/debugView';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { findLightPipeline, installLightPipeline } from '../../../src/render/light/pipeline';
import { DEFAULT_LIGHT_SETTINGS, lightSettingsFrom, REDUCED_FLICKER_SCALE } from '../../../src/render/light/settings';
import { PASS_ORDER, PassRegistry, type PassSetup, type RenderPass } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl, type FakeGl } from './fakeGl';

function stub(name: string): RenderPass {
  return { name, enabled: true, resize: () => undefined, execute: () => undefined };
}

function registry(fake: FakeGl = createFakeGl(), floatTargets = true): { passes: PassRegistry; setup: PassSetup } {
  const resources = new GpuResourceRegistry();
  const shaders = new ShaderLibrary(fake.gl, resources, new ShaderSourceStore(SHADERS), {}, { report: () => undefined });
  const setup: PassSetup = { gl: fake.gl, resources, shaders, caps: { floatTargets, forcedRgba8: false, maxDrawBuffers: 8 }, debugViews: new DebugViews() };
  return { passes: new PassRegistry(setup), setup };
}

/** The renderer with its light pipeline (installed by the renderer itself once it is wired in). */
function litRenderer(floatTargets = true) {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  const pipeline = findLightPipeline(r.passes) ?? installLightPipeline(r.passes);
  return { fake, r, pipeline };
}

function sceneWithLights(n: number): RenderScene {
  const scene = new RenderScene();
  scene.beginFrame(0.5);
  for (let i = 0; i < n; i++) {
    const l = scene.light.reset();
    l.x = i * 20 - 100;
    l.y = 0;
    l.radius = 60;
    l.height = 12;
    scene.lights.push(l);
  }
  return scene;
}

describe('light pipeline', () => {
  it('registers light, composition and post in §6.1 order and replaces unlit and resolve', () => {
    const { passes } = registry();
    const unlit = stub('unlit');
    const resolve = stub('resolve');
    passes.add(unlit, PASS_ORDER.composite);
    passes.add(resolve, PASS_ORDER.resolve);
    const p = installLightPipeline(passes);
    expect(passes.list().map((e) => [e.name, e.order, e.enabled])).toEqual([
      ['lighting', PASS_ORDER.lighting, true],
      ['unlit', PASS_ORDER.composite, false],
      ['composite', PASS_ORDER.composite, true],
      ['post', PASS_ORDER.post, true],
      ['resolve', PASS_ORDER.resolve, false],
    ]);
    expect(findLightPipeline(passes)).toBe(p);
    passes.setEnabled('composite', false);
    expect(unlit.enabled).toBe(true);
    passes.setEnabled('post', false);
    expect(resolve.enabled).toBe(true);
    passes.setEnabled('composite', true);
    passes.setEnabled('post', true);
    expect([unlit.enabled, resolve.enabled]).toEqual([false, false]);
    passes.remove('composite');
    expect(unlit.enabled).toBe(true);
  });

  it('registers the light buffers with the render debugger and unregisters them on removal', () => {
    const { passes, setup } = registry();
    installLightPipeline(passes);
    expect(setup.debugViews.names()).toEqual(expect.arrayContaining(['light', 'specular']));
    passes.remove('lighting');
    expect(setup.debugViews.get('light')).toBeUndefined();
    expect(findLightPipeline(passes)).toBeNull();
  });

  it('light target: two RGBA16F attachments, RGBA8 encoding without float targets', () => {
    for (const floatTargets of [true, false]) {
      const { passes } = registry(createFakeGl(), floatTargets);
      const p = installLightPipeline(passes);
      expect([p.lighting.texture(0)?.format, p.lighting.texture(1)?.format]).toEqual(floatTargets ? ['RGBA16F', 'RGBA16F'] : ['RGBA8', 'RGBA8']);
    }
  });

  it('follows the graphics and accessibility settings', () => {
    const s = defaultSettings();
    expect(DEFAULT_LIGHT_SETTINGS).toEqual({ banding: true, bands: 8, dither: true, maxLights: 128, flickerScale: 1 });
    const custom = lightSettingsFrom({ graphics: { ...s.graphics, lightBanding: false, lightBands: 6, dither: false, maxLights: 32 }, accessibility: { ...s.accessibility, flashReduction: true } });
    expect(custom).toEqual({ banding: false, bands: 6, dither: false, maxLights: 32, flickerScale: REDUCED_FLICKER_SCALE });
    const { passes } = registry();
    const p = installLightPipeline(passes);
    p.configure(custom);
    expect([p.composite.banding, p.composite.bands, p.composite.dither, p.lighting.maxLights, p.lighting.flickerScale]).toEqual([false, 6, false, 32, REDUCED_FLICKER_SCALE]);
    expect(p.settings).toBe(custom);
  });
});

describe('lit frame (fake GL)', () => {
  it('draws all lights in one additive instanced call; composition and post each one fullscreen pass', () => {
    const { fake, r, pipeline } = litRenderer();
    r.render(sceneWithLights(5), 960, 540, 'sharp');
    const instanced = fake.calls.filter((c) => c.name === 'drawArraysInstanced');
    expect(instanced.map((c) => c.args[3])).toEqual([5]);
    const blend = fake.calls.filter((c) => c.name === 'blendFunc');
    expect(blend).toHaveLength(1);
    expect(pipeline.lighting.drawnLights).toBe(5);
    expect(pipeline.lighting.ranInFrame(0)).toBe(true);
    expect(r.passes.get('unlit')?.enabled).toBe(false);
    expect(r.passes.get('resolve')?.enabled).toBe(false);
  });

  it('without lights nothing is instanced, and the light target is still cleared', () => {
    const { fake, r } = litRenderer();
    r.render(sceneWithLights(0), 960, 540, 'sharp');
    expect(fake.count('drawArraysInstanced')).toBe(0);
    expect(fake.count('clearBufferfv')).toBeGreaterThanOrEqual(2 + 3);
  });

  it('switching the light pass off leaves the composition unlit for that frame', () => {
    const { fake, r, pipeline } = litRenderer();
    r.render(sceneWithLights(2), 960, 540, 'sharp');
    expect(pipeline.lighting.ranInFrame(r.stats.frames - 1)).toBe(true);
    r.passes.setEnabled('lighting', false);
    fake.calls.length = 0;
    r.render(sceneWithLights(2), 960, 540, 'sharp');
    expect(fake.count('drawArraysInstanced')).toBe(0);
    expect(pipeline.lighting.ranInFrame(r.stats.frames - 1)).toBe(false);
    // Composition and post still draw: the frame is complete, only unlit.
    expect(fake.count('drawArrays')).toBeGreaterThanOrEqual(3);
  });

  it('survives a context loss: the light target and buffers are rebuilt', () => {
    const { fake, r, pipeline } = litRenderer(false);
    r.render(sceneWithLights(3), 960, 540, 'sharp');
    fake.lose();
    r.contextLost();
    fake.restore();
    r.contextRestored();
    fake.calls.length = 0;
    r.render(sceneWithLights(3), 960, 540, 'sharp');
    expect(fake.calls.filter((c) => c.name === 'drawArraysInstanced').map((c) => c.args[3])).toEqual([3]);
    expect(pipeline.lighting.texture(0)?.handle).not.toBeNull();
  });
});
