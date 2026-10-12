/**
 * Portable mathematics (ADR-0210, M7-76, M7-139; docs/ARCHITEKTUR.md "Determinismus über JS-Engines"): sine, cosine,
 * tangent, arc tangent, arc sine, the hypotenuse, the natural logarithm, e^x, 2^x and x^y built from the four basic
 * operations, `Math.sqrt` (correctly rounded by IEEE 754), `Math.round`, `Math.trunc`, `Math.abs` and exact bit operations
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
 * - `patan2` / `atan2In`, `ptan` / `tanIn`, `pasin` / `asinIn`: fdlibm's `__ieee754_atan2`, `tan` (with `__ieee754_rem_pio2` and
 *   `__kernel_tan`) and `__ieee754_asin` – V8's own algorithms, so in Node they agree with `Math.atan2`, `Math.tan` and
 *   `Math.asin` to the bit (the simulation's numbers did not move when it switched, M7-139); JavaScriptCore and
 *   SpiderMonkey compute those differently.
 * - `phypot` / `hypotIn`: V8's `Math.hypot` for two legs (divide by the larger leg, root of the sum of squares, times the
 *   larger leg), likewise bit-identical with Node's `Math.hypot`.
 * - The `…In` forms take their arguments from and leave their result in a `Float64Array` register (`create…Register`) for
 *   code that runs every tick or frame; the plain forms are for cold code.
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

// ---------------------------------------------------------------------------------------------
// Arc tangent, tangent, arc sine and the hypotenuse (M7-139)
// ---------------------------------------------------------------------------------------------

/** atan(½), atan(1), atan(3/2), atan(∞) in two parts each (fdlibm s_atan.c `atanhi`, `atanlo`). */
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558e0] as const;
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17] as const;
/** Minimax coefficients of the arc tangent (fdlibm s_atan.c, aT[0] … aT[10]). */
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.1111110405462355788e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.6531572744216915527e-2;
const AT10 = 1.62858201153657823623e-2;
/** π/4, π/2, π and the bits of π beyond the double (fdlibm e_atan2.c). */
const PI_O_4 = 7.85398163397448279e-1;
const PI_O_2 = 1.570796326794896558e0;
const PI = 3.141592653589793116e0;
const PI_LO = 1.2246467991473531772e-16;

/** Slots of an `atan2In` register: y and x of the point … */
export const ATAN2_Y = 0;
export const ATAN2_X = 1;
/** … and the angle of (x, y) in [−π, π] [radians]. */
export const ATAN2_ANGLE = 2;

/** A register for `atan2In` (three doubles: y, x, angle). Hold one per module; read the result right away. */
export function createAtan2Register(): Float64Array<ArrayBuffer> {
  return new Float64Array(3);
}

/**
 * `Math.atan2(r[ATAN2_Y], r[ATAN2_X])` into `r[ATAN2_ANGLE]`, the same bits on every engine: fdlibm's `__ieee754_atan2`
 * (e_atan2.c) with the arc tangent of s_atan.c written out, statement for statement – the algorithm of V8's own
 * `Math.atan2`, so in V8 the two agree to the bit. For code that runs every tick or frame: no fractional number crosses
 * this call. Special values like `Math.atan2` (±0, ±∞, NaN).
 */
