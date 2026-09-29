/**
 * Colour grading (MASTERPROMPT §6.1 pass 9 "Color-Grading über 3D-LUTs (Biom × Tageszeit × Wetter,
 * weich überblendet, LUTs aus Parametern generiert)", M5-14).
 *
 * A grade is a short parameter vector (`GRADING_KEYS`): white balance, exposure, lift/gamma/gain per
 * channel, contrast, saturation, split toning of shadows and highlights, and the vignette the grade asks
 * for. Grades blend as vectors – biome keys, the daytime, the weather and corruption are weighted sums
 * of such vectors (`src/render/world/atmosphereScene.ts`) – and the post pass turns the blended vector
 * into a 3D LUT (`generateGradingLut`) whenever it changed noticeably. The LUT is applied to the
 * tonemapped colour (LDR) of every drawn pixel.
 *
 * The LUT has `GRADING_LUT_SIZE` = 16 nodes per axis: 255 / 15 = 17 is whole, so every node of the
 * neutral grade is an exact 8-bit value and trilinear filtering between them is exact again – a neutral
 * grade leaves every palette colour on screen as painted (ADR-0012), tested in grading-lut.test.ts.
 * The colour space is the one the palette is painted in (no sRGB conversion anywhere in the pipeline).
 *
 * The colour-blind modes of the settings (§29 "Farbenblind-Modi": protanopia, deuteranopia, tritanopia)
 * correct the finished picture (`daltonize`): the colour information a viewer with that deficiency cannot see is
 * moved into the channels they can. The correction is linear – one 3 × 3 matrix in display space
 * (`colorblindMatrix`) – and the post pass applies it last, after the grade and after the red and green state rims,
 * so those rims reach the viewer corrected like the scene (review M5 Minor 7). `generateGradingLut` can still fold
 * it into a LUT (tools, tests).
 */
import type { Settings } from '../../engine/settings';

/** A colour-blind mode of the settings ('none' = no correction). */
export type ColorblindMode = Settings['accessibility']['colorblind'];

/** Parameters of a grade, in the order of the packed vector. */
export const GRADING_KEYS = [
  /** White balance: −1 cool … +1 warm (red up, blue down). */
  'temperature',
  /** Green (−1) … magenta (+1). */
  'tint',
  /** Exposure in stops before the curve. */
  'exposure',
  /** Contrast around `GRADING_PIVOT` (1 = unchanged). */
  'contrast',
  /** Saturation around the luma (1 = unchanged, 0 = grey). */
  'saturation',
  /** Lift (raises the blacks towards this value per channel, 0 = none). */
  'liftR',
  'liftG',
  'liftB',
  /** Gamma per channel (1 = linear). */
  'gammaR',
  'gammaG',
  'gammaB',
  /** Gain per channel (1 = unchanged). */
  'gainR',
  'gainG',
  'gainB',
  /**
   * Split toning of the shadows: tint colour premultiplied by its amount (colour · amount, neutral 0) and
   * the amount 0…1. Premultiplied, blended grades mix the hues of their tints by weight – two tints never
   * cancel into a black or negative colour – and only the hue of the sum is used (luminance-normalised).
   */
  'shadowR',
  'shadowG',
  'shadowB',
  'shadowAmount',
  /** Split toning of the highlights (premultiplied like the shadows). */
  'highlightR',
  'highlightG',
  'highlightB',
  'highlightAmount',
  /** Vignette the grade asks for (0 none … 1 heavy); spatial, applied by the post pass, not in the LUT. */
  'vignette',
] as const;

export type GradingKey = (typeof GRADING_KEYS)[number];
/** A grade with named fields (tables); `packGrading` turns it into the blendable vector. */
export type GradingParams = Readonly<Record<GradingKey, number>>;
/** A partial grade of a table: missing fields are neutral. */
export type GradingPartial = Readonly<Partial<Record<GradingKey, number>>>;

/** Number of parameters in the packed vector. */
export const GRADING_PARAM_COUNT = GRADING_KEYS.length;

