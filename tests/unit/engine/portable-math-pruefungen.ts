/**
 * The accuracy checks of the portable mathematics (src/engine/portableMath.ts, M7-76) as one suite with a sample scale:
 * tests/unit/engine/portable-math.test.ts runs it small (fast), tests/integration/portable-mathe.test.ts 200 times larger.
 * Arguments come from xorshift32 streams, so every run checks the same numbers.
 */
import { describe, expect, it } from 'vitest';
import { createSinCosRegister, pcos, pexp, pexp2, plog, ppow, psin, PORTABLE_TRIG_MAX, SIN_COS_ANGLE, SIN_COS_COS, SIN_COS_SIN, sinCosIn } from '../../../src/engine/portableMath';

const bits = new DataView(new ArrayBuffer(8));

/** Position of a double on the line of doubles (adjacent doubles differ by 1). */
function ordinal(v: number): bigint {
  bits.setFloat64(0, v);
  const b = bits.getBigInt64(0);
  return b < 0n ? -(b & 0x7fffffffffffffffn) : b;
}

/** Distance of two doubles in units in the last place. */
export function ulps(a: number, b: number): number {
  const d = ordinal(a) - ordinal(b);
  return Number(d < 0n ? -d : d);
}

/** xorshift32 in [0, 1): the same argument stream in every run. */
export function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** A positive finite double of any exponent (normal or subnormal) from random bits. */
function anyPositive(r: () => number): number {
  bits.setUint32(0, Math.floor(r() * 0x7ff00000));
  bits.setUint32(4, Math.floor(r() * 4294967296));
  return bits.getFloat64(0);
}

/** Samples of each sweep at scale 1. */
const BASE = 5_000;

/** Registers the accuracy checks with `scale` × 5 000 samples per sweep. */
export function portableMathSuite(scale: number): void {
  const n = BASE * scale;
  describe(`Portable Mathematik: Genauigkeit (${n} Stichproben je Prüfung)`, () => {
    it('Sinus und Kosinus: ≤ 1 ulp auf ±8π, ≤ 1,2e-16 absolut bis PORTABLE_TRIG_MAX, ungerade/gerade', () => {
      const r = stream(11);
      let small = 0;
      let wide = 0;
      for (let i = 0; i < n; i++) {
        const x = (r() * 2 - 1) * 8 * Math.PI;
        small = Math.max(small, ulps(psin(x), Math.sin(x)), ulps(pcos(x), Math.cos(x)));
        if (psin(-x) !== -psin(x) || pcos(-x) !== pcos(x)) throw new Error(`Symmetrie verletzt bei ${x}`);
        const y = (r() * 2 - 1) * PORTABLE_TRIG_MAX;
        wide = Math.max(wide, Math.abs(psin(y) - Math.sin(y)), Math.abs(pcos(y) - Math.cos(y)));
      }
      expect(small).toBeLessThanOrEqual(1);
      expect(wide).toBeLessThanOrEqual(1.2e-16);
    });

    it('sinCosIn: genau die Bits von psin und pcos, in allen vier Quadranten und an ihren Grenzen', () => {
      const reg = createSinCosRegister();
      const r = stream(23);
      let differ = 0;
      for (let i = 0; i < n; i++) {
        // Whole multiples of π/4 nudged by a few ulps (the quadrant borders), and random angles.
        const x = i % 2 === 0 ? (r() * 2 - 1) * 64 * Math.PI : ((i % 64) - 32) * (Math.PI / 4) * (1 + (r() - 0.5) * 1e-15);
        reg[SIN_COS_ANGLE] = x;
        sinCosIn(reg);
        if (reg[SIN_COS_SIN] !== psin(x) || reg[SIN_COS_COS] !== pcos(x) || reg[SIN_COS_ANGLE] !== x) differ++;
      }
      expect(differ).toBe(0);
    });

    it('Logarithmus und e^x: ≤ 1 ulp gegen die Engine über alle Exponenten', () => {
      const r = stream(37);
      let log = 0;
      let exp = 0;
      for (let i = 0; i < n; i++) {
        const x = anyPositive(r);
        log = Math.max(log, ulps(plog(x), Math.log(x)));
        const e = (r() * 2 - 1) * 750;
        const want = Math.exp(e);
        if (want > 0 && Number.isFinite(want)) exp = Math.max(exp, ulps(pexp(e), want));
        else expect(pexp(e)).toBe(want);
      }
      expect(log).toBeLessThanOrEqual(1);
      expect(exp).toBeLessThanOrEqual(1);
    });

    it('2^x: ≤ 2 ulp gegen die Engine', () => {
      const r = stream(41);
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const x = (r() * 2 - 1) * 1000;
        worst = Math.max(worst, ulps(pexp2(x), 2 ** x));
      }
      expect(worst).toBeLessThanOrEqual(2);
    });

    it('x^y: ganze Exponenten als Produkt (x², x¹, x⁰), sonst ≤ 1 + 2 · max(1, |y · ln x|) ulp', () => {
      const r = stream(53);
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const v = r() * 1e6;
        if (ppow(v, 2) !== v * v || ppow(v, 1) !== v || ppow(v, 0) !== 1) throw new Error(`ganzer Exponent falsch bei ${v}`);
        const x = r() * 1000;
        const y = (r() - 0.5) * 16;
        const want = Math.pow(x, y);
        if (!(want > 0) || !Number.isFinite(want)) continue;
        worst = Math.max(worst, ulps(ppow(x, y), want) / (1 + 2 * Math.max(1, Math.abs(y * Math.log(x)))));
      }
      expect(worst).toBeLessThanOrEqual(1);
    });
  });
}