export function atan2In(r: Float64Array): void {
  const y = r[ATAN2_Y] as number;
  const x = r[ATAN2_X] as number;
  if (x !== x || y !== y) {
    r[ATAN2_ANGLE] = x + y;
    return;
  }
  bits.setFloat64(0, x);
  const hx = bits.getInt32(0);
  const ix = hx & 0x7fffffff;
  bits.setFloat64(0, y);
  const hy = bits.getInt32(0);
  const iy = hy & 0x7fffffff;
  // The argument of the arc tangent, and whether its result is the answer (x = 1) or still needs the quadrant.
  let t: number;
  let direct = false;
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  let z = 0;
  let reduced = false;
  if (x === 1) {
    t = y;
    direct = true;
  } else {
    if (y === 0) {
      r[ATAN2_ANGLE] = m < 2 ? y : m === 2 ? PI : -PI;
      return;
    }
    if (x === 0) {
      r[ATAN2_ANGLE] = hy < 0 ? -PI_O_2 : PI_O_2;
      return;
    }
    if (ix === 0x7ff00000) {
      if (iy === 0x7ff00000) r[ATAN2_ANGLE] = m === 0 ? PI_O_4 : m === 1 ? -PI_O_4 : m === 2 ? 3 * PI_O_4 : -3 * PI_O_4;
      else r[ATAN2_ANGLE] = m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI : -PI;
      return;
    }
    if (iy === 0x7ff00000) {
      r[ATAN2_ANGLE] = hy < 0 ? -PI_O_2 : PI_O_2;
      return;
    }
    const k = (iy - ix) >> 20;
    t = 0;
    if (k > 60) {
      // |y/x| > 2^60
      z = PI_O_2 + 0.5 * PI_LO;
      m &= 1;
      reduced = true;
    } else if (hx < 0 && k < -60) {
      // 0 > |y|/x > −2^−60
      z = 0;
      reduced = true;
    } else t = Math.abs(y / x);
  }
  if (!reduced) {
    // z = atan(t): fdlibm s_atan.c.
    bits.setFloat64(0, t);
    const ht = bits.getInt32(0);
    const it = ht & 0x7fffffff;
    if (it >= 0x44100000) {
      // |t| ≥ 2^66
      z = ht > 0 ? (ATAN_HI[3] as number) + (ATAN_LO[3] as number) : -(ATAN_HI[3] as number) - (ATAN_LO[3] as number);
    } else if (it < 0x3e400000) {
      // |t| < 2^−27
      z = t;
    } else {
      let id = -1;
      if (it >= 0x3fdc0000) {
        // |t| ≥ 0.4375
        t = Math.abs(t);
        if (it < 0x3ff30000) {
          if (it < 0x3fe60000) {
            id = 0;
            t = (2 * t - 1) / (2 + t);
          } else {
            id = 1;
            t = (t - 1) / (t + 1);
          }
        } else if (it < 0x40038000) {
          id = 2;
          t = (t - 1.5) / (1 + 1.5 * t);
        } else {
          id = 3;
          t = -1 / t;
        }
      }
      const zz = t * t;
      const w = zz * zz;
      const s1 = zz * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
      const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
      if (id < 0) z = t - t * (s1 + s2);
      else {
        const a = (ATAN_HI[id] as number) - ((t * (s1 + s2) - (ATAN_LO[id] as number)) - t);
        z = ht < 0 ? -a : a;
      }
    }
  }
  if (direct) {
    r[ATAN2_ANGLE] = z;
    return;
  }
  switch (m) {
    case 0:
      r[ATAN2_ANGLE] = z;
      break;
    case 1:
      r[ATAN2_ANGLE] = -z;
      break;
    case 2:
      r[ATAN2_ANGLE] = PI - (z - PI_LO);
      break;
    default:
      r[ATAN2_ANGLE] = z - PI_LO - PI;
      break;
  }
}

const ATAN2_REGISTER = createAtan2Register();

/** `Math.atan2(y, x)` with the same bits on every engine (bit for bit `atan2In`), for code outside the per-tick paths. */
export function patan2(y: number, x: number): number {
  ATAN2_REGISTER[ATAN2_Y] = y;
  ATAN2_REGISTER[ATAN2_X] = x;
  atan2In(ATAN2_REGISTER);
  return ATAN2_REGISTER[ATAN2_ANGLE] as number;
}

/** π/2 in three parts of 33 bits plus tails (fdlibm e_rem_pio2.c `pio2_1` … `pio2_3t`). */
const RP_PIO2_1 = 1.57079632673412561417;
const RP_PIO2_1T = 6.07710050650619224932e-11;
const RP_PIO2_2 = 6.0771005063039659766e-11;
const RP_PIO2_2T = 2.02226624879595063154e-21;
const RP_PIO2_3 = 2.0222662487111664558e-21;
const RP_PIO2_3T = 8.47842766036889956997e-32;
const RP_INV_PIO2 = 6.36619772367581382433e-1;
/** High words of n · π/2 for n = 1 … 32 (fdlibm `npio2_hw`): a reduction near them checks for cancellation. */
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb,
  0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb,
  0x404858eb, 0x404921fb,
] as const;
/** Coefficients of the tangent on [0, π/4] (fdlibm k_tan.c, T[0] … T[12]), π/4 and its tail. */
const T0 = 3.33333333333334091986e-1;
const T1 = 1.33333333333201242699e-1;
const T2 = 5.39682539762260521377e-2;
const T3 = 2.18694882948595424599e-2;
const T4 = 8.86323982359930005737e-3;
const T5 = 3.59207910759131235356e-3;
const T6 = 1.45620945432529025516e-3;
const T7 = 5.88041240820264096874e-4;
const T8 = 2.46463134818469906812e-4;
const T9 = 7.817944429395570923e-5;
const T10 = 7.14072491382608190305e-5;
const T11 = -1.85586374855275456654e-5;
const T12 = 2.59073051863633712884e-5;
const PIO4 = 7.85398163397448278999e-1;
const PIO4_LO = 3.06161699786838301793e-17;

