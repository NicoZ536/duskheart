/**
 * M5-09: the wave equation of the interactive water. The scalar GLSL of `water.glsl` (`waveStep`, `impulseProfile`)
 * is extracted from the shader source, evaluated as JavaScript and compared with the CPU mirror in
 * `src/render/water/waves.ts`; the CPU field then shows the behaviour the shader implements – a kick spreads as a
 * ring at the wave speed, symmetric in all four directions, loses energy without ever blowing up, is held at the
 * shore, and moves with the camera by whole texels. The fixed-step clock and the packing of the heights are pinned
 * as well.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { waterDefines, WAVES } from '../../../src/render/water/params';
import { impulseProfile, packHeight, PACK_STEPS, unpackHeight, WaveField, waveFieldOrigin, waveFieldTexels, waveStep, waveSteps } from '../../../src/render/water/waves';

type ScalarFn = (...args: number[]) => number;

/** A scalar GLSL function of `file` as JavaScript (defines substituted; anything vector-valued is refused). */
function glslFunction(file: string, name: string, defines: Readonly<Record<string, string>>): ScalarFn {
  const source = SHADERS[file];
  if (source === undefined) throw new Error(`Shader ${file} fehlt`);
  const m = new RegExp(`float\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (m === null) throw new Error(`${file}: Funktion ${name} nicht gefunden`);
  const params = (m[1] ?? '').split(',').map((p) => p.trim().replace(/^float\s+/, ''));
  let body = m[2] ?? '';
  for (const [k, v] of Object.entries(defines)) body = body.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
  if (/\b(vec[234]|[iu]vec[234]|texelFetch|dot|normalize|mix|length)\b|DH_/.test(body)) throw new Error(`${file}: ${name} ist nicht skalar oder hat offene Defines:\n${body}`);
  body = body.replace(/\bfloat\s+/g, 'let ');
  const factory = new Function('max', 'min', `return function (${params.join(', ')}) {${body}};`) as (...helpers: unknown[]) => ScalarFn;
  return factory(Math.max, Math.min);
}

const defines = waterDefines();

describe('wave equation: GLSL = CPU mirror', () => {
  it('water.glsl waveStep equals waves.ts waveStep on sample values', () => {
    const glsl = glslFunction('water.glsl', 'waveStep', defines);
    const values = [-2.5, -0.7, 0, 0.3, 1.9];
    for (const h of values) {
      for (const prev of values) {
        for (const edges of values) {
          const corners = -edges * 0.5 + prev * 0.25;
          for (const damping of [1, WAVES.damping, WAVES.damping * WAVES.shoreDamping]) {
            expect(glsl(h, prev, edges, corners, damping)).toBeCloseTo(waveStep(h, prev, edges, corners, damping), 12);
          }
        }
      }
    }
  });

  it('water.glsl impulseProfile equals waves.ts impulseProfile: 1 at the centre, 0 with zero slope at the radius', () => {
    const glsl = glslFunction('water.glsl', 'impulseProfile', defines);
    for (const r of [0.2, 1, 2.5, 3]) {
      for (let i = 0; i <= 40; i++) {
        const d = (i / 30) * r;
        expect(glsl(d, r)).toBeCloseTo(impulseProfile(d, r), 12);
      }
    }
    expect(impulseProfile(0, 3)).toBe(1);
    expect(impulseProfile(3, 3)).toBe(0);
    expect(impulseProfile(2.999, 3)).toBeLessThan(1e-5);
  });

  it('the shader defines carry the numbers of params.ts', () => {
    expect(Number(defines.DH_WAVE_SPEED2)).toBe(WAVES.speed2);
    expect(Number(defines.DH_WAVE_DAMPING)).toBe(WAVES.damping);
    expect(Number(defines.DH_WAVE_RANGE)).toBe(WAVES.range);
    expect(Number(defines.DH_WAVE_TEXEL)).toBe(WAVES.texelPx);
  });

  it('the discrete wave equation is stable: c² stays below 0.5', () => {
    expect(WAVES.speed2).toBeGreaterThan(0);
    expect(WAVES.speed2).toBeLessThanOrEqual(0.5);
    expect(WAVES.damping).toBeLessThan(1);
  });
});

describe('height packing (16-bit fixed point over ±range)', () => {
  it('round-trips within one step and clamps at the range', () => {
    const step = (2 * WAVES.range) / PACK_STEPS;
    for (const v of [-WAVES.range, -3.3, -0.001, 0, 0.0004, 1, 2.71828, WAVES.range - 0.001]) {
      const [hi, lo] = packHeight(v);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(255);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(lo).toBeLessThanOrEqual(255);
      expect(Math.abs(unpackHeight(hi, lo) - v)).toBeLessThanOrEqual(step);
    }
    const [hi, lo] = packHeight(3 * WAVES.range);
    expect(unpackHeight(hi, lo)).toBeCloseTo(WAVES.range, 3);
  });

  it('calm water is an exact byte pair (the clear value of the fields)', () => {
    const [hi, lo] = packHeight(0);
    expect(Math.abs(unpackHeight(hi, lo))).toBeLessThan((2 * WAVES.range) / PACK_STEPS);
  });
});

describe('WaveField (the CPU mirror of water_wave.frag)', () => {
  const kick = (f: WaveField, x: number, y: number, strength = -2): void => f.step([{ x: x + 0.5, y: y + 0.5, radius: 2, strength }]);

  it('a kick spreads as a ring at the wave speed, the same in all four directions', () => {
    const f = new WaveField(81, 81);
    kick(f, 40, 40);
    for (let i = 0; i < 40; i++) f.step();
    // After 41 steps at c = √0.25 = 0.5 texel/step the front lies about 20 texels out: the ring at 16–22 carries the wave.
    const inner = f.ringPeak(40, 40, 4);
    const front = Math.max(f.ringPeak(40, 40, 18), f.ringPeak(40, 40, 20));
    const beyond = f.ringPeak(40, 40, 30);
    expect(front).toBeGreaterThan(beyond * 4);
    expect(front).toBeGreaterThan(1e-3);
    expect(inner).toBeLessThan(front * 3);
    for (const r of [6, 12, 18]) {
      const e = f.at(40 + r, 40);
      expect(f.at(40 - r, 40)).toBeCloseTo(e, 6);
      expect(f.at(40, 40 + r)).toBeCloseTo(e, 6);
      expect(f.at(40, 40 - r)).toBeCloseTo(e, 6);
    }
  });

  it('a raindrop-sized kick leaves no checkerboard behind (kicks are at least WAVES.minImpulseTexels wide)', () => {
    const f = new WaveField(40, 40);
    f.step([{ x: 20.5, y: 20.5, radius: 0.4, strength: -2 }]);
    for (let i = 0; i < 12; i++) f.step();
    // The grid's shortest wave alternates sign from texel to texel: its share of the field stays small.
    let checker = 0;
    let total = 0;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const h = f.at(x, y);
        checker += (x + y) % 2 === 0 ? h : -h;
        total += Math.abs(h);
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(Math.abs(checker)).toBeLessThan(total * 0.05);
    expect(impulseProfile(1, 0.4)).toBeGreaterThan(0);
  });

  it('loses energy (damped) and stays bounded over a long run', () => {
    const f = new WaveField(48, 48);
    kick(f, 24, 24, -4);
    let last = f.energy();
    const start = last;
    for (let i = 0; i < 600; i++) {
      f.step();
      const e = f.energy();
      expect(Number.isFinite(e)).toBe(true);
      last = e;
    }
    expect(last).toBeLessThan(start * 0.01);
  });

  it('holds land at 0: a wall keeps the ring out of the land behind it', () => {
    const f = new WaveField(60, 30);
    for (let y = 0; y < 30; y++) for (let x = 40; x < 60; x++) f.land[y * 60 + x] = 1;
    kick(f, 20, 15, -3);
    let leaked = 0;
    for (let i = 0; i < 120; i++) {
      f.step();
      for (let y = 0; y < 30; y++) for (let x = 40; x < 60; x++) leaked = Math.max(leaked, Math.abs(f.at(x, y)));
    }
    expect(leaked).toBe(0);
  });

  it('moves with the camera by whole texels (the ring stays where it was in the world)', () => {
    const a = new WaveField(64, 64);
    const b = new WaveField(64, 64);
    kick(a, 30, 30);
    kick(b, 30, 30);
    for (let i = 0; i < 6; i++) {
      a.step();
      // b's grid moved 3 texels east after the first step: its texel p is a's texel p + 3.
      b.step([], i === 0 ? 3 : 0, 0);
    }
    for (const [x, y] of [
      [30, 30],
      [34, 30],
      [30, 26],
      [27, 33],
    ] as const) {
      expect(b.at(x - 3, y)).toBeCloseTo(a.at(x, y), 5);
    }
  });
});

describe('fixed-step clock and field placement', () => {
  it('steps at WAVES.stepHz on the presentation clock, whatever the frame rate', () => {
    const clock = { steps: 0, simTime: 0 };
    let sim = 10;
    let total = 0;
    // 90 frames of 1/60 s, then 30 of 1/30 s: 1.5 s + 1 s = 2.5 s of waves.
    for (let i = 1; i <= 90; i++) {
      waveSteps(sim, 10 + i / 60, clock);
      sim = clock.simTime;
      total += clock.steps;
    }
    for (let i = 1; i <= 30; i++) {
      waveSteps(sim, 11.5 + i / 30, clock);
      sim = clock.simTime;
      total += clock.steps;
    }
    expect(total).toBe(Math.round(2.5 * WAVES.stepHz));
  });

  it('a frozen clock does not step; a hitch skips ahead after at most maxStepsPerFrame; a clock running back starts over', () => {
    const clock = { steps: 0, simTime: 0 };
    expect(waveSteps(5, 5, clock).steps).toBe(0);
    expect(waveSteps(5, 9, clock).steps).toBe(WAVES.maxStepsPerFrame);
    expect(clock.simTime).toBe(9);
    expect(waveSteps(9, 3, clock).steps).toBe(0);
    expect(clock.simTime).toBe(3);
  });

  it('the field lies on the texel grid of the world around the view', () => {
    const o = { x: 0, y: 0 };
    waveFieldOrigin(1001.4, -37.2, o);
    expect(Math.abs(o.x % WAVES.texelPx)).toBe(0);
    expect(Math.abs(o.y % WAVES.texelPx)).toBe(0);
    expect(o.x).toBeLessThanOrEqual(1001.4 - WAVES.marginPx);
    expect(o.x).toBeGreaterThan(1001.4 - WAVES.marginPx - WAVES.texelPx);
    expect(o.y).toBeLessThanOrEqual(-37.2 - WAVES.marginPx);
    expect(waveFieldTexels(482) * WAVES.texelPx).toBeGreaterThanOrEqual(482 + 2 * WAVES.marginPx);
  });
});
