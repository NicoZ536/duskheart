/**
 * Light bands with ordered dither (MASTERPROMPT §6.1 pass 6, §6 "Licht … in Pixelgröße gerastert
 * (inkl. optionaler Licht-Bänderung mit Dithering)"): TypeScript mirror of `shaders/composite.glsl`
 * and the 4×4 Bayer matrix of `shaders/bayer.glsl`, for tests and for CPU consumers that must show
 * the same steps (e.g. a light-level preview).
 *
 * Also the soft add of the point light over the daylight (`pointOverDaylight`, `composite_daylight.glsl`; M5 review M1,
 * M5-41: composition, GPU particles, fog) and the composition's daylight steps (`daylightStep`, Minor 6).
 */
import { DAYLIGHT_STEPS, POINT_OVER_DAYLIGHT } from './params';

/** 4×4 Bayer matrix, row-major (x + 4·y), values 0…15 (`bayer.glsl`). */
export const BAYER_4X4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER_SIZE = 4;
const BAYER_CELLS = BAYER_SIZE * BAYER_SIZE;

/** Dither threshold in (0, 1) of world pixel (x, y) – anchored to the world, not the screen. */
export function bayerThreshold(x: number, y: number): number {
  const qx = ((Math.floor(x) % BAYER_SIZE) + BAYER_SIZE) % BAYER_SIZE;
  const qy = ((Math.floor(y) % BAYER_SIZE) + BAYER_SIZE) % BAYER_SIZE;
  return ((BAYER_4X4[qx + qy * BAYER_SIZE] ?? 0) + 0.5) / BAYER_CELLS;
}

/** Threshold without dither: plain rounding to the nearest band. */
export const BAND_ROUNDING = 0.5;

/**
 * Share of each light step over which the dither blends into the next band (centred on the step's
 * midpoint). Below 1 every band keeps a flat core – clear rings with dithered seams instead of a
 * dither pattern over the whole gradient, which would read as noise (§4.5).
 */
export const BAND_DITHER_SPREAD = 0.5;

/** Rounding threshold of a pixel with Bayer value `bayer` (`bandThreshold` in composite.glsl). */
export function bandThreshold(bayer: number): number {
  return BAND_ROUNDING + (bayer - BAND_ROUNDING) * BAND_DITHER_SPREAD;
}

/**
 * Emission levels per unit the composition snaps the G-buffer's emission to: the 8-bit channel holds
 * emission / 4, i.e. steps of 4/255; the nearest 1/64 is the authored value (1, 1.5, 2 … stay exact).
 */
export const EMISSION_STEPS = 64;

/** `#define`s of the composition program. */
export function bandingDefines(): Readonly<Record<string, string>> {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return { DH_BAND_DITHER_SPREAD: f(BAND_DITHER_SPREAD), DH_EMISSION_STEPS: f(EMISSION_STEPS) };
}

/** The band level a light peak falls into (`lightBandLevel` in composite.glsl). */
export function lightBandLevel(peak: number, levels: number, threshold: number): number {
  return Math.floor(peak * levels + threshold) / levels;
}

/** Factor that moves a light with brightest channel `peak` onto its band (hue kept); 1 for no light. */
export function lightBandScale(peak: number, levels: number, threshold: number): number {
  if (peak <= 0) return 1;
  return lightBandLevel(peak, levels, threshold) / peak;
}

/** Steps per unit of the daylight factors (`DH_DAY_STEPS`, `DAYLIGHT_STEPS.levels`). */
const DAY_STEPS = DAYLIGHT_STEPS.levels;

/**
 * A daylight factor (ambient occlusion, the sun's penumbra, a cloud edge) in steps of 1/`DAYLIGHT_STEPS.levels` at the
 * pixel's threshold (`daylightStep` in composite.glsl, M5 review Minor 6); 1 stays 1.
 */
export function daylightStep(v: number, threshold: number): number {
  return Math.min(1, lightBandLevel(v, DAY_STEPS, threshold));
}

/**
 * Share of the point light a pixel keeps over a daylight whose brightest channel is `peak` while the scene's daylight
 * stands at `level` – `pointOverPeak` in composite_daylight.glsl: 1 − suppression · saturate(peak) · level.
 */
export function pointOverPeak(peak: number, level: number): number {
  return 1 - POINT_OVER_DAYLIGHT.suppression * Math.max(0, Math.min(1, peak)) * level;
}

/**
 * Share of the point light a pixel keeps over its daylight `day` (rgb) while the scene's daylight stands at `level` (the
 * ambient's brightest channel, clamped to 0 … 1: `dayLevel`) – `pointOverDaylight` in composite_daylight.glsl, M5 review
 * M1: 1 − suppression · saturate(peak of the daylight) · level. The composition passes its pixel's daylight; the GPU
 * particles, their light and the fog's scattered light (M5-41) pass the ambient itself (`pointOverAmbient`).
 */
export function pointOverDaylight(r: number, g: number, b: number, level: number): number {
  return pointOverPeak(Math.max(r, g, b), level);
}

/** The scene's daylight level for `pointOverDaylight`: the brightest channel of its ambient (colour × strength), 0 … 1. */
export function dayLevel(r: number, g: number, b: number): number {
  return Math.max(0, Math.min(1, Math.max(r, g, b)));
}

/**
 * Share of the point light over what the ambient (colour × strength) alone lights – particles in the air and fog, which
 * know no sun, shadow or roof (M5-41): `pointOverDaylight(ambient, dayLevel(ambient))`. Sunlit noon 0, a moonlit night
 * ≥ 0.87, a cave ≈ 1.
 */
export function pointOverAmbient(r: number, g: number, b: number): number {
  return pointOverDaylight(r, g, b, dayLevel(r, g, b));
}

/** `#define`s of `composite_daylight.glsl` (also part of `lightStrandDefines`). */
export function pointOverDaylightDefines(): Readonly<Record<string, string>> {
  const s = POINT_OVER_DAYLIGHT.suppression;
  return { DH_POINT_DAY_SUPPRESSION: Number.isInteger(s) ? s.toFixed(1) : String(s) };
}
