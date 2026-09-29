/**
 * M5-09: the impulse API of the interactive waves (`RenderScene.water`) and how the water pass feeds the impulses
 * into the wave field (fake GL): every kind (figures, raindrops, arrows, fish, splashes) kicks with its strength and
 * radius from `IMPULSES`, continuous sources scale by the frame time, the list is bounded and refuses nonsense; the
 * pass keeps the frame's impulses until the next fixed step of the field and hands them to the step shader in texels
 * of the field (row 0 south), follows the camera by whole texels, starts calm after a context loss, draws nothing in a
 * frame without water and steps no waves when the quality level has none.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { SCENE_BORDER, emptySnap, snapCamera } from '../../../src/render/camera';
import { DebugViews } from '../../../src/render/debugView';
import { GBUFFER_ATTACHMENTS, gbufferDefines } from '../../../src/render/gbuffer';
import { encodingDefines } from '../../../src/render/gl/formats';
import { RenderTarget } from '../../../src/render/gl/framebuffer';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { identityRow, PaletteLut } from '../../../src/render/palette/lut';
import { emptyRenderStats, PASS_ORDER, PassRegistry, type FrameTargets, type PassSetup, type RenderContext } from '../../../src/render/passes/registry';
import { WATER_DEBUG_VIEW } from '../../../src/render/passes/waterPass';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { findWater, installWater } from '../../../src/render/water/install';
import { IMPULSES, MAX_IMPULSES, WAVES, type WaterImpulseKind } from '../../../src/render/water/params';
import { waterSettingsFrom } from '../../../src/render/water/settings';
import { WaterState } from '../../../src/render/water/state';
import { defaultSettings, QUALITY_PRESETS } from '../../../src/engine/settings';
import type { SpriteBatcher } from '../../../src/render/batch/spriteBatcher';
import { LAYER } from '../../../src/render/batch/spriteLayout';
import { createFakeGl, type FakeGl } from './fakeGl';

describe('impulse API (scene.water)', () => {
  it('every kind kicks with its strength and radius; a continuous source scales by the frame time', () => {
    const w = new WaterState();
    const kinds = Object.keys(IMPULSES) as WaterImpulseKind[];
    expect(kinds).toEqual(expect.arrayContaining(['figure', 'rain', 'arrow', 'fish', 'splash']));
    kinds.forEach((k, i) => expect(w.impulse(k, 10 * i, -5 * i)).toBe(true));
    expect(w.impulses.count).toBe(kinds.length);
    kinds.forEach((k, i) => {
      expect(w.impulses.x[i]).toBe(10 * i);
      expect(w.impulses.y[i]).toBe(-5 * i);
      expect(w.impulses.strength[i]).toBeCloseTo(IMPULSES[k].strength, 6);
      // Stored as float32 (the uniform array's precision).
      expect(w.impulses.radius[i]).toBe(Math.fround(IMPULSES[k].radiusPx));
    });
    const v = new WaterState();
    v.impulse('figure', 3, 4, 1 / 30);
    expect(v.impulses.strength[0]).toBeCloseTo(IMPULSES.figure.strength / 30, 6);
    // Drops, arrows, fish and splashes press the water down; a figure pushes it up.
    expect(IMPULSES.rain.strength).toBeLessThan(0);
    expect(IMPULSES.arrow.strength).toBeLessThan(0);
    expect(IMPULSES.fish.strength).toBeLessThan(0);
    expect(IMPULSES.splash.strength).toBeLessThan(IMPULSES.arrow.strength);
    expect(IMPULSES.figure.strength).toBeGreaterThan(0);
  });

  it('refuses non-finite positions, zero strength and radius; counts what a full frame drops', () => {
    const w = new WaterState();
    expect(w.impulse('rain', Number.NaN, 0)).toBe(false);
    expect(w.impulseAt(0, Number.POSITIVE_INFINITY, 1, 2)).toBe(false);
    expect(w.impulseAt(0, 0, 0, 2)).toBe(false);
    expect(w.impulseAt(0, 0, 1, 0)).toBe(false);
    expect(w.impulse('figure', 0, 0, 0)).toBe(false);
    expect(w.impulses.count).toBe(0);
    for (let i = 0; i < MAX_IMPULSES; i++) expect(w.impulse('rain', i, i)).toBe(true);
    expect(w.impulse('arrow', 1, 1)).toBe(false);
    expect(w.impulses.count).toBe(MAX_IMPULSES);
    expect(w.impulses.dropped).toBe(1);
    w.beginFrame();
    expect(w.impulses.count).toBe(0);
    expect(w.impulses.dropped).toBe(0);
    expect(w.impulseAt(5, 6, 0.5, 3)).toBe(true);
    expect([w.impulses.strength[0], w.impulses.radius[0]]).toEqual([0.5, 3]);
  });

  it('is part of every render scene and cleared with the frame', () => {
    const scene = new RenderScene();
    scene.beginFrame(1);
    scene.water.impulse('fish', 1, 2);
    expect(scene.water.impulses.count).toBe(1);
    scene.beginFrame(2);
    expect(scene.water.impulses.count).toBe(0);
    expect(scene.water.tiles.known).toBe(false);
  });
});

/** A GL whose uniform locations remember their names. */
function namedGl(fake: FakeGl): { gl: WebGL2RenderingContext; names: Map<unknown, string> } {
  const names = new Map<unknown, string>();
  const gl = new Proxy(fake.gl as object, {
    get(target, prop) {
      const v = Reflect.get(target, prop) as unknown;
      if (prop === 'getUniformLocation' && typeof v === 'function') {
        return (program: unknown, name: string) => {
          const loc = (v as (p: unknown, n: string) => unknown)(program, name);
          names.set(loc, name);
          return loc;
        };
      }
      return v;
    },
  }) as WebGL2RenderingContext;
  return { gl, names };
}

