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
import { TRAVEL_PERIODS, WATER_DEBUG_VIEW, WATER_FRAME } from '../../../src/render/passes/waterPass';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { findWater, installWater } from '../../../src/render/water/install';
import { AMBIENT_WAVES, CAUSTICS, FLICKER_CLOCK, IMPULSES, MAX_IMPULSES, MOTION_CLOCK, WAVES, type WaterImpulseKind } from '../../../src/render/water/params';
import { REDUCED_FLICKER_SCALE } from '../../../src/render/light/settings';
import { DRIFT_CLOCK_HZ, DRIFT_UNITS, DriftOffset, driftClock } from '../../../src/render/world/drift';
import { crestIndex } from '../../../src/render/water/glitter';
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

describe('water pass: drifting caustics, wave travel and the flicker clock (world/drift.ts, B1/Minor 3 of the M5 review)', () => {
  /** Shortest step from `a` to `b` on a circle of `period`. */
  const step = (a: number, b: number, period: number): number => {
    let d = b - a;
    if (d > period / 2) d -= period;
    if (d < -period / 2) d += period;
    return d;
  };

  it('reduced motion and flash reduction switched on mid-run slow the waves, the caustics and the sparkle – without a jump', () => {
    const { fake, names, scene, run, withWater, water } = waterRig();
    const F = WATER_FRAME;
    // The drifting values come in whole 1/DRIFT_UNITS px (or s): in px (s) here.
    const frame = (): Float32Array => {
      const calls = uniformCalls(fake, names, 'uniform4fv', 'uFrame');
      const d = Float32Array.from(calls[calls.length - 1]?.[1] as Float32Array);
      for (const i of [F.flickerTime, F.motionTime, F.causticA, F.causticA + 1, F.causticB, F.causticB + 1, F.travel, F.travel + 1, F.travel + 2]) d[i] = (d[i] ?? 0) / DRIFT_UNITS;
      return d;
    };
    // The first train's travel wraps after AMBIENT_WAVES.travelWaves of its wavelengths (M5-42).
    const wl = TRAVEL_PERIODS[0];
    expect(wl).toBe(AMBIENT_WAVES.wavelengthsPx[0] * AMBIENT_WAVES.travelWaves);
    const causticPeriod = CAUSTICS.cellPx * CAUSTICS.periodCells;
    const dt = 1 / 60;
    let time = 3600;
    scene.beginFrame(time);
    withWater();
    run(time);
    let last = frame();
    const steps = { travel: [] as number[], caustic: [] as number[], flicker: [] as number[], motion: [] as number[] };
    for (let i = 1; i <= 120; i++) {
      if (i === 61) {
        const s = defaultSettings();
        water.configure(waterSettingsFrom({ graphics: s.graphics, accessibility: { ...s.accessibility, reducedMotion: true, flashReduction: true } }));
      }
      time += dt;
      scene.beginFrame(time);
      withWater();
      run(time);
      const now = frame();
      steps.travel.push(step(last[F.travel] ?? 0, now[F.travel] ?? 0, wl));
      steps.caustic.push(Math.hypot(step(last[F.causticA] ?? 0, now[F.causticA] ?? 0, causticPeriod), step(last[F.causticA + 1] ?? 0, now[F.causticA + 1] ?? 0, causticPeriod)));
      steps.flicker.push((now[F.flickerTime] ?? 0) - (last[F.flickerTime] ?? 0));
      steps.motion.push(step(last[F.motionTime] ?? 0, now[F.motionTime] ?? 0, MOTION_CLOCK.periodSeconds));
      // Every offset stays within half its period of 0 (32-bit exact however long the game runs).
      expect(Math.abs(now[F.travel] ?? wl)).toBeLessThanOrEqual(wl / 2);
      expect(Math.abs(now[F.causticA] ?? causticPeriod)).toBeLessThanOrEqual(causticPeriod / 2);
      last = now;
    }
    /** A frame's step is the speed × the frame, to a drift clock tick and two units of rounding. */
    const near = (got: number | undefined, speed: number): void => {
      expect(Math.abs((got ?? Number.NaN) - speed * dt)).toBeLessThanOrEqual(speed / DRIFT_CLOCK_HZ + 2 / DRIFT_UNITS);
    };
    const wave = AMBIENT_WAVES.speedPxPerSecond;
    const slow = AMBIENT_WAVES.reducedMotion;
    // Before: the waves travel at full speed; after: at the reduced motion's share – no step larger than a full one.
    for (let i = 0; i < 60; i++) near(steps.travel[i], wave);
    for (let i = 60; i < 120; i++) near(steps.travel[i], wave * slow);
    const caustic = CAUSTICS.driftPxPerSecond;
    for (let i = 0; i < 60; i++) near(steps.caustic[i], caustic);
    for (let i = 60; i < 120; i++) near(steps.caustic[i], caustic * slow);
    // The sparkle's clock runs at a quarter with flash reduction.
    for (let i = 0; i < 60; i++) near(steps.flicker[i], 1);
    for (let i = 60; i < 120; i++) near(steps.flicker[i], REDUCED_FLICKER_SCALE);
    // The motion clock (caustic wobble, surf, waterline) runs at the reduced motion's share (M5-47).
    for (let i = 0; i < 60; i++) near(steps.motion[i], 1);
    for (let i = 60; i < 120; i++) near(steps.motion[i], slow);
    // Over the slow half the waves travelled the reduced share of the fast half's way (no jump at the switch).
    const sum = (a: number[], from: number, to: number): number => a.slice(from, to).reduce((x, y) => x + y, 0);
    expect(sum(steps.travel, 60, 120) / sum(steps.travel, 0, 60)).toBeCloseTo(slow, 1);
    // The clocks move in whole 1/DRIFT_UNITS s (a frame's step is 0 or one unit): over a second each shows its rate –
    // the motion clock the reduced motion's share, the flicker clock the flash reduction's (M5-47).
    expect(sum(steps.motion, 0, 60)).toBeCloseTo(1, 1);
    expect(sum(steps.motion, 60, 120) / sum(steps.motion, 0, 60)).toBeCloseTo(slow, 1);
    expect(sum(steps.flicker, 60, 120) / sum(steps.flicker, 0, 60)).toBeCloseTo(REDUCED_FLICKER_SCALE, 1);
  });

  /** The last `uFrame` upload with the drifting values in px (s). */
  const lastFrame = (fake: FakeGl, names: Map<unknown, string>): Float32Array => {
    const F = WATER_FRAME;
    const calls = uniformCalls(fake, names, 'uniform4fv', 'uFrame');
    const d = Float32Array.from(calls[calls.length - 1]?.[1] as Float32Array);
    for (const i of [F.flickerTime, F.motionTime, F.causticA, F.causticA + 1, F.causticB, F.causticB + 1, F.travel, F.travel + 1, F.travel + 2]) d[i] = (d[i] ?? 0) / DRIFT_UNITS;
    return d;
  };
  /**
   * The closed form velocity × time of a drift of `period` px at drift clock `clock` [px]: the velocity `v` [px/s] in
   * whole units per second, the product wrapped to the period and centred on 0 (`DriftOffset`).
   */
  const closed = (v: number, period: number, clock: number): number => {
    const q = (Math.round(v * DRIFT_UNITS) | 0) * clock;
    const p = period * DRIFT_UNITS * DRIFT_CLOCK_HZ;
    const units = Math.floor((((q % p) + p) % p) / DRIFT_CLOCK_HZ);
    const whole = period * DRIFT_UNITS;
    return (units >= whole / 2 ? units - whole : units) / DRIFT_UNITS;
  };

  it('M5-43: Standbild – die Uhr steht, die Welt macht einen Schritt mit neuem Wind: Kaustik-Versatz = v_neu · t; die laufende Uhr bleibt stetig', () => {
    const { fake, names, scene, run, withWater, water } = waterRig();
    const F = WATER_FRAME;
    const periodA = CAUSTICS.cellPx * CAUSTICS.periodCells;
    const periodB = CAUSTICS.cellPx * CAUSTICS.layerScale * CAUSTICS.periodCells;
    const time = 41.3;
    const clock = driftClock(time);
    /** A frame at `t` with the water's wind (`wx`, `wy`) of the world at tick `key`. */
    const frameAt = (t: number, wx: number, wy: number, key: number): Float32Array => {
      scene.beginFrame(t);
      withWater();
      scene.water.windX = wx;
      scene.water.windY = wy;
      scene.water.stepKey = key;
      run(t);
      return lastFrame(fake, names);
    };
    const east = [0.94, 0.33] as const;
    const west = [-0.94, 0.33] as const;
    const first = frameAt(time, east[0], east[1], 10);
    // The first frame takes the closed form of its wind.
    expect(first[F.causticA]).toBe(closed(east[0] * CAUSTICS.driftPxPerSecond, periodA, clock));
    // A scenario forces its weather and steps the world; the clock stays frozen. The wind of the step turns west.
    frameAt(time, west[0], west[1], 11);
    const still = frameAt(time, west[0], west[1], 11);
    const v = CAUSTICS.driftPxPerSecond;
    expect(still[F.causticA]).toBe(closed(west[0] * v, periodA, clock));
    expect(still[F.causticA + 1]).toBe(closed(west[1] * v, periodA, clock));
    expect(still[F.causticB]).toBe(closed(west[0] * v * CAUSTICS.layerDrift, periodB, clock));
    // Not the old wind's offset (the key of the clock alone kept v_old · t, M5 review N3).
    expect(still[F.causticA]).not.toBe(first[F.causticA]);
    // The clock runs again: the world steps every frame and the wind turns back east half way – no jump.
    const dt = 1 / 60;
    let t = time;
    let key = 11;
    let last = still;
    let biggest = 0;
    const wrapped = (d: number): number => (d > periodA / 2 ? d - periodA : d < -periodA / 2 ? d + periodA : d);
    for (let i = 0; i < 120; i++) {
      t += dt;
      key++;
      const wind = i < 60 ? west : east;
      const now = frameAt(t, wind[0], wind[1], key);
      biggest = Math.max(biggest, Math.hypot(wrapped((now[F.causticA] ?? 0) - (last[F.causticA] ?? 0)), wrapped((now[F.causticA + 1] ?? 0) - (last[F.causticA + 1] ?? 0))));
      last = now;
    }
    expect(biggest).toBeGreaterThan(0);
    expect(biggest).toBeLessThanOrEqual(v * (dt + 1 / DRIFT_CLOCK_HZ) + 2 / DRIFT_UNITS);
    // The game pauses (clock and world stand) and its menu switches reduced motion: the settings alone never move the
    // water (B1) – the drifts go on from where they are once the clock runs.
    const s = defaultSettings();
    water.configure(waterSettingsFrom({ graphics: s.graphics, accessibility: { ...s.accessibility, reducedMotion: true } }));
    const menu = frameAt(t, east[0], east[1], key);
    expect([menu[F.causticA], menu[F.travel], menu[F.motionTime]]).toEqual([last[F.causticA], last[F.travel], last[F.motionTime]]);
    // A scenario steps the world under the frozen clock: the picture shows the reduced drift × time of its settings.
    frameAt(t, east[0], east[1], key + 1);
    const stepped = frameAt(t, east[0], east[1], key + 1);
    const at = driftClock(t);
    expect(stepped[F.causticA]).toBe(closed(east[0] * v * AMBIENT_WAVES.reducedMotion, periodA, at));
    expect(stepped[F.travel]).toBe(closed(AMBIENT_WAVES.speedPxPerSecond * AMBIENT_WAVES.reducedMotion, TRAVEL_PERIODS[0], at));
    expect(stepped[F.motionTime]).toBe(closed(AMBIENT_WAVES.reducedMotion, MOTION_CLOCK.periodSeconds, at));
  });

  it('M5-42: der Laufweg eines Wellenzugs bricht erst nach travelWaves Wellenlängen um (≥ 60 s), und das Glitzern zählt die Kämme modulo davon – ein Kamm behält seinen Index über den Umbruch', () => {
    const { fake, names, scene, run, withWater } = waterRig();
    const F = WATER_FRAME;
    const speed = AMBIENT_WAVES.speedPxPerSecond;
    // No train wraps within a minute at full motion (reduced motion wraps later still).
    for (let k = 0; k < 3; k++) {
      expect(TRAVEL_PERIODS[k]).toBe((AMBIENT_WAVES.wavelengthsPx[k] ?? 0) * AMBIENT_WAVES.travelWaves);
      expect((TRAVEL_PERIODS[k] ?? 0) / speed).toBeGreaterThanOrEqual(60);
    }
    // Start one pixel before the first train's travel wraps (its offset runs from +P/2 over to −P/2).
    const period = TRAVEL_PERIODS[0];
    const wl = AMBIENT_WAVES.wavelengthsPx[0];
    const t0 = (period / 2 - 1) / speed;
    const dt = 1 / 60;
    const travels: number[] = [];
    for (let i = 0; i < 20; i++) {
      scene.beginFrame(t0 + i * dt);
      withWater();
      run(t0 + i * dt);
      travels.push(lastFrame(fake, names)[F.travel] ?? 0);
    }
    const wrapAt = travels.findIndex((v, i) => i > 0 && v < (travels[i - 1] ?? 0));
    expect(wrapAt).toBeGreaterThan(0);
    const before = travels[wrapAt - 1] ?? 0;
    const after = travels[wrapAt] ?? 0;
    // The offset jumped by one whole travel period; the crests moved on by one frame's travel.
    const moved = after + period - before;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(1);
    // Every crest of the train (world points on its crest lines along its direction) keeps its count across the wrap –
    // with the plain crest count, every one jumped by travelWaves at once (all streaks rolled anew).
    const phase = (along: number, travel: number): number => ((along - travel) * 2 * Math.PI) / wl;
    let same = 0;
    for (let n = -40; n <= 40; n++) {
      const at = n * wl + before + 0.1;
      const k0 = crestIndex(phase(at, before), 0);
      const k1 = crestIndex(phase(at + moved, after), 0);
      expect(k1, `Kamm ${n}`).toBe(k0);
      expect(Math.floor(phase(at + moved, after) / (2 * Math.PI) + 0.5)).not.toBe(Math.floor(phase(at, before) / (2 * Math.PI) + 0.5));
      same++;
    }
    expect(same).toBe(81);
  });

  it('M5-42: zehn Minuten Laufweg – kein Kamm würfelt neu (kein gemeinsamer Neuwurf), die Flacker-Uhr bricht erst nach ≥ 60 s um', () => {
    const speed = AMBIENT_WAVES.speedPxPerSecond;
    expect(FLICKER_CLOCK.periodSeconds).toBeGreaterThanOrEqual(60);
    for (let k = 0; k < 3; k++) {
      const wl = AMBIENT_WAVES.wavelengthsPx[k] ?? 1;
      const d = new DriftOffset(TRAVEL_PERIODS[k] ?? 0, 0, speed);
      d.setVelocity(1, 0);
      const t0 = 1234.5;
      let wraps = 0;
      let lastX = Number.NaN;
      for (let f = 0; f <= 600 * 60; f++) {
        const t = t0 + f / 60;
        d.advance(driftClock(t), 0);
        const travel = d.xPx;
        if (travel < lastX) wraps++;
        lastX = travel;
        if (f % 7 !== 0) continue;
        // The physical crest n lies at n wavelengths plus the whole way travelled (unwrapped); its count stays n mod travelWaves.
        const total = (Math.round(speed * DRIFT_UNITS) * driftClock(t)) / DRIFT_CLOCK_HZ / DRIFT_UNITS;
        for (const n of [-3, 0, 5, 63, 64, 130]) {
          const along = n * wl + Math.floor(total * DRIFT_UNITS) / DRIFT_UNITS + 0.05;
          const x = ((along - travel) * 2 * Math.PI) / wl;
          expect(crestIndex(x, 0)).toBe(((n % AMBIENT_WAVES.travelWaves) + AMBIENT_WAVES.travelWaves) % AMBIENT_WAVES.travelWaves);
        }
      }
      // Ten minutes wrap each train a few times (at most once a minute) – and no crest rolled anew.
      expect(wraps).toBeGreaterThan(0);
      expect(wraps).toBeLessThanOrEqual(10);
    }
  });

  it('hands the shader the sun’s share of the daylight and the daylight itself (sunlight on the water)', () => {
    const { fake, names, scene, run, withWater } = waterRig();
    const F = WATER_FRAME;
    scene.beginFrame(10);
    withWater();
    scene.env.ambientR = 1;
    scene.env.ambientG = 0.9;
    scene.env.ambientB = 0.8;
    scene.env.ambientIntensity = 0.5;
    scene.sky.directional.share = 0.4;
    run(10);
    const calls = uniformCalls(fake, names, 'uniform4fv', 'uFrame');
    const d = calls[calls.length - 1]?.[1] as Float32Array;
    expect(d[F.sunShare]).toBeCloseTo(0.4, 6);
    // The daylight: the frame's ambient colour × strength, uploaded from the shared ambient record (no copy per frame).
    const day = uniformCalls(fake, names, 'uniform3fv', 'uDaylight');
    const [, values, offset, length] = day[day.length - 1] as [unknown, Float32Array, number, number];
    expect([...values.subarray(offset, offset + length)].map((v) => Number(v.toFixed(6)))).toEqual([0.5, 0.45, 0.4]);
    // No directed light (night, overcast): no sun on the water.
    scene.beginFrame(11);
    withWater();
    run(11);
    const after = uniformCalls(fake, names, 'uniform4fv', 'uFrame');
    expect((after[after.length - 1]?.[1] as Float32Array)[F.sunShare]).toBe(0);
  });
});