/** Index of each parameter in the packed vector. */
export const GRADING_INDEX: Readonly<Record<GradingKey, number>> = Object.freeze(Object.fromEntries(GRADING_KEYS.map((k, i) => [k, i])) as Record<GradingKey, number>);

/** Nodes per LUT axis (255 / (size − 1) whole: the neutral LUT is exact). */
export const GRADING_LUT_SIZE = 16;
/** Bytes of one RGBA8 LUT. */
export const GRADING_LUT_BYTES = GRADING_LUT_SIZE * GRADING_LUT_SIZE * GRADING_LUT_SIZE * 4;
/** Contrast pivot: the mid-grey of the palette's value scale. */
export const GRADING_PIVOT = 0.42;
/** Channel gain of full white balance (temperature ±1 scales red/blue by 1 ± this). */
export const TEMPERATURE_GAIN = 0.12;
/** Channel gain of full tint (tint ±1 scales green by 1 ∓ this). */
export const TINT_GAIN = 0.08;
/** Largest parameter change that does not regenerate the LUT (well below one 8-bit step of any node). */
export const GRADING_REGEN_EPSILON = 1 / 1024;

/**
 * Luma weights of the display-space palette colours (Rec. 601) – the one luma of the render code: grading, corruption
 * and the post shaders (`DH_LUMA`, postPass.ts) weigh brightness with it.
 */
export const LUMA: readonly [number, number, number] = [0.299, 0.587, 0.114];
const [LUMA_R, LUMA_G, LUMA_B] = LUMA;
const BYTE_MAX = 255;
const RGBA = 4;
/** Luma below which a (premultiplied) split-toning tint counts as none: its hue is undefined. */
const MIN_TINT_LUMA = 1e-4;

/** The neutral grade: the LUT is the identity. */
export const NEUTRAL_GRADING: GradingParams = Object.freeze({
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 1,
  saturation: 1,
  liftR: 0,
  liftG: 0,
  liftB: 0,
  gammaR: 1,
  gammaG: 1,
  gammaB: 1,
  gainR: 1,
  gainG: 1,
  gainB: 1,
  shadowR: 0,
  shadowG: 0,
  shadowB: 0,
  shadowAmount: 0,
  highlightR: 0,
  highlightG: 0,
  highlightB: 0,
  highlightAmount: 0,
  vignette: 0,
});

/** Luma of a display-space colour. */
export function luma(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** A new packed vector (neutral unless `params` is given). */
export function createGrading(params: GradingPartial = NEUTRAL_GRADING): Float32Array {
  const out = new Float32Array(GRADING_PARAM_COUNT);
  return packGrading(params, out);
}

/** Writes a (partial) grade into the packed vector `out`: missing fields neutral. Returns `out`. */
export function packGrading(params: GradingPartial, out: Float32Array): Float32Array {
  for (let i = 0; i < GRADING_PARAM_COUNT; i++) {
    const k = GRADING_KEYS[i] as GradingKey;
    out[i] = params[k] ?? NEUTRAL_GRADING[k];
  }
  return out;
}

/** Sets `out` to the neutral grade. */
export function resetGrading(out: Float32Array): Float32Array {
  return packGrading(NEUTRAL_GRADING, out);
}

/** `out += w · (grade − neutral)`: adds a (partial) grade as a deviation from neutral with weight `w`. */
export function addGradingDelta(out: Float32Array, params: GradingPartial, w: number): Float32Array {
  if (w === 0) return out;
  for (let i = 0; i < GRADING_PARAM_COUNT; i++) {
    const k = GRADING_KEYS[i] as GradingKey;
    const v = params[k];
    if (v !== undefined) out[i] = (out[i] as number) + w * (v - NEUTRAL_GRADING[k]);
  }
  return out;
}

/** `out = a + (b − a) · t` over packed vectors. */
export function mixGrading(out: Float32Array, a: Float32Array, b: Float32Array, t: number): Float32Array {
  for (let i = 0; i < GRADING_PARAM_COUNT; i++) {
    const x = a[i] as number;
    out[i] = x + ((b[i] as number) - x) * t;
  }
  return out;
}

/** Largest absolute difference of two packed vectors. */
export function gradingDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < GRADING_PARAM_COUNT; i++) d = Math.max(d, Math.abs((a[i] as number) - (b[i] as number)));
  return d;
}

