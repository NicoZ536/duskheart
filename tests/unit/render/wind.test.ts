/**
 * M5-17 „Windrichtung aus Wetter (Unit-Test Parameterfluss)“: the wind of the world surface comes from the simulation –
 * strength from the weather sample at the camera, direction from the weather period (`windDirection`, the direction
 * the fire spreads with), turned along the shorter arc with the weather's blend – into `scene.surface`, and from there
 * into the sprite program's `uWind` (scenes without weather keep swaying with `env.wind`).
 */
import { describe, expect, it } from 'vitest';
import { DIR_DX, DIR_DY, windDirection } from '../../../src/game/fire/formulas';
import type { Simulation } from '../../../src/game/sim';
import { normalizeSeed } from '../../../src/engine/rng';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { directionAngle, turnAngle, windVector } from '../../../src/render/surface/wind';
import { SurfaceSceneFiller, SurfaceView } from '../../../src/render/world/surfaceScene';
import { RenderScene } from '../../../src/render/scene';
import { bindSpriteSurface } from '../../../src/render/surface/frame';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { SHADERS } from '../../../src/render/shaderLib';
import { gbufferDefines } from '../../../src/render/gbuffer';
import { surfaceDefines } from '../../../src/render/surface/params';
import type { RenderContext } from '../../../src/render/passes/registry';
import type { WeatherSample } from '../../../src/world/climate/weather';
import { createFakeGl } from './fakeGl';

const SEED = 20_260_923;
const REGION = 5;

/** A simulation stand-in with exactly what the surface reads: clock, calendar, weather at a region, temperature. */
function fakeSim(opts: { wind: number; blend: number; period: number; precipitation?: number; kind?: WeatherSample['precipitationKind']; temperatureC?: number; tick?: number }): Simulation {
  const sample = (_r: number, out: WeatherSample): WeatherSample => {
    out.wind = opts.wind;
    out.blend = opts.blend;
    out.precipitation = opts.precipitation ?? 0;
    out.precipitationKind = opts.kind ?? 'keiner';
    return out;
  };
  return {
    config: { seed: SEED },
    clock: { tick: opts.tick ?? 3600, ticksPerGameMinute: 60, dayFraction: 0.5 },
    world: {
      materialized: true,
      calendar: { today: { seasonIndex: 1, dayOfSeason: 4, seasonLengthDays: 7 }, daylight: 1, season: 'sommer' },
      regionAt: () => REGION,
      weather: { sample, periodCount: () => opts.period },
      temperature: { temperatureAt: () => opts.temperatureC ?? 12 },
      chunks: { get: () => undefined },
    },
  } as unknown as Simulation;
}

function view(): SurfaceView {
  return new SurfaceView().set(0, 800, 800, 480, 270, false, 0, 0, 1, 0);
}

