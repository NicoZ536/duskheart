/**
 * Portable mathematics (ADR-0210, M7-76; docs/ARCHITEKTUR.md "Determinismus über JS-Engines"): sine, cosine, the natural
 * logarithm, e^x, 2^x and x^y built from the four basic operations, `Math.round`, `Math.abs` and exact bit operations
 * only, which IEEE 754 fixes to the bit – every engine gives the same bits.
 *
 * Why: ECMAScript leaves `Math.sin`, `Math.cos`, `Math.pow` (`**`), `Math.exp`, `Math.log` … "implementation-approximated".
 * Node 22 (V8 12.4) and Chromium 141 (V8 14.1) already differ in the last bit of `sin`, `cos` and `pow` for many
 * arguments (V8 moved its trigonometry to glibc's and changed `pow`). A simulation that calls them steps differently in the
 * browser than in the Node tests, and a recording or save replays differently in another engine. The simulation
 * (`src/engine`, `src/world`, `src/game`) therefore calls only these functions – `tools/forbidden.ts` refuses `Math.sin`,
 * `Math.cos`, `Math.pow` and `**` there – and the music's render path uses them too (`src/content/music/portableMath.ts`
 * re-exports them; synth, biquads, notation, wavetables).
 *
 * - `psin`, `pcos`: Cody–Waite reduction by π/2 (two-part constant, exact for |x| < 2^19 · π/2) and the minimax kernels of
 *   fdlibm (`__kernel_sin`, `__kernel_cos`, FreeBSD form) – within 1 ulp of the true value. Arguments beyond
 *   `PORTABLE_TRIG_MAX` (and NaN, ±∞) are an error: angles of the simulation are wrapped (facings in (−π, π]).
 * - `sinCosIn`: both at once for code that runs every tick or frame – the angle and the results travel through a
 *   `Float64Array` register, so no fractional number crosses the call (ADR-0274: a fraction passed to or returned from a
 *   call V8 does not inline is boxed). Bit for bit `psin` and `pcos` of the same angle.
 * - `plog`: fdlibm's `__ieee754_log` (e_log.c) – the algorithm of V8's own `Math.log`, so in Node the two agree to the bit
 *   (tests/unit/engine/portable-math.test.ts) – but now pinned for every engine.
 * - `pexp`: fdlibm's `__ieee754_exp` (e_exp.c), likewise V8's `Math.exp` algorithm.
 * - `pexp2`: 2^x as 2^k · e^(f · ln 2) with k = round(x), |f| ≤ ½: a degree-13 Taylor polynomial (remainder < 1e-17) and
 *   an exact power of two built from its bits; whole x give exact powers (A4 = 440 Hz, octaves exact).
 * - `ppow`: x^y for x ≥ 0 – whole exponents (|y| ≤ 1074) by repeated squaring of x (of 1/x for y < 0; exact while the
 *   powers are representable, `ppow(x, 2)` is `x * x`), other exponents as `pexp(y · plog(x))` (relative error
 *   ≈ |y · ln x| ulp).
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

/** Throws for an argument the reduction cannot keep exact (kept out of the callers' bodies: only reached on the error). */
function trigRangeError(x: number): never {
  throw new RangeError(`portable trig: argument ${x} outside ±${PORTABLE_TRIG_MAX}`);
}