/** Slots of a `tanIn` register: the angle [radians] … */
export const TAN_ANGLE = 0;
/** … and its tangent. */
export const TAN_VALUE = 1;

/** A register for `tanIn` (two doubles: angle, tangent). Hold one per module; read the result right away. */
export function createTanRegister(): Float64Array<ArrayBuffer> {
  return new Float64Array(2);
}

/**
 * `Math.tan(r[TAN_ANGLE])` into `r[TAN_VALUE]`, the same bits on every engine: fdlibm's `tan` (s_tan.c) with the
 * reduction `__ieee754_rem_pio2` (e_rem_pio2.c, up to three steps of a 33 + 33 + 33 + 53-bit π/2) and `__kernel_tan`
 * (k_tan.c, 2004) written out, statement for statement – V8's own algorithm, so in V8 the two agree to the bit. For code
 * that runs every tick or frame: no fractional number crosses this call. |angle| ≤ `PORTABLE_TRIG_MAX` (the reduction of
 * larger angles is not ported); NaN, ±∞ and larger angles are an error.
 */
export function tanIn(r: Float64Array): void {
  const x0 = r[TAN_ANGLE] as number;
  if (!(Math.abs(x0) <= PORTABLE_TRIG_MAX)) trigRangeError(x0);
  bits.setFloat64(0, x0);
  const hx0 = bits.getInt32(0);
  const ix0 = hx0 & 0x7fffffff;
  // __ieee754_rem_pio2: x0 = n · π/2 + (y0 + y1).
  let y0: number;
  let y1: number;
  let n: number;
  if (ix0 <= 0x3fe921fb) {
    // |x| ≤ π/4: no reduction
    y0 = x0;
    y1 = 0;
    n = 0;
  } else if (ix0 < 0x4002d97c) {
    // |x| < 3π/4: n = ±1
    if (hx0 > 0) {
      let z = x0 - RP_PIO2_1;
      if (ix0 !== 0x3ff921fb) {
        y0 = z - RP_PIO2_1T;
        y1 = z - y0 - RP_PIO2_1T;
      } else {
        // near π/2: 33 + 33 + 53 bits of π/2
        z -= RP_PIO2_2;
        y0 = z - RP_PIO2_2T;
        y1 = z - y0 - RP_PIO2_2T;
      }
      n = 1;
    } else {
      let z = x0 + RP_PIO2_1;
      if (ix0 !== 0x3ff921fb) {
        y0 = z + RP_PIO2_1T;
        y1 = z - y0 + RP_PIO2_1T;
      } else {
        z += RP_PIO2_2;
        y0 = z + RP_PIO2_2T;
        y1 = z - y0 + RP_PIO2_2T;
      }
      n = -1;
    }
  } else {
    // medium size: |x| ≤ 2^19 · π/2
    let t = Math.abs(x0);
    n = Math.trunc(t * RP_INV_PIO2 + 0.5);
    const fn = n;
    let rr = t - fn * RP_PIO2_1;
    let w = fn * RP_PIO2_1T;
    if (n < 32 && ix0 !== NPIO2_HW[n - 1]) {
      y0 = rr - w;
    } else {
      const j = ix0 >> 20;
      y0 = rr - w;
      bits.setFloat64(0, y0);
      let i = j - ((bits.getInt32(0) >> 20) & 0x7ff);
      if (i > 16) {
        // second step, good to 118 bits
        t = rr;
        w = fn * RP_PIO2_2;
        rr = t - w;
        w = fn * RP_PIO2_2T - (t - rr - w);
        y0 = rr - w;
        bits.setFloat64(0, y0);
        i = j - ((bits.getInt32(0) >> 20) & 0x7ff);
        if (i > 49) {
          // third step, 151 bits
          t = rr;
          w = fn * RP_PIO2_3;
          rr = t - w;
          w = fn * RP_PIO2_3T - (t - rr - w);
          y0 = rr - w;
        }
      }
    }
    y1 = rr - y0 - w;
    if (hx0 < 0) {
      y0 = -y0;
      y1 = -y1;
      n = -n;
    }
  }
  // __kernel_tan(y0, y1, iy): iy = 1 for an even n (tan), −1 for an odd n (−1/tan).
  const iy = 1 - ((n & 1) << 1);
  let x = y0;
  let y = y1;
  bits.setFloat64(0, x);
  const hx = bits.getInt32(0);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    // |x| < 2^−28 (always truncates to 0: fdlibm's "generate inexact")
    const low = bits.getUint32(4);
    if ((ix | low | (iy + 1)) === 0) {
      r[TAN_VALUE] = 1 / Math.abs(x);
      return;
    }
    if (iy === 1) {
      r[TAN_VALUE] = x;
      return;
    }
    // −1 / (x + y), carefully
    const w = x + y;
    bits.setFloat64(0, w);
    bits.setInt32(4, 0);
    const z = bits.getFloat64(0);
    const v = y - (z - x);
    const a = -1 / w;
    bits.setFloat64(0, a);
    bits.setInt32(4, 0);
    const t = bits.getFloat64(0);
    const s = 1 + t * z;
    r[TAN_VALUE] = t + a * (s + t * v);
    return;
  }
  const big = ix >= 0x3fe59428;
  if (big) {
    // |x| ≥ 0.6744: tan(π/4 − x)
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    const z = PIO4 - x;
    const w = PIO4_LO - y;
    x = z + w;
    y = 0;
  }
  const z = x * x;
  let w = z * z;
  let rr = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
  let v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))));
  let s = z * x;
  rr = y + z * (s * (rr + v) + y);
  rr += T0 * s;
  w = x + rr;
  if (big) {
    v = iy;
    r[TAN_VALUE] = (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((w * w) / (w + v) - rr)));
    return;
  }
  if (iy === 1) {
    r[TAN_VALUE] = w;
    return;
  }
  // −1 / (x + r), accurately
  bits.setFloat64(0, w);
  bits.setInt32(4, 0);
  const zw = bits.getFloat64(0);
  v = rr - (zw - x);
  const a = -1 / w;
  bits.setFloat64(0, a);
  bits.setInt32(4, 0);
  const t = bits.getFloat64(0);
  s = 1 + t * zw;
  r[TAN_VALUE] = t + a * (s + t * v);
}

