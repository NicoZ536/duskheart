/**
 * M7-76 portable mathematics (src/engine/portableMath.ts; ADR-0210): sine, cosine, logarithm, e^x, 2^x and x^y from the
 * four basic operations and exact bit operations – the same bits on every JS engine (tests/e2e/determinismus.spec.ts
 * compares the page with Node). Here, in Node:
 * - accuracy against the engine's functions (`portableMathSuite`, 5 000 samples per sweep; 1 000 000 in
 *   tests/integration/portable-mathe.test.ts): sine and cosine within 1 ulp on ±8π and 1,2e-16 absolute on the whole range,
 *   the logarithm and e^x within 1 ulp (fdlibm's algorithms, which V8 ships), 2^x within 2 ulp, x^y within ≈ |y · ln x| ulp;
 *   `sinCosIn` gives exactly the bits of `psin` and `pcos`;
 * - the edge values behave like the engine's (±∞, NaN, overflow, underflow, subnormals), whole exponents are exact, the
 *   range errors throw;
 * - the bits are pinned (a golden digest over a fixed grid): a changed constant or statement fails here; the music uses
 *   the same functions;
 * - the simulation's users keep their numbers: the XP table equals the one `Math.pow` gave before M7-76, the light
 *   flicker of any clock time stays in range, angle vectors are the portable cosine and sine.
 * M7-139: the arc tangent, tangent, arc sine and hypotenuse (`patan2`/`atan2In`, `ptan`/`tanIn`, `pasin`/`asinIn`,
 * `phypot`/`hypotIn`) – the edge values like the engine's, their bits pinned by a second golden digest, and their users
 * (`v2Angle`, `aimAngle`, the creatures' turn, the sun's shadow length, the magnet step, the interaction distances) give in
 * Node exactly the numbers `Math.atan2`, `Math.tan`, `Math.asin` and `Math.hypot` gave: V8 computes those with the same
 * algorithms, so saves, snapshots and hashes did not move.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { pcos as musicCos, pexp2 as musicExp2, psin as musicSin } from '../../../src/content/music/portableMath';
import { SEASON_IDS } from '../../../src/content/balance';
import { lightFlicker } from '../../../src/engine/lightFalloff';
import { v2Angle, v2FromAngle, v2Rotate, vec2 } from '../../../src/engine/math';
import {
  createAsinRegister,
  createAtan2Register,
  createHypotRegister,
  createSinCosRegister,
  createTanRegister,
  pasin,
  patan2,
  pcos,
  pexp,
  pexp2,
  phypot,
  plog,
  ppow,
  psin,
  ptan,
  PORTABLE_TRIG_MAX,
  SIN_COS_ANGLE,
  SIN_COS_COS,
  SIN_COS_SIN,
  sinCosIn,
  TAN_ANGLE,
  tanIn,
} from '../../../src/engine/portableMath';
import { aimAngle } from '../../../src/game/combat/formulas';
import { TURN_PER_TICK, turnBodyTowards, TurnDirection, turnTowards } from '../../../src/game/creatures/formulas';
import { magnetStep } from '../../../src/game/drops/formulas';
import { distanceToRect, FACING_BONUS_PX, targetScore } from '../../../src/game/interaction/formulas';
import { xpToNextLevel } from '../../../src/game/skills/formulas';
import { createShadowVector, sunShadowAt } from '../../../src/world/calendar';
import { portableMathSuite, stream } from './portable-math-pruefungen';

/** The golden digest of every portable function over the grid of `digest()` (any change of their bits must be deliberate). */
const GOLDEN = '941079ce';