/** Sine of `x` radians, the same bits on every engine (|x| ≤ `PORTABLE_TRIG_MAX`). */
export function psin(x: number): number {
  if (!(Math.abs(x) <= PORTABLE_TRIG_MAX)) trigRangeError(x);
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
  if (!(Math.abs(x) <= PORTABLE_TRIG_MAX)) trigRangeError(x);
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

/** Slots of a `sinCosIn` register: the angle in [radians] … */
export const SIN_COS_ANGLE = 0;
/** … its sine … */
export const SIN_COS_SIN = 1;
/** … and its cosine. */
export const SIN_COS_COS = 2;

/** A register for `sinCosIn` (three doubles: angle, sine, cosine). Hold one per module; read the results right away. */
export function createSinCosRegister(): Float64Array<ArrayBuffer> {
  return new Float64Array(3);
}

/**
 * Sine and cosine of the angle in `r[SIN_COS_ANGLE]` into `r[SIN_COS_SIN]` and `r[SIN_COS_COS]` – bit for bit `psin` and
 * `pcos`, one reduction for both. For code that runs every tick or frame: no fractional number crosses this call, and the
 * kernels are written out (no further call whose arguments V8 might box).
 */
export function sinCosIn(r: Float64Array): void {
  const x = r[SIN_COS_ANGLE] as number;
  if (!(Math.abs(x) <= PORTABLE_TRIG_MAX)) trigRangeError(x);
  const n = Math.round(x * INV_PIO2);
  const y = x - n * PIO2_HI - n * PIO2_LO;
  const z = y * y;
  // kernelSin(y)
  const v = z * y;
  const rs = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  const s = y + v * (S1 + z * rs);
  // kernelCos(y)
  const rc = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  const c = w + (1 - w - hz + z * rc);
  switch (n & 3) {
    case 0:
      r[SIN_COS_SIN] = s;
      r[SIN_COS_COS] = c;
      break;
    case 1:
      r[SIN_COS_SIN] = c;
      r[SIN_COS_COS] = -s;
      break;
    case 2:
      r[SIN_COS_SIN] = -s;
      r[SIN_COS_COS] = -c;
      break;
    default:
      r[SIN_COS_SIN] = -c;
      r[SIN_COS_COS] = s;
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Logarithm and exponentials
// ---------------------------------------------------------------------------------------------

/** The bits of one double (big-endian words: [0] high, [4] low). */
const bits = new DataView(new ArrayBuffer(8));

/** ln 2 in two parts (fdlibm `ln2_hi`, `ln2_lo`): k · LN2_HI is exact for |k| < 2^11. */
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
/** 2^54: scales a subnormal argument of `plog` into the normal range. */
const TWO54 = 1.8014398509481984e16;

/** Minimax coefficients of `plog` (fdlibm e_log.c, Lg1 … Lg7). */
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/**
 * Natural logarithm, the same bits on every engine: fdlibm's `__ieee754_log` (e_log.c), statement for statement. Like
 * `Math.log`: −∞ at ±0, NaN below zero and for NaN, +∞ at +∞.
 */
export function plog(x: number): number {
  bits.setFloat64(0, x);
  let hx = bits.getInt32(0);
  const lx = bits.getUint32(4);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^−1022: zero, negative or subnormal
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54;
    bits.setFloat64(0, x);
    hx = bits.getInt32(0);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  // Normalise x or x/2 into [√2/2, √2).
  bits.setInt32(0, hx | (i ^ 0x3ff00000));
  x = bits.getFloat64(0);
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    // −2^−20 ≤ f < 2^−20
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    // fdlibm writes the third as 0.33333333333333333, the same double as 0.3333333333333333.
    const r = f * f * (0.5 - 0.3333333333333333 * f);
    return k === 0 ? f - r : k * LN2_HI - (r - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  if (((hx - 0x6147a) | (0x6b851 - hx)) > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + r)) : k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - r) : k * LN2_HI - (s * (f - r) - k * LN2_LO - f);
}

/** Minimax coefficients of `pexp` (fdlibm e_exp.c, P1 … P5). */
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
/** Above this e^x overflows, below the next it underflows to zero. */
const EXP_OVERFLOW = 7.09782712893383973096e2;
const EXP_UNDERFLOW = -7.4513321910194110842e2;
/** 2^−1000 and 2^1023: scale results whose power of two lies outside the normal exponents. */
const TWO_M1000 = 9.33263618503218878990e-302;
const TWO_1023 = 8.988465674311579539e307;
/** e: fdlibm's polynomial misses the last bit of e^1, so V8 (and this function) return the constant. */
const EULER = 2.718281828459045;
/** Exponent `k` of 2^k at which `pexp` scales by 2^1023 twice. */
const EXP_K_MAX = 1024;
/** Lowest `k` whose 2^k is a normal double that `pexp` builds directly. */
const EXP_K_NORMAL = -1021;
/** Offset of the subnormal branch: 2^(k + 1000) · 2^−1000. */
const EXP_K_SUBNORMAL_SHIFT = 1000;

/** 2^k for a whole k with 2^k a normal double, from its exponent bits. */
function twoToThe(k: number): number {
  bits.setInt32(0, 0x3ff00000 + (k << 20));
  bits.setInt32(4, 0);
  return bits.getFloat64(0);
}

/**
 * e^x, the same bits on every engine: fdlibm's `__ieee754_exp` (e_exp.c) in the FreeBSD form V8 ships, statement for
 * statement (the exact e at 1, scaling by 2^k as a product). Like `Math.exp`: +∞ above ≈ 709.78, 0 below ≈ −745.13, NaN
 * for NaN.
 */
export function pexp(x: number): number {
  bits.setFloat64(0, x);
  const high = bits.getUint32(0);
  const negative = high >>> 31 === 1;
  const hx = high & 0x7fffffff;
  if (hx >= 0x40862e42) {
    // |x| ≥ 709.78…: NaN, ±∞, overflow or underflow
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | bits.getUint32(4)) !== 0) return x + x;
      return negative ? 0 : x;
    }
    if (x > EXP_OVERFLOW) return Infinity;
    if (x < EXP_UNDERFLOW) return 0;
  }
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    // |x| > ½ ln 2: x = k · ln 2 + r
    if (hx < 0x3ff0a2b2) {
      // and |x| < 1.5 ln 2
      if (x === 1) return EULER;
      hi = negative ? x + LN2_HI : x - LN2_HI;
      lo = negative ? -LN2_LO : LN2_LO;
      k = negative ? -1 : 1;
    } else {
      k = Math.trunc(INV_LN2 * x + (negative ? -0.5 : 0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^−28
    return 1 + x;
  }
  const t = x * x;
  const twopk = k >= EXP_K_NORMAL ? twoToThe(k === EXP_K_MAX ? 0 : k) : twoToThe(k + EXP_K_SUBNORMAL_SHIFT);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  if (k >= EXP_K_NORMAL) return k === EXP_K_MAX ? y * 2 * TWO_1023 : y * twopk;
  return y * twopk * TWO_M1000;
}

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
/** ln 2 as one double (the music's `pexp2`, whose bits are pinned). */
const LN2 = 6.93147180559945286227e-1;
/** Exponents whose power of two is a normal double. */
const EXP2_MIN = -1022;
const EXP2_MAX = 1023;

/** 2^k for a whole k in [−1022, 1023], exactly (built from its exponent bits). */
function pow2Int(k: number): number {
  bits.setUint32(0, ((k + 1023) << 20) >>> 0, false);
  bits.setUint32(4, 0, false);
  return bits.getFloat64(0, false);
}

/** 2^x, the same bits on every engine (x in [−1022, 1023]); whole x give exact powers of two. */
export function pexp2(x: number): number {
  const k = Math.round(x);
  if (!(k >= EXP2_MIN && k <= EXP2_MAX)) throw new RangeError(`portable exp2: exponent ${x} outside [${EXP2_MIN}, ${EXP2_MAX}]`);
  const t = (x - k) * LN2;
  const p = 1 + t * (1 + t * (I2 + t * (I3 + t * (I4 + t * (I5 + t * (I6 + t * (I7 + t * (I8 + t * (I9 + t * (I10 + t * (I11 + t * (I12 + t * I13))))))))))));
  return p * pow2Int(k);
}

/** Largest |y| `ppow` raises by repeated squaring: every power of two down to the smallest subnormal, 2^−1074, is exact. */
const POW_SQUARING_MAX = 1074;

/**
 * x^y for x ≥ 0, the same bits on every engine. Whole exponents with |y| ≤ 1074 multiply by repeated squaring of x, or of
 * 1/x for a negative y (exact while every power is representable – `ppow(x, 2)` is `x * x`, `ppow(2, k)` is 2^k down to
 * the subnormals); other exponents give `pexp(y · plog(x))`. 0^0 = 1, 0^y = 0 (y > 0) or +∞ (y < 0). A negative or NaN
 * base and a NaN exponent are an error.
 */
export function ppow(x: number, y: number): number {
  if (!(x >= 0) || Number.isNaN(y)) throw new RangeError(`portable pow: ${x}^${y} outside x ≥ 0`);
  if (Number.isInteger(y) && Math.abs(y) <= POW_SQUARING_MAX) {
    let e = Math.abs(y);
    let base = y < 0 ? 1 / x : x;
    let out = 1;
    while (e > 0) {
      if ((e & 1) === 1) out *= base;
      e >>>= 1;
      if (e > 0) base *= base;
    }
    return out;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  return pexp(y * plog(x));
}
