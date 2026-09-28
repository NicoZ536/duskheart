/**
 * M5-16: the optional CRT filter of the presentation – off by default (the setting of a fresh profile, the
 * renderer's pass), on with `graphics.crt` or a debug pin, then the presentation's final step instead of
 * the linear upscaling; the screen curve and the scanline profile (TypeScript = GLSL).
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { CRT, crtCurve, crtDefines, crtScanline } from '../../../src/render/post/crtPass';
import { atmospherePostSettingsFrom, DEFAULT_ATMOSPHERE_POST_SETTINGS } from '../../../src/render/post/settings';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

function renderer() {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  return { fake, r };
}

describe('CRT-Filter', () => {
  it('is off by default: fresh settings, the renderer settings, and a rendered frame', () => {
    expect(defaultSettings().graphics.crt).toBe(false);
    expect(DEFAULT_ATMOSPHERE_POST_SETTINGS.crt).toBe(false);
    const { r } = renderer();
    expect(r.atmosphere.crt.setting).toBe(false);
    r.render(new RenderScene(), 1920, 1080, 'sharp');
    r.render(new RenderScene(), 1366, 768, 'sharp');
    expect(r.atmosphere.crt.drawn).toBe(0);
  });

  it('draws the presentation with the setting on – also where the integer scale would skip the linear step – and stops again', () => {
    const s = defaultSettings();
    const { r } = renderer();
    r.atmosphere.configure(atmospherePostSettingsFrom({ graphics: { ...s.graphics, crt: true }, accessibility: s.accessibility }));
    r.render(new RenderScene(), 1920, 1080, 'sharp');
    r.render(new RenderScene(), 1920, 1080, 'pixelPerfect');
    expect(r.atmosphere.crt.drawn).toBe(2);
    r.passes.setEnabled('crt', false);
    r.render(new RenderScene(), 1920, 1080, 'sharp');
    expect(r.atmosphere.crt.drawn).toBe(2);
    r.passes.setEnabled('crt', true);
    r.atmosphere.configure(atmospherePostSettingsFrom(s));
    r.render(new RenderScene(), 1920, 1080, 'sharp');
    expect(r.atmosphere.crt.drawn).toBe(2);
  });

  it('a debug pin arms it for the frame regardless of the setting', () => {
    const { r } = renderer();
    const scene = new RenderScene();
    scene.post.overrides.crt = true;
    r.render(scene, 1920, 1080, 'sharp');
    expect(r.atmosphere.crt.drawn).toBe(1);
    scene.post.overrides.crt = null;
    r.render(scene, 1920, 1080, 'sharp');
    expect(r.atmosphere.crt.drawn).toBe(1);
  });

  it('curves the screen: the centre stays, the corners reach outside (black); scanlines dark at the seams', () => {
    const p: [number, number] = [0, 0];
    expect(crtCurve(0.5, 0.5, p)).toEqual([0.5, 0.5]);
    crtCurve(1, 1, p);
    expect(p[0]).toBeGreaterThan(1);
    expect(p[1]).toBeGreaterThan(1);
    crtCurve(0.25, 0.5, p);
    expect(p[0]).toBeLessThan(0.25);
    expect(crtScanline(0.5)).toBeCloseTo(1, 12);
    expect(crtScanline(0)).toBeCloseTo(1 - CRT.scanline, 12);
    const glsl = glslScalar('crt.frag', 'crtScanline', crtDefines());
    for (let i = 0; i <= 20; i++) expect(glsl(i / 20)).toBeCloseTo(crtScanline(i / 20), 6);
  });
});