/** Whether a packed vector is the neutral grade (up to the regeneration epsilon), ignoring the vignette. */
export function isNeutralGrading(p: Float32Array): boolean {
  for (let i = 0; i < GRADING_PARAM_COUNT; i++) {
    const k = GRADING_KEYS[i] as GradingKey;
    if (k === 'vignette') continue;
    if (Math.abs((p[i] as number) - NEUTRAL_GRADING[k]) > GRADING_REGEN_EPSILON) return false;
  }
  return true;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** One channel through lift, gain and gamma (ASC-CDL-like): `(gain·c + lift·(1 − c))^(1/gamma)`. */
function liftGammaGain(c: number, lift: number, gamma: number, gain: number): number {
  const v = c * gain + lift * (1 - c);
  if (v <= 0) return 0;
  return gamma === 1 ? v : Math.pow(v, 1 / gamma);
}

/**
 * The grade of one display-space colour (0…1 per channel) under the packed parameters `p` – exactly what
 * the LUT stores at its nodes. Order: exposure → white balance → lift/gamma/gain → contrast → saturation →
 * split toning (luminance-normalised tints weighted by (1 − L)² and L²) → clamp. Writes `out`.
 */
export function gradeColor(r: number, g: number, b: number, p: ArrayLike<number>, out: [number, number, number]): [number, number, number] {
  const I = GRADING_INDEX;
  const exposure = Math.pow(2, p[I.exposure] as number);
  const temperature = p[I.temperature] as number;
  const tint = p[I.tint] as number;
  let cr = r * exposure * (1 + TEMPERATURE_GAIN * temperature);
  let cg = g * exposure * (1 - TINT_GAIN * tint);
  let cb = b * exposure * (1 - TEMPERATURE_GAIN * temperature);
  cr = liftGammaGain(cr, p[I.liftR] as number, p[I.gammaR] as number, p[I.gainR] as number);
  cg = liftGammaGain(cg, p[I.liftG] as number, p[I.gammaG] as number, p[I.gainG] as number);
  cb = liftGammaGain(cb, p[I.liftB] as number, p[I.gammaB] as number, p[I.gainB] as number);
  const contrast = p[I.contrast] as number;
  if (contrast !== 1) {
    cr = (cr - GRADING_PIVOT) * contrast + GRADING_PIVOT;
    cg = (cg - GRADING_PIVOT) * contrast + GRADING_PIVOT;
    cb = (cb - GRADING_PIVOT) * contrast + GRADING_PIVOT;
  }
  const saturation = p[I.saturation] as number;
  if (saturation !== 1) {
    const l = luma(cr, cg, cb);
    cr = l + (cr - l) * saturation;
    cg = l + (cg - l) * saturation;
    cb = l + (cb - l) * saturation;
  }
  const sr = Math.max(0, p[I.shadowR] as number);
  const sg = Math.max(0, p[I.shadowG] as number);
  const sb = Math.max(0, p[I.shadowB] as number);
  const hr = Math.max(0, p[I.highlightR] as number);
  const hg = Math.max(0, p[I.highlightG] as number);
  const hb = Math.max(0, p[I.highlightB] as number);
  const sl = luma(sr, sg, sb);
  const hl = luma(hr, hg, hb);
  const shadowAmount = sl > MIN_TINT_LUMA ? clamp01(p[I.shadowAmount] as number) : 0;
  const highlightAmount = hl > MIN_TINT_LUMA ? clamp01(p[I.highlightAmount] as number) : 0;
  if (shadowAmount !== 0 || highlightAmount !== 0) {
    const l = clamp01(luma(cr, cg, cb));
    const ws = shadowAmount * (1 - l) * (1 - l);
    const wh = highlightAmount * l * l;
    // Hue of the (premultiplied) tint: the colour over its luma – a scale of the tint does not change it.
    const is = ws === 0 ? 0 : 1 / sl;
    const ih = wh === 0 ? 0 : 1 / hl;
    cr *= 1 + (sr * is - 1) * ws + (hr * ih - 1) * wh;
    cg *= 1 + (sg * is - 1) * ws + (hg * ih - 1) * wh;
    cb *= 1 + (sb * is - 1) * ws + (hb * ih - 1) * wh;
  }
  out[0] = clamp01(cr);
  out[1] = clamp01(cg);
  out[2] = clamp01(cb);
  return out;
}

/**
 * Colour-blind simulation and correction (Viénot, Brettel & Mollon 1999 as used by the daltonize filter of
 * Fidaner, Lin & Ozguven): RGB → LMS cone responses, the deficient cone replaced by what the other two
 * predict, back to RGB. Rows of 3 × 3 matrices.
 */
const RGB_TO_LMS = [17.8824, 43.5161, 4.11935, 3.45565, 27.1554, 3.86714, 0.0299566, 0.184309, 1.46709] as const;
const LMS_TO_RGB = [0.0809444479, -0.130504409, 0.116721066, -0.0102485335, 0.0540193266, -0.113614708, -0.000365296938, -0.00412161469, 0.693511405] as const;
const CONE_LOSS: Readonly<Record<Exclude<ColorblindMode, 'none'>, readonly number[]>> = {
  protanopia: [0, 2.02344, -2.52581, 0, 1, 0, 0, 0, 1],
  deuteranopia: [1, 0, 0, 0.494207, 0, 1.24827, 0, 0, 1],
  tritanopia: [1, 0, 0, 0, 1, 0, -0.395913, 0.801109, 0],
};
/** Where the invisible difference goes: the red error into green and blue, the green and blue errors stay. */
const ERROR_SHIFT = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1] as const;