const TAN_REGISTER = createTanRegister();

/** `Math.tan(x)` with the same bits on every engine (bit for bit `tanIn`; |x| ≤ `PORTABLE_TRIG_MAX`), for cold code. */
export function ptan(x: number): number {
  TAN_REGISTER[TAN_ANGLE] = x;
  tanIn(TAN_REGISTER);
  return TAN_REGISTER[TAN_VALUE] as number;
}

/** π/2 in two parts, π/4 (fdlibm e_asin.c `pio2_hi`, `pio2_lo`, `pio4_hi`). */
const AS_PIO2_HI = 1.570796326794896558e0;
const AS_PIO2_LO = 6.12323399573676603587e-17;
const AS_PIO4_HI = 7.85398163397448278999e-1;
/** The rational approximation of the arc sine (fdlibm e_asin.c, pS0 … pS5, qS1 … qS4). */
const PS0 = 1.66666666666666657415e-1;
const PS1 = -3.25565818622400915405e-1;
const PS2 = 2.01212532134862925881e-1;
const PS3 = -4.00555345006794114027e-2;
const PS4 = 7.91534994289814532176e-4;
const PS5 = 3.4793310759602116757e-5;
const QS1 = -2.40339491173441421878e0;
const QS2 = 2.02094576023350569471e0;
const QS3 = -6.8828397160545329303e-1;
const QS4 = 7.70381505559019352791e-2;

/** Slots of an `asinIn` register: the sine … */
export const ASIN_X = 0;
/** … and its arc sine in [−π/2, π/2] [radians]. */
export const ASIN_ANGLE = 1;

/** A register for `asinIn` (two doubles: sine, angle). Hold one per module; read the result right away. */
export function createAsinRegister(): Float64Array<ArrayBuffer> {
  return new Float64Array(2);
}