describe('Wind der Welt-Oberfläche', () => {
  it('turns direction indices into screen vectors (+x east, +y south, the way the wind blows)', () => {
    for (let d = 0; d < 8; d++) {
      const a = directionAngle(d);
      const len = Math.hypot(DIR_DX[d] ?? 0, DIR_DY[d] ?? 0);
      expect(Math.cos(a)).toBeCloseTo((DIR_DX[d] ?? 0) / len, 12);
      expect(Math.sin(a)).toBeCloseTo((DIR_DY[d] ?? 0) / len, 12);
    }
  });

  it('turns along the shorter arc with the blend', () => {
    // North-west (7) to north-east (1): over north, never over south.
    const from = directionAngle(7);
    const to = directionAngle(1);
    const mid = turnAngle(from, to, 0.5);
    expect(Math.cos(mid)).toBeCloseTo(0, 12);
    expect(Math.sin(mid)).toBeCloseTo(-1, 12);
    expect(turnAngle(from, to, 0)).toBeCloseTo(from, 12);
    expect(Math.cos(turnAngle(from, to, 1))).toBeCloseTo(Math.cos(to), 12);
  });

  it('scales with the weather strength and carries it as gust strength', () => {
    const out = { x: 0, y: 0, gust: 0 };
    windVector(0.5, 2, 2, 1, out); // east
    expect(out.x).toBeCloseTo(0.5 * SURFACE_PARAMS.wind.scale, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.gust).toBe(0.5);
    windVector(2, 4, 4, 1, out); // south, strength clamped to 1
    expect(out.y).toBeCloseTo(SURFACE_PARAMS.wind.scale, 12);
    expect(out.gust).toBe(1);
  });

  it('flows from the weather sample and the period direction into scene.surface', () => {
    const period = 9;
    const scene = new RenderScene();
    const filler = new SurfaceSceneFiller();
    for (const blend of [0, 0.3, 1]) {
      scene.beginFrame(1);
      filler.fill(scene, fakeSim({ wind: 0.8, blend, period }), null, view());
      const seed = normalizeSeed(SEED);
      const expected = windVector(0.8, windDirection(seed, REGION, period - 1), windDirection(seed, REGION, period), blend, { x: 0, y: 0, gust: 0 });
      expect(scene.surface.weatherDriven).toBe(true);
      expect(scene.surface.windX).toBeCloseTo(expected.x, 12);
      expect(scene.surface.windY).toBeCloseTo(expected.y, 12);
      expect(scene.surface.gust).toBe(0.8);
    }
  });

  it('a new weather period turns the wind to its own direction', () => {
    const seed = normalizeSeed(SEED);
    // Find two periods whose directions differ, and check the settled wind points the new way.
    let p = 1;
    while (windDirection(seed, REGION, p) === windDirection(seed, REGION, p - 1)) p++;
    const scene = new RenderScene();
    scene.beginFrame(1);
    new SurfaceSceneFiller().fill(scene, fakeSim({ wind: 1, blend: 1, period: p }), null, view());
    const a = directionAngle(windDirection(seed, REGION, p));
    expect(Math.atan2(scene.surface.windY, scene.surface.windX)).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 12);
  });

  it('caves have still air', () => {
    const scene = new RenderScene();
    scene.beginFrame(1);
    new SurfaceSceneFiller().fill(scene, fakeSim({ wind: 1, blend: 1, period: 3 }), null, new SurfaceView().set(-1, 800, 800, 480, 270, false, 0, 0, 1, 0));
    expect([scene.surface.windX, scene.surface.windY]).toEqual([0, 0]);
  });

  it('reaches the sprite program as uWind; without weather the sprites sway with env.wind', () => {
    const fake = createFakeGl();
    const shaders = new ShaderLibrary(fake.gl, new GpuResourceRegistry(), new ShaderSourceStore(SHADERS), { ...gbufferDefines(), ...surfaceDefines() }, { report: () => undefined });
    const prog = shaders.program({ name: 'sprite-gbuffer', vertex: 'sprite_gbuffer.vert', fragment: 'sprite_gbuffer.frag' });
    expect(prog.use()).toBe(true);
    const scene = new RenderScene();
    const ctx = { gl: fake.gl, scene, frame: { index: 0, time: 2.5, camera: { originX: 0, originY: 0 } } } as unknown as RenderContext;
    const windOf = (): readonly unknown[] => {
      const loc = prog.uniform('uWind');
      // Handed over as a typed array (`uniform4fv`, no boxed number per frame); read at once, the array is reused.
      const call = [...fake.calls].reverse().find((c) => (c.name === 'uniform4f' || c.name === 'uniform4fv') && c.args[0] === loc);
      if (call === undefined) return [];
      return call.name === 'uniform4fv' ? [...(call.args[1] as Float32Array)] : call.args.slice(1);
    };
    scene.beginFrame(2.5);
    scene.env.wind = -0.7;
    bindSpriteSurface(ctx, prog, 3);
    const [ex, ey, et, eg] = windOf() as number[];
    expect(ex).toBeCloseTo(-0.7, 6);
    expect([ey, et, eg]).toEqual([0, 2.5, 0]);
    scene.beginFrame(2.5);
    new SurfaceSceneFiller().fill(scene, fakeSim({ wind: 0.6, blend: 1, period: 4 }), null, view());
    bindSpriteSurface(ctx, prog, 3);
    const [x, y, t, gust] = windOf() as number[];
    expect(x).toBeCloseTo(scene.surface.windX, 6);
    expect(y).toBeCloseTo(scene.surface.windY, 6);
    expect(t).toBe(2.5);
    expect(gust).toBeCloseTo(0.6, 6);
  });
});
