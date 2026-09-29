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

/** TypeScript mirror of sway.glsl (`swayUp`, `swayPad`, `swayRowShift`). */
const swayUp = (localY: number, anchorY: number): number => Math.max(0, Math.min(1, (anchorY - localY) / Math.max(1, anchorY)));
const swayPad = (swayX: number): number => Math.ceil(Math.abs(swayX) * 0.25) + 1;
function swayRowShift(swayX: number, bottomUp2: number, localY: number, height: number, anchorY: number): number {
  const up = swayUp(localY, anchorY);
  const t = Math.max(0, Math.min(1, localY / height));
  return swayX * (1 + (bottomUp2 - 1) * t - up * up);
}

describe('Wind: Wiegen je Zeile quadratisch, Schatten wiegen mit (M5-Review Minor 14)', () => {
  /** Screen x of content column `c` of row `localY` after vertex shear and fragment shift (mirror of both stages). */
  function swayedColumn(c: number, localY: number, height: number, anchorY: number, sway: number, mirrored: boolean): number {
    const bottomUp = swayUp(height, anchorY);
    const b2 = bottomUp * bottomUp;
    // The vertex stage: the corners carry sway · up² of the top (1) and bottom row; linear between them.
    const linear = sway * (1 + (b2 - 1) * (localY / height));
    // The fragment stage samples column L + shift (mirrored: L − shift): the content c is drawn where L = c ∓ shift.
    const shift = swayRowShift(sway, b2, localY, height, anchorY);
    const l = mirrored ? c + shift : c - shift;
    return (mirrored ? -l : l) + linear;
  }

  it('jede Zeile steht bei up² der Wipfelauslenkung, der Fuß bleibt stehen, Spiegeln ändert nichts daran', () => {
    for (const [height, anchorY] of [
      [32, 32],
      [96, 96],
      [40, 36],
    ] as const) {
      for (const sway of [-3.5, -1, 0.6, 2, 5]) {
        for (const mirrored of [false, true]) {
          for (let y = 0; y < height; y++) {
            const localY = y + 0.5;
            const up = swayUp(localY, anchorY);
            const c = 7.5;
            const unswayed = mirrored ? -c : c;
            expect(swayedColumn(c, localY, height, anchorY, sway, mirrored) - unswayed).toBeCloseTo(sway * up * up, 9);
          }
        }
      }
    }
    // Top row and foot keep the corners' sway: no shift there.
    expect(swayRowShift(4, 0, 0, 32, 32)).toBe(0);
    expect(swayRowShift(4, 0, 32, 32, 32)).toBe(0);
  });

  it('die Verschiebung ist höchstens ein Viertel der Auslenkung (halbe Höhe) – das Quad reicht so weit plus ein Pixel', () => {
    for (const sway of [0.4, 1.7, 3, 6.2]) {
      let most = 0;
      for (let y = 0; y <= 64; y += 0.25) most = Math.max(most, Math.abs(swayRowShift(sway, 0, y, 64, 64)));
      expect(most).toBeCloseTo(sway / 4, 2);
      expect(swayPad(sway)).toBeGreaterThanOrEqual(most + 1);
      expect(swayPad(-sway)).toBe(swayPad(sway));
    }
  });

  it('Sprite- und Schattenprogramm nutzen dasselbe Wiegen; der Schattenpass bekommt den Wind der Sprites', () => {
    const vert = (SHADERS['sprite_gbuffer.vert'] ?? '').replace(/\s+/g, ' ');
    expect(vert).toContain('sway = windSway(uWind, anchorWorld, aParams.y, aParams.z);');
    expect(vert).toContain('local.x += (aCorner.x * 2.0 - 1.0) * swayPad(sway.x);');
    expect(vert).toContain('rel += sway * (up * up);');
    const frag = (SHADERS['sprite_gbuffer.frag'] ?? '').replace(/\s+/g, ' ');
    expect(frag).toContain('float shift = swayRowShift(vSway.x, vSway.y, vLocal.y, float(vRect.w), vAnchor.y);');
    expect(frag).toContain('ivec2 p = clamp(ivec2(floor(sampled)), ivec2(0), ivec2(vRect.zw) - 1);');
    const shadowVert = (SHADERS['shadow_sprite.vert'] ?? '').replace(/\s+/g, ' ');
    expect(shadowVert).toContain('sway = windSway(uWind, anchorWorld, aParams.y, aParams.z);');
    expect(shadowVert).toContain('vec2 world = anchorWorld + vec2(rel.x, 0.0) + sway * (up * up) + uShadow.xy * (uShadow.z * h);');
    const shadowFrag = (SHADERS['shadow_sprite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(shadowFrag).toContain('sampled.x += swayRowShift(vSway.x, vSway.y, vLocal.y, float(vRect.w), vAnchorY);');
    const glsl = (SHADERS['sway.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('return swayX * (mix(1.0, bottomUp2, clamp(localY / height, 0.0, 1.0)) - up * up);');
    expect(glsl).toContain('return ceil(abs(swayX) * 0.25) + 1.0;');
  });
});