function digest(): string {
  const bits = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    bits.setFloat64(0, v);
    for (let j = 0; j < 8; j++) {
      h ^= bits.getUint8(j);
      h = Math.imul(h, 0x01000193);
    }
  };
  const reg = createSinCosRegister();
  for (let i = 0; i < 4000; i++) {
    const x = (i - 2000) * 0.0173 + Math.sqrt(i) * 1e-4;
    mix(psin(x));
    mix(pcos(x));
    reg[SIN_COS_ANGLE] = x * 97;
    sinCosIn(reg);
    mix(reg[SIN_COS_SIN] as number);
    mix(reg[SIN_COS_COS] as number);
    mix(plog(1e-300 + i * 2.5e-3 + i * i * 1e3));
    mix(pexp((i - 2000) * 0.35));
    mix(pexp2((i - 2000) * 0.5 + 1e-3 * i));
    mix(ppow(i * 0.25, (i % 17) - 8 + (i % 3) * 0.3));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The golden digest of the M7-139 functions over the grid of `digestM7139()` (the same in Node and JavaScriptCore). */
const GOLDEN_M7_139 = '4cb07944';

function digestM7139(): string {
  const bits = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    bits.setFloat64(0, v);
    for (let j = 0; j < 8; j++) {
      h ^= bits.getUint8(j);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (let i = 0; i < 4000; i++) {
    const x = (i - 2000) * 0.0173 + Math.sqrt(i) * 1e-4;
    mix(ptan(x));
    mix(ptan(x * 97));
    mix(patan2(x, (i % 97) - 48));
    mix(patan2((i % 13) - 6, x * 1e-3));
    mix(pasin((i - 2000) / 2000.5));
    mix(phypot(x * 1e3, (i % 89) - 44));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

portableMathSuite(1);

describe('Portable Mathematik: Sonderwerte, ganze Exponenten, festgeschriebene Bits (M7-76)', () => {
  it('Sinus und Kosinus an markanten Stellen; außerhalb ±PORTABLE_TRIG_MAX, ±∞ und NaN ein Fehler', () => {
    expect(psin(0)).toBe(0);
    // The sign of a zero is not kept (−0 gives +0): no simulation value depends on it.
    expect(psin(-0)).toBe(0);
    expect(pcos(0)).toBe(1);
    expect(psin(Math.PI / 2)).toBe(1);
    expect(pcos(Math.PI)).toBe(-1);
    const reg = createSinCosRegister();
    expect(reg).toHaveLength(3);
    for (const bad of [PORTABLE_TRIG_MAX * 1.0000001, -PORTABLE_TRIG_MAX * 2, Infinity, -Infinity, NaN]) {
      expect(() => psin(bad), String(bad)).toThrow(RangeError);
      expect(() => pcos(bad), String(bad)).toThrow(RangeError);
      reg[SIN_COS_ANGLE] = bad;
      expect(() => sinCosIn(reg), String(bad)).toThrow(RangeError);
    }
  });

  it('Logarithmus und e^x: Sonderwerte wie Math.log und Math.exp', () => {
    for (const x of [0, -0, -1, -Infinity, Infinity, NaN, 1, 2, Math.E, 5e-324, 2.2250738585072014e-308, Number.MAX_VALUE, 1 + 1e-12, 1 - 1e-12]) expect(plog(x), String(x)).toBe(Math.log(x));
    for (const x of [0, -0, 1, -1, Infinity, -Infinity, NaN, 709.78, 709.79, -745.13, -745.2, 1e-30, -1e-30, -708.4, -720]) expect(pexp(x), String(x)).toBe(Math.exp(x));
  });

  it('2^x und x^y: ganze Exponenten exakt (bis in die Subnormalen), Grenzen und Fehler', () => {
    for (let k = -1022; k <= 1023; k++) expect(pexp2(k)).toBe(2 ** k);
    expect(() => pexp2(1024)).toThrow(RangeError);
    expect(() => pexp2(-1023)).toThrow(RangeError);
    for (let k = 0; k <= 30; k++) expect(ppow(3, k)).toBe(3 ** k);
    for (let k = -1074; k <= 1023; k++) expect(ppow(2, k)).toBe(2 ** k);
    expect(ppow(0, 0)).toBe(1);
    expect(ppow(0, 1.5)).toBe(0);
    expect(ppow(0, -1.5)).toBe(Infinity);
    expect(ppow(0, -2)).toBe(Infinity);
    for (const [x, y] of [
      [-1, 2],
      [-0.5, 0.5],
      [NaN, 2],
      [2, NaN],
    ] as const)
      expect(() => ppow(x, y), `${x}^${y}`).toThrow(RangeError);
  });

  it('die Bits sind festgeschrieben (Golden-Digest) und die Musik nutzt dieselben Funktionen', () => {
    expect(digest()).toBe(GOLDEN);
    expect(musicSin).toBe(psin);
    expect(musicCos).toBe(pcos);
    expect(musicExp2).toBe(pexp2);
  });
});

describe('Arkustangens, Tangens, Arkussinus und Hypotenuse: Sonderwerte und festgeschriebene Bits (M7-139)', () => {
  const SPECIAL = [0, -0, 1, -1, 0.5, -0.5, 2, -3, Infinity, -Infinity, NaN, 5e-324, -5e-324, 2.2250738585072014e-308, Number.MAX_VALUE, -Number.MAX_VALUE, Math.PI, Math.PI / 2, 2 ** 61, 2 ** -61, 2 ** 66];

  it('atan2 und hypot: jedes Paar von Sonderwerten wie die Engine (Vorzeichen der Null, ±∞, NaN, Über- und Unterlauf)', () => {
    for (const y of SPECIAL) {
      for (const x of SPECIAL) {
        expect(Object.is(patan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`).toBe(true);
        expect(Object.is(phypot(x, y), Math.hypot(x, y)), `hypot(${x}, ${y})`).toBe(true);
      }
    }
    expect(patan2(0, -1)).toBe(Math.PI);
    expect(patan2(-0, -1)).toBe(-Math.PI);
    expect(phypot(3, 4)).toBe(5);
    expect(phypot(NaN, Infinity)).toBe(Infinity);
  });

  it('tan und asin: Sonderwerte wie die Engine; tan außerhalb ±PORTABLE_TRIG_MAX, bei ±∞ und NaN ein Fehler', () => {
    for (const x of SPECIAL) {
      expect(Object.is(pasin(x), Math.asin(x)), `asin(${x})`).toBe(true);
      if (Math.abs(x) <= PORTABLE_TRIG_MAX) expect(Object.is(ptan(x), Math.tan(x)), `tan(${x})`).toBe(true);
    }
    expect(pasin(1)).toBe(Math.PI / 2);
    expect(pasin(-1)).toBe(-Math.PI / 2);
    expect(pasin(1 + 2 ** -52)).toBeNaN();
    expect(Object.is(ptan(-0), -0)).toBe(true);
    const reg = createTanRegister();
    expect(reg).toHaveLength(2);
    expect(createAtan2Register()).toHaveLength(3);
    expect(createAsinRegister()).toHaveLength(2);
    expect(createHypotRegister()).toHaveLength(3);
    for (const bad of [PORTABLE_TRIG_MAX * 1.0000001, -PORTABLE_TRIG_MAX * 2, Infinity, -Infinity, NaN]) {
      expect(() => ptan(bad), String(bad)).toThrow(RangeError);
      reg[TAN_ANGLE] = bad;
      expect(() => tanIn(reg), String(bad)).toThrow(RangeError);
    }
  });

  it('die Bits sind festgeschrieben (Golden-Digest, in Node und JavaScriptCore derselbe)', () => {
    expect(digestM7139()).toBe(GOLDEN_M7_139);
  });
});

describe('Nutzer der portablen Mathematik in der Simulation (M7-76)', () => {
  it('die Erfahrungstabelle ist die von Math.pow vor M7-76 (gerundet), Stufe für Stufe', () => {
    const K = BALANCE.skills;
    for (let level = K.minLevel; level < K.maxLevel; level++) expect(xpToNextLevel(level), String(level)).toBe(Math.round(K.xpFactor * Math.pow(level, K.xpExponent)));
  });

  it('Winkelvektoren sind portabler Kosinus und Sinus; Flackern jeder Uhrzeit bleibt im Bereich', () => {
    const v = vec2();
    const r = stream(67);
    for (let i = 0; i < 1000; i++) {
      const a = (r() * 2 - 1) * Math.PI;
      const len = r() * 10;
      v2FromAngle(v, a, len);
      expect(v.x).toBe(pcos(a) * len);
      expect(v.y).toBe(psin(a) * len);
      const w = vec2(3, -2);
      v2Rotate(w, w, a);
      expect(w.x).toBe(3 * pcos(a) - -2 * psin(a));
      expect(w.y).toBe(3 * psin(a) + -2 * pcos(a));
    }
    // Up to decades of clock time: the flicker's phases are reduced by a full turn before the sine (no range error).
    for (const t of [0, 1.5, 3600, 86_400, 31_536_000, 1e9]) {
      const f = lightFlicker(0.3, 4.2, t);
      expect(f, String(t)).toBeGreaterThanOrEqual(0.7);
      expect(f, String(t)).toBeLessThanOrEqual(1);
    }
  });

  it('Winkel, Schattenlänge, Magnet und Abstände geben in Node genau die Zahlen von Math.atan2/tan/hypot (M7-139)', () => {
    const r = stream(79);
    const body = { facing: 0 };
    const dir = new TurnDirection();
    const p = { x: 0, y: 0 };
    for (let i = 0; i < 2000; i++) {
      const dx = (r() * 2 - 1) * 400;
      const dy = (r() * 2 - 1) * 400;
      expect(aimAngle(dx, dy)).toBe(Math.atan2(dy, dx));
      expect(v2Angle(vec2(dx, dy))).toBe(Math.atan2(dy, dx));
      // The creature's turn: the step `turnTowards` takes towards `Math.atan2`'s angle.
      const facing = (r() * 2 - 1) * Math.PI;
      body.facing = facing;
      dir.x = dx;
      dir.y = dy;
      turnBodyTowards(body, dir);
      expect(body.facing).toBe(turnTowards(facing, Math.atan2(dy, dx), TURN_PER_TICK));
      // Magnet step and the interaction's distances: the length is `Math.hypot`'s.
      p.x = 0;
      p.y = 0;
      const step = r() * 50;
      const d = Math.hypot(dx, dy);
      expect(magnetStep(p, dx, dy, step)).toBe(d <= step ? 0 : d - step);
      const rx = dx < -10 ? -10 - dx : dx > 10 ? dx - 10 : 0;
      const ry = dy < -10 ? -10 - dy : dy > 10 ? dy - 10 : 0;
      expect(distanceToRect(dx, dy, -10, -10, 10, 10)).toBe(Math.hypot(rx, ry));
      expect(targetScore(d, 1, 0, dx, dy)).toBe(d - FACING_BONUS_PX * (d > 0 ? Math.max(0, dx / d) : 1));
    }
    // `aimAngle` keeps the last direction's angle: repeats, alternating signs of zero (±π on the negative axis, ±0 on the
    // positive one) and NaN give exactly `Math.atan2`'s angle every time.
    const directions: ReadonlyArray<readonly [number, number]> = [[-1, 0], [-1, -0], [-1, -0], [-1, 0], [0, 0], [-0, 0], [0, -0], [-0, -0], [-0, -0], [3, 4], [3, 4], [NaN, 1], [NaN, 1], [3, 4]];
    for (const [dx, dy] of directions) expect(Object.is(aimAngle(dx, dy), Math.atan2(dy, dx)), `${dx}, ${dy}`).toBe(true);
    // The sun's shadow: 1 / tan(elevation), as `Math.tan` gave it, every quarter hour of every season.
    const shadow = createShadowVector();
    for (const season of SEASON_IDS) {
      for (let q = 0; q < 96; q++) {
        sunShadowAt(season, q / 4, shadow);
        const elevation = shadow.elevationDeg;
        const max = BALANCE.calendar.maxShadowLength;
        expect(shadow.length, `${season} ${q / 4}`).toBe(elevation > 0 ? Math.min(max, 1 / Math.tan(elevation * (Math.PI / 180))) : max);
      }
    }
  });
});