const VIEW = { w: 480, h: 270 } as const;

function waterRig(floatTargets = true) {
  const fake = createFakeGl();
  const { gl, names } = namedGl(fake);
  const resources = new GpuResourceRegistry();
  const shaders = new ShaderLibrary(gl, resources, new ShaderSourceStore(SHADERS), { ...encodingDefines(floatTargets), ...gbufferDefines() }, { report: () => undefined });
  const setup: PassSetup = { gl, resources, shaders, caps: { floatTargets, forcedRgba8: !floatTargets, maxDrawBuffers: 8 }, debugViews: new DebugViews() };
  const passes = new PassRegistry(setup);
  const water = installWater(passes);
  const width = VIEW.w + 2 * SCENE_BORDER;
  const height = VIEW.h + 2 * SCENE_BORDER;
  passes.resize({ width, height, viewWidth: VIEW.w, viewHeight: VIEW.h });
  const targets: FrameTargets = {
    gbuffer: resources.add(new RenderTarget(gl, { label: 'gbuffer', width, height, attachments: GBUFFER_ATTACHMENTS, floatTargets })),
    hdr: resources.add(new RenderTarget(gl, { label: 'hdr', width, height, attachments: [{ name: 'color', format: 'RGBA16F' }], floatTargets })),
    ldr: resources.add(new RenderTarget(gl, { label: 'ldr', width, height, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets })),
  };
  const palette = new PaletteLut(resources, gl, PALETTE_HEX, [identityRow()]);
  const scene = new RenderScene();
  const frame = { width, height, viewWidth: VIEW.w, viewHeight: VIEW.h, camera: emptySnap(), time: 0, index: 0 };
  const stats = emptyRenderStats();
  /** Sprites of the frame on the water layer (the batcher's count; the rest of the batcher is not read). */
  const layers = { water: 0 };
  const sprites = { layerCount: (layer: number) => (layer === LAYER.water ? layers.water : 0) } as unknown as SpriteBatcher;
  const ctx: RenderContext = {
    gl,
    frame,
    scene,
    targets,
    caps: setup.caps,
    palette,
    atlas: null,
    sprites,
    stats,
    drawFullscreen: () => {
      stats.drawCalls++;
    },
  };
  /** Renders the water pass for a frame at `time` with the camera centred on (`cx`, `cy`). */
  const run = (time: number, cx = 1000, cy = 800): void => {
    frame.time = time;
    snapCamera(frame.camera, cx, cy, Number.NaN, Number.NaN, VIEW.w, VIEW.h);
    for (const p of passes.ordered()) if (p.enabled) p.execute(ctx);
    frame.index++;
  };
  /** Marks the frame's tile grid as holding open water. */
  const withWater = (): void => {
    scene.water.tiles.known = true;
    scene.water.tiles.waterTiles = 40;
  };
  return { fake, names, passes, setup, water, scene, run, withWater, stats, layers };
}

