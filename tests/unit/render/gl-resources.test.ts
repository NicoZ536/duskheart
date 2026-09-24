/**
 * M1-09/M1-10: GL resource layer – float render-target detection with RGBA8 encoding fallback
 * (also forced by `?forceRgba8=1`), framebuffer completeness errors, the resource registry that
 * rebuilds everything after a context loss, the pass registry and the renderer on a fake context.
 */
import { describe, expect, it } from 'vitest';
import { parseRenderFlags, resolveTargetCaps } from '../../../src/render/gl/context';
import { encodingDefines, HDR_FALLBACK_RANGE, resolveTargetFormat } from '../../../src/render/gl/formats';
import { framebufferStatusName, RenderTarget } from '../../../src/render/gl/framebuffer';
import { GpuResourceRegistry, RESTORE_ORDER, type GpuResource, type GpuResourceKind } from '../../../src/render/gl/resources';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { PASS_ORDER, type RenderPass } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { createSceneSource, RENDER_SCENE_IDS } from '../../../src/render/scenes';
import { STRESS_SPRITES } from '../../../src/render/scenes/sprites5000';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';

describe('Float-Render-Targets und RGBA8-Fallback', () => {
  it('keeps float formats with EXT_color_buffer_float', () => {
    expect(resolveTargetFormat('RGBA16F', true)).toEqual({ requested: 'RGBA16F', actual: 'RGBA16F', encoding: 'none' });
    expect(resolveTargetFormat('R16F', true).actual).toBe('R16F');
  });

  it('falls back to RGBA8 (linear / range) and RG8 (16-bit fixed point) without', () => {
    expect(resolveTargetFormat('RGBA16F', false)).toEqual({ requested: 'RGBA16F', actual: 'RGBA8', encoding: 'hdr-linear' });
    expect(resolveTargetFormat('R16F', false)).toEqual({ requested: 'R16F', actual: 'RG8', encoding: 'scalar-rg16' });
    expect(resolveTargetFormat('RGBA8', false).encoding).toBe('none');
    expect(encodingDefines(false)).toEqual({ DH_FLOAT_TARGETS: '0', DH_HDR_FALLBACK_RANGE: HDR_FALLBACK_RANGE.toFixed(1) });
  });

  it('?forceRgba8=1 switches float targets off even when the device has them', () => {
    const caps = { floatRenderTargets: true, maxDrawBuffers: 8 };
    expect(parseRenderFlags('?debug=1&forceRgba8=1')).toEqual({ forceRgba8: true });
    expect(parseRenderFlags('?debug=1')).toEqual({ forceRgba8: false });
    expect(resolveTargetCaps(caps, { forceRgba8: true })).toEqual({ floatTargets: false, forcedRgba8: true, maxDrawBuffers: 8 });
    expect(resolveTargetCaps(caps, { forceRgba8: false }).floatTargets).toBe(true);
    expect(resolveTargetCaps({ floatRenderTargets: false, maxDrawBuffers: 8 }, { forceRgba8: false })).toEqual({ floatTargets: false, forcedRgba8: false, maxDrawBuffers: 8 });
  });

  it('render targets request their real format and name incomplete framebuffers', () => {
    const { gl } = createFakeGl();
    const t = new RenderTarget(gl, { label: 'hdr', width: 4, height: 4, attachments: [{ name: 'c', format: 'RGBA16F' }], floatTargets: false });
    expect(t.texture(0).format).toBe('RGBA8');
    expect(t.encoding(0)).toBe('hdr-linear');
    const statusGl = { FRAMEBUFFER_COMPLETE: 1, FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 2, FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 3, FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 4, FRAMEBUFFER_UNSUPPORTED: 5, FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: 6 };
    expect(framebufferStatusName(statusGl, 5)).toBe('FRAMEBUFFER_UNSUPPORTED');
    expect(framebufferStatusName(statusGl, 255)).toBe('0xff');
  });
});

describe('Ressourcen-Registry', () => {
  function fakeResource(kind: GpuResourceKind, log: string[]): GpuResource {
    return {
      kind,
      label: kind,
      create: () => void log.push(`create:${kind}`),
      release: () => void log.push(`release:${kind}`),
      forget: () => void log.push(`forget:${kind}`),
      bytes: () => 1,
    };
  }

  it('rebuilds every resource after a context loss in dependency order', () => {
    const log: string[] = [];
    const r = new GpuResourceRegistry();
    for (const k of ['vertexArray', 'framebuffer', 'program', 'buffer', 'texture'] as const) r.add(fakeResource(k, log));
    log.length = 0;
    r.loseAll();
    expect(log.every((l) => l.startsWith('forget:'))).toBe(true);
    log.length = 0;
    r.restoreAll();
    expect(log).toEqual(RESTORE_ORDER.map((k) => `create:${k}`));
    expect(r.restoreCount).toBe(1);
    expect(r.totalBytes()).toBe(5);
  });
});

