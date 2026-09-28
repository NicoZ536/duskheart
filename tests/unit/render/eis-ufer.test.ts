/**
 * M5-09 "Winter-Eis mit Rissen": in frost thin ice grows from the banks over open water, the wider the colder – none
 * above the freezing point of `ICE.freezeC`, all of `ICE.maxShorePx` from `ICE.hardFreezeC` down; the game view takes
 * the air temperature at the camera for it (underground and before the world exists: none). Frozen water and glacier
 * ice are flagged in the tile grid for the crack pattern (tests/unit/render/wasser-szene.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { shoreIcePx } from '../../../src/render/water/ice';
import { ICE, SKY } from '../../../src/render/water/params';
import { RenderScene } from '../../../src/render/scene';
import { WaterSceneFiller, type WaterSceneBinding } from '../../../src/render/world/waterScene';
import { createShadowVector, type ShadowVector } from '../../../src/world/calendar';
import type { Simulation } from '../../../src/game/sim';
import type { WeatherSample } from '../../../src/world/climate/weather';

describe('shore ice', () => {
  it('none above the freezing point, growing linearly, capped in a hard frost', () => {
    expect(shoreIcePx(20)).toBe(0);
    expect(shoreIcePx(ICE.freezeC)).toBe(0);
    expect(shoreIcePx(ICE.hardFreezeC)).toBe(ICE.maxShorePx);
    expect(shoreIcePx(-40)).toBe(ICE.maxShorePx);
    const mid = (ICE.freezeC + ICE.hardFreezeC) / 2;
    expect(shoreIcePx(mid)).toBeCloseTo(ICE.maxShorePx / 2, 9);
    let last = 0;
    for (let t = ICE.freezeC; t >= ICE.hardFreezeC; t -= 0.5) {
      const w = shoreIcePx(t);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
    expect(shoreIcePx(Number.NaN)).toBe(0);
  });

  it('the game view takes the air temperature at the camera; underground there is none', () => {
    // Each call a sampling slot later (the water samples calendar, weather and temperature every SKY.refreshTicks ticks of calendar time).
    let dayTick = 0;
    const sim = (temperatureC: number): Simulation =>
      ({
        clock: { dawns: 0, ticksPerDay: 86_400, dayTick: (dayTick += SKY.refreshTicks) },
        world: {
          calendar: { daylight: 1, moonIllumination: 0, night: 1, sun: (o: ShadowVector) => Object.assign(o, createShadowVector()), moon: (o: ShadowVector) => Object.assign(o, createShadowVector()) },
          materialized: true,
          regionAt: () => 0,
          weather: { periodCount: () => 1, sample: (_r: number, out: WeatherSample) => out },
          temperature: { temperatureAt: () => temperatureC },
        },
      }) as unknown as Simulation;
    const b = (t: number): WaterSceneBinding => ({ session: { sim: sim(t), samplePlayer: () => false }, host: { get: () => undefined } });
    const scene = new RenderScene();
    const f = new WaterSceneFiller();
    scene.beginFrame(1);
    f.fill(scene, b(-25), null, 0, 0, 0, 480, 270, 1);
    expect(scene.water.shoreIcePx).toBe(ICE.maxShorePx);
    scene.beginFrame(2);
    f.fill(scene, b(5), null, 0, 0, 0, 480, 270, 2);
    expect(scene.water.shoreIcePx).toBe(0);
    scene.beginFrame(3);
    f.fill(scene, b(-25), null, -1, 0, 0, 480, 270, 3);
    expect(scene.water.shoreIcePx).toBe(0);
  });
});
