/**
 * Portable sine, cosine and powers of two for the music (docs/SPIEL.md §28 "Musik-Rendering: Node und Worker bitgleich";
 * ADR draft "OfflineAudioContext → eigener Synth im Worker"): built from the four basic operations and `Math.round` only,
 * which IEEE 754 fixes to the bit, so every engine gives the same bits.
 *
 * Why: `Math.sin`, `Math.cos` and `Math.pow` (`**`) are not the same function everywhere – Node 22 (V8 12.4) and Chromium
 * 141 (V8 14.1) differ in the last bit for many arguments (V8 switched its trigonometry and `pow` implementations), so a
 * piece rendered in the browser's music worker would not be the piece the Node tests checked. Every transcendental value
 * on the music's render path (the synth's sine table, note frequencies, envelope coefficients, pan, the chorus detune, the
 * biquad coefficients, the content's wavetables) comes from here.
 *
 * - `psin`, `pcos`: Cody–Waite reduction by π/2 (two-part constant, exact for |x| < 2^19 · π/2) and the minimax kernels of
 *   fdlibm (`__kernel_sin`, `__kernel_cos`, FreeBSD form) – within 1 ulp of the true value on the music's arguments.
 * - `pexp2`: 2^x as 2^k · e^(f · ln 2) with k = round(x), |f| ≤ ½: a degree-13 Taylor polynomial (remainder < 1e-17) and an
 *   exact power of two built from its bits; whole x give exact powers (A4 = 440 Hz, octaves exact).
 */

const INV_PIO2 = 6.36619772367581382433e-1;
/** The first 33 bits of π/2: n · PIO2_HI is exact for |n| < 2^20. */
const PIO2_HI = 1.57079632673412561417;
/** π/2 − PIO2_HI. */
const PIO2_LO = 6.07710050650619224932e-11;
/** Largest |x| the reduction keeps exact: 2^19 · π/2 [radians]. */
export const PORTABLE_TRIG_MAX = 524288 * 1.5707963267948966;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4]. */
function kernelSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos on [−π/4, π/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

function checkRange(x: number): void {
  if (!(Math.abs(x) <= PORTABLE_TRIG_MAX)) throw new RangeError(`portable trig: argument ${x} outside ±${PORTABLE_TRIG_MAX}`);
}

/** Sine of `x` radians, the same bits on every engine (|x| ≤ `PORTABLE_TRIG_MAX`). */
export function psin(x: number): number {
  checkRange(x);
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_HI - n * PIO2_LO;
  switch (n & 3) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

/** Cosine of `x` radians, the same bits on every engine (|x| ≤ `PORTABLE_TRIG_MAX`). */
export function pcos(x: number): number {
  checkRange(x);
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_HI - n * PIO2_LO;
  switch (n & 3) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}

const LN2 = 6.93147180559945286227e-1;
/** 1 / k! for k = 2 … 13. */
const INV_FACT = [1 / 2, 1 / 6, 1 / 24, 1 / 120, 1 / 720, 1 / 5040, 1 / 40320, 1 / 362880, 1 / 3628800, 1 / 39916800, 1 / 479001600, 1 / 6227020800] as const;
const I2 = INV_FACT[0];
const I3 = INV_FACT[1];
const I4 = INV_FACT[2];
const I5 = INV_FACT[3];
const I6 = INV_FACT[4];
const I7 = INV_FACT[5];
const I8 = INV_FACT[6];
const I9 = INV_FACT[7];
const I10 = INV_FACT[8];
const I11 = INV_FACT[9];
const I12 = INV_FACT[10];
const I13 = INV_FACT[11];
/** Exponents whose power of two is a normal double. */
const EXP2_MIN = -1022;
const EXP2_MAX = 1023;

const bits = new DataView(new ArrayBuffer(8));

/** 2^k for a whole k in [−1022, 1023], exactly (built from its exponent bits). */
function pow2Int(k: number): number {
  bits.setUint32(0, ((k + 1023) << 20) >>> 0, false);
  bits.setUint32(4, 0, false);
  return bits.getFloat64(0, false);
}

/** 2^x, the same bits on every engine (x in [−1022, 1023]). */
export function pexp2(x: number): number {
  const k = Math.round(x);
  if (!(k >= EXP2_MIN && k <= EXP2_MAX)) throw new RangeError(`portable exp2: exponent ${x} outside [${EXP2_MIN}, ${EXP2_MAX}]`);
  const t = (x - k) * LN2;
  const p = 1 + t * (1 + t * (I2 + t * (I3 + t * (I4 + t * (I5 + t * (I6 + t * (I7 + t * (I8 + t * (I9 + t * (I10 + t * (I11 + t * (I12 + t * I13))))))))))));
  return p * pow2Int(k);
}
