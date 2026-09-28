/**
 * The debug flag `?passesOff=…` (ADR „M5-Integration: Frame-Pfad und E2E“, tests/e2e/logik.ts): the E2E specs of game
 * logic hold the passes of M5 that add picture only off from the first frame. `parseRenderFlags` reads the list,
 * `PassRegistry.holdOff` keeps the passes out of the frame – a graphics setting that switches fog or bloom on does not
 * bring them back, the render debugger's `renderPass … on` does – and names unknown passes.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { DebugViews } from '../../../src/render/debugView';
import { parseRenderFlags } from '../../../src/render/gl/context';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { PASS_ORDER, PassRegistry, type PassSetup, type RenderPass } from '../../../src/render/passes/registry';
import { atmospherePostSettingsFrom } from '../../../src/render/post/settings';
import { Renderer } from '../../../src/render/renderer';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';

function stub(name: string): RenderPass {
  return { name, enabled: true, resize: () => undefined, execute: () => undefined };
}

function registry(): PassRegistry {
  const fake = createFakeGl();
  const resources = new GpuResourceRegistry();
  const shaders = new ShaderLibrary(fake.gl, resources, new ShaderSourceStore(SHADERS), {}, { report: () => undefined });
  const setup: PassSetup = { gl: fake.gl, resources, shaders, caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, debugViews: new DebugViews() };
  return new PassRegistry(setup);
}

const names = (passes: readonly RenderPass[]): string[] => passes.map((p) => p.name);

describe('passesOff (debug flag of the logic E2E specs)', () => {
  it('parseRenderFlags reads the comma list and leaves it out when absent or empty', () => {
    expect(parseRenderFlags('?debug=1&passesOff=occluder,water')).toEqual({ forceRgba8: false, passesOff: ['occluder', 'water'] });
    expect(parseRenderFlags('?debug=1&forceRgba8=1&passesOff=bloom,,')).toEqual({ forceRgba8: true, passesOff: ['bloom'] });
    expect(parseRenderFlags('?debug=1&passesOff=')).toEqual({ forceRgba8: false });
    expect(parseRenderFlags('?debug=1')).toEqual({ forceRgba8: false });
  });

  it('a held pass leaves the frame order, stays off against its own flag and comes back by setEnabled only', () => {
    const passes = registry();
    passes.add(stub('a'), 10);
    passes.add(stub('b'), 20);
    passes.add(stub('c'), 30);
    expect(passes.holdOff(['b', 'gibtsnicht', 'c'])).toEqual(['gibtsnicht']);
    expect(names(passes.ordered())).toEqual(['a']);
    expect(passes.get('b')?.enabled).toBe(false);
    expect(passes.list()).toEqual([
      { name: 'a', order: 10, enabled: true },
      { name: 'b', order: 20, enabled: false },
      { name: 'c', order: 30, enabled: false },
    ]);
    // A setting switching the pass on (as `configure` does for fog and bloom) does not let it run.
    const b = passes.get('b');
    if (b === undefined) throw new Error('b fehlt');
    b.enabled = true;
    expect(names(passes.ordered())).toEqual(['a']);
    expect(passes.list().find((i) => i.name === 'b')?.enabled).toBe(false);
    // Switching it off again keeps it held; the debugger switching it on releases it into its old place.
    passes.setEnabled('b', false);
    expect(names(passes.ordered())).toEqual(['a']);
    passes.setEnabled('b', true);
    expect(names(passes.ordered())).toEqual(['a', 'b']);
    expect(passes.list().find((i) => i.name === 'b')?.enabled).toBe(true);
    // A pass added later sorts in among the held ones without releasing them.
    passes.add(stub('d'), 25);
    expect(names(passes.ordered())).toEqual(['a', 'b', 'd']);
  });

  it('on the renderer: the image-only passes of M5 stay out of the frame although the settings switch fog and bloom on', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const held = ['occluder', 'shadow', 'water', 'atmosphere', 'bloom'];
    expect(r.passes.holdOff(held)).toEqual([]);
    const settings = defaultSettings();
    r.atmosphere.configure(atmospherePostSettingsFrom({ ...settings, graphics: { ...settings.graphics, fog: true, bloom: true } }));
    expect(r.passes.get('atmosphere')?.enabled).toBe(true);
    const running = names(r.passes.ordered());
    for (const name of held) expect(running).not.toContain(name);
    // Composition and post still stand in for the unlit fallback and the plain resolve: the frame stays complete.
    expect(running).toContain('composite');
    expect(running).toContain('post');
    expect(r.passes.list().filter((i) => held.includes(i.name)).every((i) => !i.enabled)).toBe(true);
    expect(PASS_ORDER.bloom).toBeGreaterThan(PASS_ORDER.atmosphere);
  });
});
