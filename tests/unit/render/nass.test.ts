/**
 * M5-20 „globaler Nässewert → dunklerer Boden, Glanz, Pfützen in Senken …; langsames Abtrocknen“: the ground soaks
 * while it rains and dries slowly afterwards (faster in heat), the puddles fill once the ground is wet and dry out
 * after it; the surface of the frame carries both to the terrain program. Caves stay dry.
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { puddleTarget, steadyWetness, Weathering, type GroundWeather } from '../../../src/render/surface/weathering';
import { clusterNoise, NOISE_SALT, puddleAt, wetPatch } from '../../../src/render/surface/rules';

const P = SURFACE_PARAMS.wet;

function weather(w: Partial<GroundWeather>): GroundWeather {
  return { rain: 0, snow: 0, temperatureC: 12, winter: false, ...w };
}

describe('Nässe des Bodens', () => {
  it('soaks while it rains towards the steady state of that rain, harder rain wetter', () => {
    const w = new Weathering();
    w.step(0, weather({}));
    expect(w.wetness).toBe(0);
    let last = 0;
    for (let m = 5; m <= 240; m += 5) {
      w.step(m, weather({ rain: 0.65 }));
      expect(w.wetness).toBeGreaterThan(last);
      last = w.wetness;
    }
    expect(w.wetness).toBeCloseTo(steadyWetness(weather({ rain: 0.65 })), 3);
    expect(steadyWetness(weather({ rain: 1 }))).toBeGreaterThan(steadyWetness(weather({ rain: 0.25 })));
    expect(steadyWetness(weather({}))).toBe(0);
  });

  it('dries slowly: after an hour without rain most of it is still there, after a day it is gone', () => {
    const w = new Weathering();
    w.step(0, weather({ rain: 1 }));
    const soaked = w.wetness;
    w.step(60, weather({}));
    expect(w.wetness).toBeGreaterThan(soaked * 0.6);
    expect(w.wetness).toBeLessThan(soaked);
    w.step(60 + 24 * 60, weather({}));
    expect(w.wetness).toBeLessThan(0.01);
  });

  it('heat dries faster', () => {
    const cool = new Weathering();
    const hot = new Weathering();
    cool.step(0, weather({ rain: 1 }));
    hot.step(0, weather({ rain: 1, temperatureC: 30 }));
    cool.step(120, weather({ temperatureC: 12 }));
    hot.step(120, weather({ temperatureC: 30 }));
    expect(hot.wetness).toBeLessThan(cool.wetness);
  });

  it('the exact solution does not depend on how the time is cut into frames', () => {
    const one = new Weathering();
    const many = new Weathering();
    one.step(0, weather({}));
    many.step(0, weather({}));
    one.step(90, weather({ rain: 0.5 }));
    for (let m = 1; m <= 90; m++) many.step(m, weather({ rain: 0.5 }));
    expect(many.wetness).toBeCloseTo(one.wetness, 10);
  });
});

describe('Pfützen', () => {
  it('fill once the ground is wet enough, fast, and dry slowly', () => {
    expect(puddleTarget(P.puddleFrom)).toBe(0);
    expect(puddleTarget(1)).toBe(1);
    const w = new Weathering();
    w.step(0, weather({}));
    w.step(30, weather({ rain: 1 }));
    const early = w.puddles;
    w.step(180, weather({ rain: 1 }));
    expect(w.puddles).toBeGreaterThan(early);
    expect(w.puddles).toBeCloseTo(puddleTarget(w.wetness), 2);
    const full = w.puddles;
    w.step(240, weather({}));
    expect(w.puddles).toBeGreaterThan(full - 60 * P.puddleDryPerMinute - 1e-9);
    expect(w.puddles).toBeLessThan(full);
  });

  it('stand in the hollows of the noise field: more fill, more puddles, never more than the cover share', () => {
    const share = (fill: number): number => {
      let s = 0;
      let n = 0;
      for (let y = 0; y < 800; y += 2) {
        for (let x = 0; x < 800; x += 2) {
          n++;
          if (puddleAt(fill, clusterNoise(x, y, P.puddleWavelengthPx, P.puddleWavelengthPx * 0.3, P.puddleCellPx, NOISE_SALT.puddle))) s++;
        }
      }
      return s / n;
    };
    expect(share(0)).toBe(0);
    const half = share(0.5);
    const full = share(1);
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half);
    expect(full).toBeLessThan(P.puddleCoverMax * 1.3);
    expect(full).toBeGreaterThan(P.puddleCoverMax * 0.6);
  });

  it('wet ground darkens in patches that grow with the wetness, all of it when soaked', () => {
    let last = -1;
    for (const wet of [0, 0.3, 0.6, 0.9, 1]) {
      let s = 0;
      for (let i = 0; i < 2000; i++) if (wetPatch(wet, clusterNoise(i * 5, i * 3, 24, 7, 2, NOISE_SALT.wet))) s++;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(last).toBe(2000);
  });
});
