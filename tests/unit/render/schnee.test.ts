/**
 * M5-19 „Winter-Schneemaske (weltfest, wächst mit Schneefall auf Dächern, Kronen, Felsoberseiten)“: the snow cover
 * builds up while it snows and melts above freezing; a first sight of the world in winter finds the snow the cold
 * holds, outside winter only permanent snow. The mask is a function of the world position (the TypeScript mirror of
 * `shaders/world/surface.glsl`, whose scalar rules are evaluated here against it): it only grows as the cover grows
 * – a place under snow stays under snow –, it is cut in cell clusters (no single-pixel speckle), and on sprites the
 * up-facing pixels carry snow first.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { SURFACE_PARAMS, surfaceDefines } from '../../../src/render/surface/params';
import { clusterNoise, NOISE_SALT, puddleAt, snowLine, spriteSnow, wetPatch } from '../../../src/render/surface/rules';
import { steadySnow, Weathering, type GroundWeather } from '../../../src/render/surface/weathering';

const P = SURFACE_PARAMS.snow;

function weather(w: Partial<GroundWeather>): GroundWeather {
  return { rain: 0, snow: 0, temperatureC: -5, winter: true, ...w };
}

/** A scalar GLSL function of surface.glsl as JavaScript (`#define`s substituted, `float` → `let`). */
function glsl(name: string): (...args: number[]) => number {
  const source = SHADERS['world/surface.glsl'];
  if (source === undefined) throw new Error('world/surface.glsl fehlt');
  const m = new RegExp(`float\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (m === null) throw new Error(`surface.glsl: ${name} fehlt`);
  const params = (m[1] ?? '').split(',').map((p) => p.trim().replace(/^float\s+/, ''));
  let body = m[2] ?? '';
  for (const [k, v] of Object.entries(surfaceDefines())) body = body.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
  if (/\b(vec[234]|texelFetch|DH_)\b/.test(body)) throw new Error(`surface.glsl: ${name} ist nicht skalar:\n${body}`);
  body = body.replace(/\bfloat\s+/g, 'let ');
  return new Function(`return function (${params.join(', ')}) {${body}};`)() as (...args: number[]) => number;
}

describe('Schneedecke über die Zeit', () => {
  it('grows with the snowfall and stops growing when it is full', () => {
    const w = new Weathering();
    w.step(0, weather({ temperatureC: 5, winter: false }));
    expect(w.snow).toBe(0);
    w.step(60, weather({ snow: 1, temperatureC: -3 }));
    expect(w.snow).toBeCloseTo(60 * P.growPerMinute, 12);
    w.step(120, weather({ snow: 0.5, temperatureC: -3 }));
    expect(w.snow).toBeCloseTo(60 * P.growPerMinute + 30 * P.growPerMinute, 12);
    w.step(100_00, weather({ snow: 1, temperatureC: -3 }));
    expect(w.snow).toBe(1);
  });

  it('melts above freezing, faster the warmer, and stays while it is cold', () => {
    const w = new Weathering();
    w.step(0, weather({ temperatureC: -10 }));
    expect(w.snow).toBe(1);
    w.step(600, weather({ temperatureC: -1 }));
    expect(w.snow).toBe(1);
    w.step(660, weather({ temperatureC: 2.5 }));
    const slow = 1 - w.snow;
    expect(slow).toBeCloseTo(60 * (2.5 - P.meltFromC) * P.meltPerMinuteC, 12);
    const v = new Weathering();
    v.step(0, weather({ temperatureC: -10 }));
    v.step(60, weather({ temperatureC: 6.5 }));
    expect(1 - v.snow).toBeGreaterThan(slow * 2.5);
  });

  it('a first sight finds the snow the cold holds in winter, outside winter only permanent snow or what falls', () => {
    expect(steadySnow(P.coldC)).toBe(1);
    expect(steadySnow(P.warmC)).toBe(0);
    expect(steadySnow((P.coldC + P.warmC) / 2)).toBeCloseTo(0.5, 12);
    const winter = new Weathering();
    winter.step(500, weather({ temperatureC: -6 }));
    expect(winter.snow).toBe(1);
    const spring = new Weathering();
    spring.step(500, weather({ temperatureC: -6, winter: false }));
    expect(spring.snow).toBe(0);
    const peak = new Weathering();
    peak.step(500, weather({ temperatureC: P.permanentBelowC - 1, winter: false }));
    expect(peak.snow).toBe(1);
    const falling = new Weathering();
    falling.step(500, weather({ snow: 0.5, temperatureC: -6, winter: false }));
    expect(falling.snow).toBe(0.5);
  });

  it('a time skip longer than a week starts over from the steady state; going back in time too', () => {
    const w = new Weathering();
    w.step(0, weather({ temperatureC: 5 }));
    expect(w.snow).toBe(0);
    w.step(8 * 24 * 60, weather({ temperatureC: -6 }));
    expect(w.snow).toBe(1);
    w.step(100, weather({ temperatureC: 5 }));
    expect(w.snow).toBe(0);
  });
});

describe('Schneemaske', () => {
  it('the GLSL rules are the TypeScript rules', () => {
    const line = glsl('snowLine');
    const sprite = glsl('spriteSnow');
    const puddle = glsl('puddleAt');
    const wet = glsl('wetPatch');
    for (let a = 0; a <= 20; a++) {
      for (let b = 0; b <= 20; b++) {
        const c = a / 20;
        const n = b / 20;
        expect(line(c, n) > 0.5, `snowLine ${c} ${n}`).toBe(snowLine(c, n));
        expect(puddle(c, n) > 0.5, `puddleAt ${c} ${n}`).toBe(puddleAt(c, n));
        expect(wet(c, n) > 0.5, `wetPatch ${c} ${n}`).toBe(wetPatch(c, n));
        for (const up of [0, 0.3, 0.6, 1.2]) expect(sprite(c, up, n) > 0.5, `spriteSnow ${c} ${up} ${n}`).toBe(spriteSnow(c, up, n));
      }
    }
  });

  it('only grows: a place under snow at a thin cover stays under snow at every thicker one', () => {
    for (let i = 0; i < 4000; i++) {
      const x = (i * 37) % 997;
      const y = Math.floor(i / 7) * 3;
      const n = clusterNoise(x, y, P.noiseWavelengthPx, P.noiseDetailPx, P.cellPx, NOISE_SALT.snow);
      let snowy = false;
      for (let c = 0; c <= 1.0001; c += 0.05) {
        const now = snowLine(c, n);
        if (snowy) expect(now).toBe(true);
        snowy = now;
      }
      expect(snowy).toBe(true);
    }
  });

  it('is anchored to the world in clusters of whole cells: never a single pixel', () => {
    const cell = P.cellPx;
    // Every pixel of a cell has the value of the cell's first pixel (counted, one assertion: 65 536 pixels).
    const odd: string[] = [];
    for (let y = 0; y < 256; y += cell) {
      for (let x = 0; x < 256; x += cell) {
        const n = clusterNoise(x, y, P.noiseWavelengthPx, P.noiseDetailPx, cell, NOISE_SALT.snow);
        for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) if (clusterNoise(x + dx, y + dy, P.noiseWavelengthPx, P.noiseDetailPx, cell, NOISE_SALT.snow) !== n) odd.push(`${x + dx},${y + dy}`);
      }
    }
    expect(odd).toEqual([]);
  });

  it('covers about the cover: a third of the ground at a third, most of it at 0.9, all at 1', () => {
    const share = (c: number): number => {
      let s = 0;
      let n = 0;
      for (let y = 0; y < 640; y += 2) {
        for (let x = 0; x < 640; x += 2) {
          n++;
          if (snowLine(c, clusterNoise(x + 3000, y + 1200, P.noiseWavelengthPx, P.noiseDetailPx, P.cellPx, NOISE_SALT.snow))) s++;
        }
      }
      return s / n;
    };
    expect(share(0)).toBe(0);
    expect(share(0.33)).toBeGreaterThan(0.1);
    expect(share(0.33)).toBeLessThan(0.45);
    expect(share(0.9)).toBeGreaterThan(0.85);
    expect(share(1)).toBe(1);
  });

  it('sprites: nothing below the first cover, up-facing pixels before side-facing ones', () => {
    expect(spriteSnow(P.spriteCoverFrom, 2, 0)).toBe(false);
    expect(spriteSnow(1, P.spriteUpFrom, 0)).toBe(false);
    let top = 0;
    let side = 0;
    for (let i = 0; i <= 100; i++) {
      const n = i / 100;
      if (spriteSnow(0.6, 1.2, n)) top++;
      if (spriteSnow(0.6, 0.3, n)) side++;
    }
    expect(top).toBeGreaterThan(side);
    expect(top).toBeGreaterThan(50);
  });
});