function mat3(m: ArrayLike<number>, x: number, y: number, z: number, out: [number, number, number]): [number, number, number] {
  out[0] = (m[0] as number) * x + (m[1] as number) * y + (m[2] as number) * z;
  out[1] = (m[3] as number) * x + (m[4] as number) * y + (m[5] as number) * z;
  out[2] = (m[6] as number) * x + (m[7] as number) * y + (m[8] as number) * z;
  return out;
}

const cone: [number, number, number] = [0, 0, 0];

/** How a viewer with `mode` sees a display-space colour (for tests and tools; 'none' = the colour). Writes `out`. */
export function simulateColorblind(mode: ColorblindMode, r: number, g: number, b: number, out: [number, number, number]): [number, number, number] {
  if (mode === 'none') {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  mat3(RGB_TO_LMS, r, g, b, cone);
  mat3(CONE_LOSS[mode], cone[0], cone[1], cone[2], out);
  return mat3(LMS_TO_RGB, out[0], out[1], out[2], out);
}

const seen: [number, number, number] = [0, 0, 0];

/**
 * The colour-blind correction of a display-space colour (0…1): the part of the colour `mode` hides
 * (original − simulation) is shifted into the channels that viewer tells apart and added, clamped to 0…1.
 * 'none' leaves the colour unchanged; greys stay grey (they lose nothing). Writes `out`.
 */
export function daltonize(mode: ColorblindMode, r: number, g: number, b: number, out: [number, number, number]): [number, number, number] {
  if (mode === 'none') {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
  simulateColorblind(mode, r, g, b, seen);
  mat3(ERROR_SHIFT, r - seen[0], g - seen[1], b - seen[2], out);
  out[0] = clamp01(r + out[0]);
  out[1] = clamp01(g + out[1]);
  out[2] = clamp01(b + out[2]);
  return out;
}

/** Floats of a 3 × 3 matrix. */
export const MAT3_FLOATS = 9;
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

/** `out` = a · b (3 × 3, row-major); `out` may not be `a` or `b`. */
function mul3(a: ArrayLike<number>, b: ArrayLike<number>, out: number[]): number[] {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = (a[r * 3] as number) * (b[c] as number) + (a[r * 3 + 1] as number) * (b[3 + c] as number) + (a[r * 3 + 2] as number) * (b[6 + c] as number);
    }
  }
  return out;
}

/**
 * The colour-blind correction of `mode` as one matrix in display space (row-major, 9 values into `out`):
 * `daltonize(c)` = clamp(D · c) with D = I + E · (I − S), S the simulation (LMS → cone loss → RGB) and E the shift
 * of the hidden difference. 'none' gives the identity. Not in the frame path (a mode change only).
 */