describe('Renderer (Fake-Kontext)', () => {
  function renderer(floatTargets = true) {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    return { fake, r };
  }

  it('renders every debug scene; the stress scene has 5 000 animated sprites in ≤ 4 sprite draw calls', () => {
    const { r } = renderer();
    for (const id of RENDER_SCENE_IDS) {
      const scene = new RenderScene();
      const src = createSceneSource(id, { gameAtlas: () => sceneAtlas(), t: (key) => key });
      src.activate?.(r);
      scene.beginFrame(1);
      src.fill(scene, 1);
      r.render(scene, 1920, 1080, 'sharp');
      if (id === 'sprites-5000') {
        expect(scene.sprites.count).toBe(STRESS_SPRITES);
        expect(r.stats.spriteDrawCalls).toBeLessThanOrEqual(4);
      }
      src.deactivate?.(r);
    }
    expect(r.stats.frames).toBe(RENDER_SCENE_IDS.length);
  });

  it('context loss: frames are skipped, the restore recreates every GPU resource', () => {
    const { fake, r } = renderer();
    const scene = new RenderScene();
    const src = createSceneSource('gbuffer', { gameAtlas: () => null, t: (key) => key });
    src.fill(scene, 0);
    r.render(scene, 1920, 1080, 'sharp');
    const created = fake.calls.filter((c) => c.name.startsWith('create')).length;
    fake.lose();
    r.contextLost();
    const drawsBefore = fake.count('drawArrays') + fake.count('drawArraysInstanced');
    r.render(scene, 1920, 1080, 'sharp');
    expect(fake.count('drawArrays') + fake.count('drawArraysInstanced')).toBe(drawsBefore);
    fake.restore();
    fake.calls.length = 0;
    r.contextRestored();
    const recreated = fake.calls.filter((c) => c.name.startsWith('create')).length;
    // Everything except per-shader objects (created and deleted during linking) exists again.
    expect(recreated).toBeGreaterThanOrEqual(r.resources.count);
    expect(created).toBeGreaterThan(0);
    r.render(scene, 1920, 1080, 'sharp');
    expect(r.stats.contextRestores).toBe(1);
    expect(r.stats.frames).toBe(2);
  });

  it('the G-buffer has three RGBA8 attachments; HDR is RGBA16F or its RGBA8 encoding', () => {
    expect(renderer(true).r.targets.gbuffer.attachments.map((a) => a.format)).toEqual(['RGBA8', 'RGBA8', 'RGBA8']);
    expect(renderer(true).r.targets.hdr.texture(0).format).toBe('RGBA16F');
    expect(renderer(false).r.targets.hdr.texture(0).format).toBe('RGBA8');
  });

  it('passes register in order and can be switched off; the debugger knows the G-buffer views', () => {
    const { r } = renderer();
    const ran: string[] = [];
    const pass = (name: string): RenderPass => ({ name, enabled: true, resize: () => undefined, execute: () => void ran.push(name) });
    r.passes.add(pass('licht'), PASS_ORDER.lighting);
    r.passes.add(pass('nachbearbeitung'), PASS_ORDER.post);
    expect(r.passes.list().map((p) => p.name)).toEqual(['gbuffer', 'lighting', 'licht', 'unlit', 'composite', 'post', 'nachbearbeitung', 'resolve', 'outline', 'debug-overlay', 'welt-ui']);
    r.passes.setEnabled('nachbearbeitung', false);
    const scene = new RenderScene();
    scene.atlas = sceneAtlas();
    r.render(scene, 960, 540, 'sharp');
    expect(ran).toEqual(['licht']);
    expect(() => r.passes.add(pass('licht'), 1)).toThrow(/schon registriert/);
    for (const v of ['albedo', 'normal', 'height', 'emissive', 'wet', 'material', 'gloss', 'water', 'outline', 'hdr', 'light', 'specular', 'off']) expect(r.debugViews.names()).toContain(v);
    r.setDebugView('normal');
    r.render(scene, 960, 540, 'sharp');
    expect(r.debugView).toBe('normal');
    expect(() => r.setDebugView('sdf')).toThrow(/unbekannter Puffer/);
  });
});