/** Calls of `fn` on the uniform `name`. */
function uniformCalls(fake: FakeGl, names: Map<unknown, string>, fn: string, name: string): unknown[][] {
  return fake.calls.filter((c) => c.name === fn && names.get(c.args[0]) === name).map((c) => [...c.args]);
}

describe('water pass: waves from impulses (fake GL)', () => {
  it('is installed at PASS_ORDER.water with the render-debugger view of the wave field', () => {
    const { passes, setup, water } = waterRig();
    expect(passes.list().map((p) => [p.name, p.order])).toEqual([['water', PASS_ORDER.water]]);
    expect(findWater(passes)).toBe(water);
    expect(setup.debugViews.get(WATER_DEBUG_VIEW)).toBeDefined();
    passes.remove('water');
    expect(setup.debugViews.get(WATER_DEBUG_VIEW)).toBeUndefined();
    expect(findWater(passes)).toBeNull();
  });

  it('keeps the impulses until the next step and hands them over in texels of the field', () => {
    const { fake, names, scene, run, withWater, water } = waterRig();
    scene.beginFrame(1);
    withWater();
    run(1);
    // The first frame starts the field calm (both fields cleared) and steps nothing.
    expect(water.pass.stats.steps).toBe(0);
    const field = water.pass.waveField;
    expect(field.valid).toBe(true);
    // A frame too early for a step: its impulses wait.
    scene.beginFrame(1.01);
    withWater();
    scene.water.impulse('arrow', field.x + 40, field.y + 20);
    run(1 + 0.4 / WAVES.stepHz);
    expect(water.pass.stats.steps).toBe(0);
    fake.calls.length = 0;
    scene.beginFrame(1.02);
    withWater();
    scene.water.impulse('rain', field.x + 10, field.y + field.height * WAVES.texelPx - 6);
    run(1 + 1 / WAVES.stepHz);
    expect(water.pass.stats.steps).toBe(1);
    expect(water.pass.stats.impulses).toBe(2);
    const counts = uniformCalls(fake, names, 'uniform1i', 'uImpulseCount');
    expect(counts.map((c) => c[1])).toEqual([2]);
    const data = uniformCalls(fake, names, 'uniform4fv', 'uImpulses')[0]?.[1] as Float32Array;
    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(MAX_IMPULSES * 4);
    const t = WAVES.texelPx;
    // Arrow: 40 px east and 20 px south of the field's north-west corner; row 0 is the southern row.
    expect(Array.from(data.subarray(0, 4))).toEqual([40 / t, field.height - 20 / t, Math.fround(IMPULSES.arrow.radiusPx / t), expect.closeTo(IMPULSES.arrow.strength, 5)]);
    expect(Array.from(data.subarray(4, 8))).toEqual([10 / t, 6 / t, Math.fround(IMPULSES.rain.radiusPx / t), expect.closeTo(IMPULSES.rain.strength, 5)]);
    // Applied once: the next step has none.
    scene.beginFrame(1.03);
    withWater();
    fake.calls.length = 0;
    run(1 + 2 / WAVES.stepHz);
    expect(water.pass.stats.steps).toBe(1);
    expect(uniformCalls(fake, names, 'uniform1i', 'uImpulseCount').map((c) => c[1])).toEqual([0]);
  });

  it('follows the camera by whole texels and starts over after a jump', () => {
    const { fake, names, scene, run, withWater, water } = waterRig();
    scene.beginFrame(0);
    withWater();
    run(5);
    const before = { ...water.pass.waveField };
    fake.calls.length = 0;
    scene.beginFrame(0);
    withWater();
    run(5 + 1 / WAVES.stepHz, 1000 + 3 * WAVES.texelPx, 800 - 2 * WAVES.texelPx);
    expect(uniformCalls(fake, names, 'uniform2i', 'uShift').map((c) => [c[1], c[2]])).toEqual([[3, 2]]);
    expect(water.pass.waveField.x - before.x).toBe(3 * WAVES.texelPx);
    expect(water.pass.waveField.y - before.y).toBe(-2 * WAVES.texelPx);
    fake.calls.length = 0;
    scene.beginFrame(0);
    withWater();
    run(5 + 2 / WAVES.stepHz, 9000, 800);
    // Farther than the field reaches: both fields cleared, no step.
    expect(fake.count('clearBufferfv')).toBe(2);
    expect(water.pass.stats.steps).toBe(0);
  });

  it('draws the surface from a copy of the lit scene; nothing in a frame without water', () => {
    const { fake, scene, run, withWater, stats, layers } = waterRig();
    scene.beginFrame(0);
    scene.water.tiles.known = true;
    run(0);
    expect(fake.count('blitFramebuffer')).toBe(0);
    expect(stats.drawCalls).toBe(0);
    scene.beginFrame(0);
    withWater();
    run(0);
    expect(fake.count('blitFramebuffer')).toBe(1);
    expect(stats.drawCalls).toBe(1);
    // A scene that knows nothing of its tiles (M1/M2 debug scenes) with a ground that may draw water (the world
    // terrain): the G-buffer decides, the pass runs.
    const terrain = { drawGBuffer: () => undefined };
    scene.beginFrame(0);
    scene.ground.push(terrain);
    run(0);
    expect(fake.count('blitFramebuffer')).toBe(2);
    // Only a ground that never draws water (the M1 tile map) and no sprite on the water layer: nothing can be water,
    // the pass copies nothing and draws nothing.
    const tileMap = { drawGBuffer: () => undefined, drawsWater: false };
    scene.beginFrame(0);
    scene.ground.length = 0;
    scene.ground.push(tileMap);
    const draws = stats.drawCalls;
    run(0);
    expect(fake.count('blitFramebuffer')).toBe(2);
    expect(stats.drawCalls).toBe(draws);
    // A pond on the water layer over that ground: the pass runs again.
    layers.water = 1;
    run(0);
    expect(fake.count('blitFramebuffer')).toBe(3);
  });

  it('starts calm again after a context loss and restore', () => {
    const { fake, setup, scene, run, withWater, water } = waterRig();
    scene.beginFrame(0);
    withWater();
    run(1);
    run(1 + 1 / WAVES.stepHz);
    expect(water.pass.stats.steps).toBe(1);
    setup.resources.loseAll();
    setup.resources.restoreAll();
    fake.calls.length = 0;
    run(1 + 2 / WAVES.stepHz);
    expect(fake.count('clearBufferfv')).toBe(2);
    expect(water.pass.stats.steps).toBe(0);
  });

  it('steps no waves when the quality level has none (§6.3 "Wasser vereinfacht")', () => {
    const { scene, run, withWater, water } = waterRig();
    const s = defaultSettings();
    water.configure(waterSettingsFrom({ graphics: { ...s.graphics, ...QUALITY_PRESETS.low }, accessibility: s.accessibility }));
    scene.beginFrame(0);
    withWater();
    scene.water.impulse('splash', 1000, 800);
    run(1);
    run(2);
    expect(water.pass.stats.steps).toBe(0);
    expect(water.pass.waveField.valid).toBe(false);
  });

  it('works on the RGBA8 fallback: the scene copy has the HDR target’s encoding', () => {
    const { scene, run, withWater, water } = waterRig(false);
    scene.beginFrame(0);
    withWater();
    run(1);
    expect(water.pass.stats.drawn).toBe(true);
  });
});