export function colorblindMatrix(mode: ColorblindMode, out: Float32Array | number[]): Float32Array | number[] {
  if (mode === 'none') {
    for (let i = 0; i < MAT3_FLOATS; i++) out[i] = IDENTITY3[i] as number;
    return out;
  }
  const s = mul3(LMS_TO_RGB, mul3(CONE_LOSS[mode], RGB_TO_LMS, new Array<number>(MAT3_FLOATS)), new Array<number>(MAT3_FLOATS));
  const lost = s.map((v, i) => (IDENTITY3[i] as number) - v);
  const shift = mul3(ERROR_SHIFT, lost, new Array<number>(MAT3_FLOATS));
  for (let i = 0; i < MAT3_FLOATS; i++) out[i] = (IDENTITY3[i] as number) + (shift[i] as number);
  return out;
}

const scratch: [number, number, number] = [0, 0, 0];

/**
 * Writes the RGBA8 3D LUT of grade `p` into `out` (`size`³ texels, x = red, y = green, z = blue – the
 * layout of `texImage3D`), followed by the colour-blind correction `colorblind`. Allocation-free; `out`
 * must hold `size³ · 4` bytes. Returns `out`.
 */
export function generateGradingLut(p: ArrayLike<number>, out: Uint8Array, size = GRADING_LUT_SIZE, colorblind: ColorblindMode = 'none'): Uint8Array {
  if (out.length < size * size * size * RGBA) throw new RangeError(`Grading-LUT: ${out.length} Bytes reichen nicht für ${size}³ Knoten`);
  const step = 1 / (size - 1);
  let o = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        gradeColor(x * step, y * step, z * step, p, scratch);
        if (colorblind !== 'none') daltonize(colorblind, scratch[0], scratch[1], scratch[2], scratch);
        out[o] = Math.round(scratch[0] * BYTE_MAX);
        out[o + 1] = Math.round(scratch[1] * BYTE_MAX);
        out[o + 2] = Math.round(scratch[2] * BYTE_MAX);
        out[o + 3] = BYTE_MAX;
        o += RGBA;
      }
    }
  }
  return out;
}

/**
 * Samples a LUT like the GPU's trilinear filter (reference for tests and tools): colour (0…1) → node
 * coordinates, linear between the eight surrounding nodes. Writes `out` (0…1).
 */
export function sampleGradingLut(lut: Uint8Array, r: number, g: number, b: number, out: [number, number, number], size = GRADING_LUT_SIZE): [number, number, number] {
  const n = size - 1;
  const fx = clamp01(r) * n;
  const fy = clamp01(g) * n;
  const fz = clamp01(b) * n;
  const x0 = Math.min(n - 1, Math.floor(fx));
  const y0 = Math.min(n - 1, Math.floor(fy));
  const z0 = Math.min(n - 1, Math.floor(fz));
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1;
      const dy = (k >> 1) & 1;
      const dz = (k >> 2) & 1;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      if (w === 0) continue;
      const i = (((z0 + dz) * size + (y0 + dy)) * size + (x0 + dx)) * RGBA + c;
      v += w * (lut[i] as number);
    }
    out[c] = v / BYTE_MAX;
  }
  return out;
}

/**
 * The grade of a frame on the scene (`RenderScene.grading`): filled by the scene each frame (the game
 * view blends biome × daytime × weather into `params`, smoothed over time); `active` false (the default of
 * every frame) leaves the picture ungraded – the M1 scenes and the world debug scenes show the palette
 * as painted.
 */
export class GradingState {
  /** The blended grade the post pass turns into its LUT. */
  readonly params: Float32Array = createGrading();
  /** Whether the scene graded this frame. */
  active = false;
  /**
   * Held across frames by the scene fill: the grade it is easing towards and when it last eased
   * (presentation seconds; NaN = never, the next frame snaps).
   */
  readonly target: Float32Array = createGrading();
  easedAt = Number.NaN;

  beginFrame(): void {
    this.active = false;
  }
}