/**
 * `Math.asin(r[ASIN_X])` into `r[ASIN_ANGLE]`, the same bits on every engine: fdlibm's `__ieee754_asin` (e_asin.c),
 * statement for statement – V8's own algorithm, so in V8 the two agree to the bit. For code that runs every tick or frame:
 * no fractional number crosses this call. Like `Math.asin`: NaN outside [−1, 1] and for NaN.
 */
export function asinIn(r: Float64Array): void {
  const x = r[ASIN_X] as number;
  bits.setFloat64(0, x);
  const hx = bits.getInt32(0);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| ≥ 1
    if (((ix - 0x3ff00000) | bits.getUint32(4)) === 0) r[ASIN_ANGLE] = x * AS_PIO2_HI + x * AS_PIO2_LO;
    else r[ASIN_ANGLE] = (x - x) / (x - x);
    return;
  }
  if (ix < 0x3fe00000) {
    // |x| < ½
    if (ix < 0x3e400000) {
      // |x| < 2^−27
      r[ASIN_ANGLE] = x;
      return;
    }
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    r[ASIN_ANGLE] = x + x * (p / q);
    return;
  }
  // ½ ≤ |x| < 1
  const w0 = 1 - Math.abs(x);
  const t = w0 * 0.5;
  let p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  let q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  let out: number;
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    out = AS_PIO2_HI - (2 * (s + s * (p / q)) - AS_PIO2_LO);
  } else {
    bits.setFloat64(0, s);
    bits.setInt32(4, 0);
    const w = bits.getFloat64(0);
    const c = (t - w * w) / (s + w);
    const rr = p / q;
    p = 2 * s * rr - (AS_PIO2_LO - 2 * c);
    q = AS_PIO4_HI - 2 * w;
    out = AS_PIO4_HI - (p - q);
  }
  r[ASIN_ANGLE] = hx > 0 ? out : -out;
}

const ASIN_REGISTER = createAsinRegister();

/** `Math.asin(x)` with the same bits on every engine (bit for bit `asinIn`), for code outside the per-tick paths. */
export function pasin(x: number): number {
  ASIN_REGISTER[ASIN_X] = x;
  asinIn(ASIN_REGISTER);
  return ASIN_REGISTER[ASIN_ANGLE] as number;
}

/** Slots of a `hypotIn` register: the two legs … */
export const HYPOT_X = 0;
export const HYPOT_Y = 1;
/** … and the length √(x² + y²). */
export const HYPOT_LENGTH = 2;

/** A register for `hypotIn` (three doubles: x, y, length). Hold one per module; read the result right away. */
export function createHypotRegister(): Float64Array<ArrayBuffer> {
  return new Float64Array(3);
}

/**
 * `Math.hypot(r[HYPOT_X], r[HYPOT_Y])` into `r[HYPOT_LENGTH]`, the same bits on every engine: V8's own algorithm
 * (builtins `MathHypot`: both legs divided by the larger, their squares added with Kahan's compensation – for two legs
 * the compensation is exactly 0 –, the root times the larger), so in V8 the two agree to the bit. Other engines compute
 * `Math.hypot` differently (JavaScriptCore and SpiderMonkey). +∞ if a leg is ±∞, else NaN if one is NaN; 0 for two
 * zeros. For code that runs every tick or frame: no fractional number crosses this call (`Math.hypot` itself takes its
 * arguments as objects).
 */
export function hypotIn(r: Float64Array): void {
  const ax = Math.abs(r[HYPOT_X] as number);
  const ay = Math.abs(r[HYPOT_Y] as number);
  if (ax === Infinity || ay === Infinity) {
    r[HYPOT_LENGTH] = Infinity;
    return;
  }
  if (ax !== ax || ay !== ay) {
    r[HYPOT_LENGTH] = NaN;
    return;
  }
  const max = ax > ay ? ax : ay;
  if (max === 0) {
    r[HYPOT_LENGTH] = 0;
    return;
  }
  const a = ax / max;
  const b = ay / max;
  r[HYPOT_LENGTH] = Math.sqrt(a * a + b * b) * max;
}

const HYPOT_REGISTER = createHypotRegister();

/** `Math.hypot(x, y)` with the same bits on every engine (bit for bit `hypotIn`), for code outside the per-tick paths. */
export function phypot(x: number, y: number): number {
  HYPOT_REGISTER[HYPOT_X] = x;
  HYPOT_REGISTER[HYPOT_Y] = y;
  hypotIn(HYPOT_REGISTER);
  return HYPOT_REGISTER[HYPOT_LENGTH] as number;
}
