/**
 * M5-41 (Gate-Prüfung N1): das Punktlicht kommt auch in den GPU-Partikeln weich über das Tageslicht – wie in der
 * Komposition (M5-Prüfung M1). Ein Partikel in der Luft kennt weder Sonne noch Schatten noch Dach: sein Tageslicht ist
 * das Umgebungslicht selbst, der Anteil also `pointOverDaylight(uAmbient, uDayLevel)` – besonnter Mittag 0 (keine
 * Flocke am Herd über der Bloom-Schwelle), Mondnacht ≥ 0,87, Höhle 1 (auf 8 Bit). Geprüft: der TypeScript-Spiegel an
 * den Umgebungslichtern der Spielansicht, der GLSL-Kern gegen den Spiegel, die Shader beider Partikelprogramme
 * (Zeichnen und Partikellicht) und dass das System die Tageslichtstufe des Frames hochlädt.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { dayLevel, pointOverAmbient, pointOverDaylight, pointOverDaylightDefines, pointOverPeak } from '../../../src/render/light/banding';
import { frameAmbient, frameDayLevel } from '../../../src/render/light/frameAmbient';
import { MOONLIGHT } from '../../../src/render/light/lightColors';
import { lightStrandDefines } from '../../../src/render/light/params';
import { particleEmitter } from '../../../src/render/particles/tables';
import { DEFAULT_PARTICLE_SETTINGS } from '../../../src/render/particles/settings';
import type { RenderContext } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { CAVE_AMBIENT, CAVE_AMBIENT_INTENSITY, NIGHT_AMBIENT } from '../../../src/render/world/gameScene';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

type Ambient = readonly [number, number, number];

/** The ambient (colour × strength) of the game view: sunlit noon, a full-moon night, a moonless night, a cave. */
const NOON: Ambient = [1, 1, 1];
const moonNight = (strength: number): Ambient => [MOONLIGHT[0] * strength, MOONLIGHT[1] * strength, MOONLIGHT[2] * strength];
const FULL_MOON = moonNight(NIGHT_AMBIENT.base + NIGHT_AMBIENT.fullMoon);
const NEW_MOON = moonNight(NIGHT_AMBIENT.base);
const CAVE: Ambient = [CAVE_AMBIENT[0] * CAVE_AMBIENT_INTENSITY, CAVE_AMBIENT[1] * CAVE_AMBIENT_INTENSITY, CAVE_AMBIENT[2] * CAVE_AMBIENT_INTENSITY];

/** The share the particle shaders compute: `pointOverDaylight(uAmbient, uDayLevel)` with `uDayLevel` = `dayLevel(ambient)`. */
const share = (a: Ambient): number => pointOverDaylight(a[0], a[1], a[2], dayLevel(a[0], a[1], a[2]));

/** Renderer on the fake GL whose uniform locations remember their names (to read what was uploaded to which uniform). */
function namedRenderer() {
  const fake = createFakeGl();
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
  const r = new Renderer(gl, { caps: { floatTargets: false, forcedRgba8: true, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  /** Values uploaded to uniform `name` by `uniform1fv`/`uniform3fv` since call index `from`, as plain arrays. */
  const uploads = (name: string, from = 0): number[][] =>
    fake.calls
      .slice(from)
      .filter((c) => (c.name === 'uniform1fv' || c.name === 'uniform3fv') && names.get(c.args[0]) === name)
      .map((c) => {
        const data = c.args[1] as Float32Array;
        const offset = (c.args[2] as number | undefined) ?? 0;
        const n = (c.args[3] as number | undefined) ?? data.length - offset;
        return Array.from(data.subarray(offset, offset + n));
      });
  return { fake, r, uploads };
}

function frame(r: Renderer, scene: RenderScene, time: number, ambient: Ambient): void {
  scene.beginFrame(time);
  scene.env.ambientR = ambient[0];
  scene.env.ambientG = ambient[1];
  scene.env.ambientB = ambient[2];
  scene.env.ambientIntensity = 1;
  scene.particles.emitters.push(particleEmitter('brand_funken'), 0, 0, 8, 1, 11);
  scene.particles.emitters.push(particleEmitter('lagerfeuer_rauch'), 20, 0, 10, 1, 13);
  scene.particles.weather.set('schnee', 0.6);
  r.render(scene, 640, 360, 'sharp');
}

describe('Punktlicht weich über dem Tageslicht in den GPU-Partikeln (M5-41)', () => {
  it('TypeScript-Spiegel: besonnter Mittag 0, Mondnacht ≥ 0,87, Neumond mehr, Höhle 1 auf 8 Bit', () => {
    expect(share(NOON)).toBe(0);
    expect(share(FULL_MOON)).toBeGreaterThanOrEqual(0.87);
    expect(share(NEW_MOON)).toBeGreaterThan(share(FULL_MOON));
    // In a cave the point light keeps all of it: less than one 8-bit step of the brightest torch (2.4) is lost.
    expect((1 - share(CAVE)) * 2.4).toBeLessThan(1 / 255);
    // The helper for programs that light with the ambient alone (particles, fog) is exactly that.
    for (const a of [NOON, FULL_MOON, NEW_MOON, CAVE]) expect(pointOverAmbient(a[0], a[1], a[2])).toBe(share(a));
    // Dusk (ambient 0.45 … 0.6): more than three fifths stay; the point light never darkens and never exceeds itself.
    expect(share(moonNight(0.6))).toBeGreaterThan(0.6);
    for (let s = 0; s <= 1.2; s += 0.05) {
      const v = share(moonNight(s));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // At noon a snow flake (albedo ≈ 0.9) beside the hearth (point light up to 2.4) stays below the bloom threshold 1.3.
    expect(0.9 * 1 + 0.9 * 2.4 * share(NOON)).toBeLessThan(1.3);
  });

  it('GLSL-Kern = Spiegel, mit den Defines beider Partikelprogramme', () => {
    // The particle programs get only the one define they need; it is the same as the light strand's.
    expect(pointOverDaylightDefines()).toEqual({ DH_POINT_DAY_SUPPRESSION: lightStrandDefines()['DH_POINT_DAY_SUPPRESSION'] });
    const core = glslScalar('composite_daylight.glsl', 'pointOverPeak', pointOverDaylightDefines());
    for (const a of [NOON, FULL_MOON, NEW_MOON, CAVE, moonNight(0.5)]) {
      const peak = Math.max(...a);
      const level = dayLevel(a[0], a[1], a[2]);
      expect(core(peak, level)).toBeCloseTo(pointOverPeak(peak, level), 12);
      expect(core(peak, level)).toBeCloseTo(share(a), 12);
    }
    expect(core(1, 1)).toBe(0);
    expect(core(0.36, 0.36)).toBeGreaterThanOrEqual(0.87);
  });

  it('Zeichnen: das Punktlicht am Fußpunkt × pointOverDaylight(uAmbient, uDayLevel), leuchtende Arten unberührt', () => {
    const src = (SHADERS['particle_draw.vert'] ?? '').replace(/\s+/g, ' ');
    expect(SHADERS['particle_draw.vert']).toMatch(/^#include "composite_daylight\.glsl"$/m);
    expect(src).toContain('uniform float uDayLevel;');
    expect(src).toContain('vec3 point = decodeHdr(texelFetch(uLight, foot, 0)) * pointOverDaylight(uAmbient, uDayLevel);');
    expect(src).toContain('color = reflectLight(albedo, uAmbient) + reflectLight(albedo, warmLight(point)) + albedo * uFlash;');
    // Glowing kinds (sparks, embers) shine by themselves: their colour does not depend on the daylight.
    expect(src).toContain('color = albedo * glow * flicker;');
    expect(src.indexOf('pointOverDaylight(uAmbient, uDayLevel)')).toBeGreaterThan(src.indexOf('} else if (uLit == 1) {'));
  });

  it('Partikellicht (Ultra): das Glühen auf den Flächen darunter ebenso weich – kein Funkenhof auf besonntem Boden', () => {
    const src = (SHADERS['particle_light.vert'] ?? '').replace(/\s+/g, ' ');
    expect(SHADERS['particle_light.vert']).toMatch(/^#include "composite_daylight\.glsl"$/m);
    expect(src).toContain('uniform vec3 uAmbient;');
    expect(src).toContain('uniform float uDayLevel;');
    expect(src).toContain('vLight = color * r1.w * flicker * alpha * uIntensity * pointOverDaylight(uAmbient, uDayLevel);');
  });

  it('das System lädt Umgebungslicht und Tageslichtstufe des Frames in beide Programme', () => {
    const { r, fake, uploads } = namedRenderer();
    const scene = new RenderScene();
    r.particles.configure({ ...DEFAULT_PARTICLE_SETTINGS, particleLights: true });
    const cases: [Ambient, number][] = [
      [NOON, 1],
      [FULL_MOON, Math.max(...FULL_MOON)],
      [CAVE, Math.max(...CAVE)],
    ];
    let t = 3;
    for (const [ambient, level] of cases) {
      const from = fake.calls.length;
      frame(r, scene, t, ambient);
      t += 1 / 60;
      const levels = uploads('uDayLevel', from);
      const ambients = uploads('uAmbient', from);
      // Drawing and particle light: each program gets the frame's level – the composition's `uDayLevel`.
      expect(levels.length).toBeGreaterThanOrEqual(2);
      for (const l of levels) expect(l).toEqual([Math.fround(level)]);
      for (const a of ambients) expect(a).toEqual(ambient.map((v) => Math.fround(v)));
      // What the shader then computes from the uploads is the mirror's share.
      const a = ambients[0] as number[];
      const l = (levels[0] as number[])[0] as number;
      expect(pointOverDaylight(a[0] as number, a[1] as number, a[2] as number, l)).toBeCloseTo(share(ambient), 6);
    }
  });

  it('frameDayLevel ist dayLevel des Umgebungslichts des Frames, einmal je Frame gerechnet', () => {
    const scene = new RenderScene();
    scene.env.ambientR = 0.5;
    scene.env.ambientG = 0.6;
    scene.env.ambientB = 0.8;
    scene.env.ambientIntensity = 0.5;
    const ctx = { scene, frame: { index: 7 } } as unknown as RenderContext;
    const level = frameDayLevel(ctx);
    expect(level[0]).toBeCloseTo(0.4, 6);
    expect(Array.from(frameAmbient(ctx).subarray(0, 3))).toEqual([0.25, 0.3, 0.4].map((v) => Math.fround(v)));
    // Same frame: the kept record, even if the scene changed meanwhile; the next frame computes it again.
    scene.env.ambientIntensity = 2;
    expect(frameDayLevel(ctx)[0]).toBeCloseTo(0.4, 6);
    const next = { scene, frame: { index: 8 } } as unknown as RenderContext;
    expect(frameDayLevel(next)[0]).toBe(1);
    expect(frameDayLevel(next)).toBe(level);
  });
});
