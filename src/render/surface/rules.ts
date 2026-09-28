/**
 * TypeScript mirror of the scalar rules and the cluster noise of `shaders/world/surface.glsl` (M5-19, M5-20): the
 * same integer hash, value noise and thresholds, so tests can check what the shaders decide – snow grows only where
 * it already lay at a thinner cover, puddles and wet patches form clusters, never single pixels.
 */
import { SURFACE_PARAMS } from './params';

const P = SURFACE_PARAMS;

/** Integer hash of a world cell (lowbias32 as in `cellHash`), 0…1. */
export function cellHash(cx: number, cy: number, salt: number): number {
  let h = (Math.imul(cx >>> 0, 0x8da6b343) ^ Math.imul(cy >>> 0, 0xd8163841) ^ Math.imul(salt >>> 0, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

function smooth(f: number): number {
  return f * f * (3 - 2 * f);
}

/** Smooth value noise of wavelength `wave` px at world px (x, y), 0…1 (`valueNoise`). */
export function valueNoise(x: number, y: number, wave: number, salt: number): number {
  const gx = x / wave;
  const gy = y / wave;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smooth(gx - ix);
  const fy = smooth(gy - iy);
  const a = cellHash(ix, iy, salt);
  const b = cellHash(ix + 1, iy, salt);
  const d = cellHash(ix, iy + 1, salt);
  const e = cellHash(ix + 1, iy + 1, salt);
  const top = a + (b - a) * fx;
  const bottom = d + (e - d) * fx;
  return top + (bottom - top) * fy;
}

/** Spread of the blended value noise around 0.5 (`NOISE_SPREAD`): the logistic function evens it out. */
export const NOISE_SPREAD = 0.093;

/** Cluster noise at world px (x, y) (`clusterNoise`): constant over each `cell`-px cell, near-uniform on 0…1. */
export function clusterNoise(x: number, y: number, wave: number, detail: number, cell: number, salt: number): number {
  const qx = (Math.floor(x / cell) + 0.5) * cell;
  const qy = (Math.floor(y / cell) + 0.5) * cell;
  const n = 0.7 * valueNoise(qx, qy, wave, salt) + 0.3 * valueNoise(qx, qy, detail, salt + 7);
  return 1 / (1 + Math.exp(-(n - 0.5) / NOISE_SPREAD));
}

/** `snowLine`: whether a place with noise `n` lies under snow at cover `cover`. */
export function snowLine(cover: number, n: number): boolean {
  return cover >= 1 ? true : cover * 1.15 - 0.15 > n;
}

/** `spriteSnow`: whether a sprite pixel facing up by `up` with noise `n` carries snow at cover `cover`. */
export function spriteSnow(cover: number, up: number, n: number): boolean {
  const from = P.snow.spriteCoverFrom;
  const c = (cover - from) / (1 - from);
  return c > 0 && up > P.snow.spriteUpFrom && c * (0.35 + up) > 0.3 + 0.55 * n;
}

/** `puddleAt`: whether a hollow with noise `n` holds water at fill `fill`. */
export function puddleAt(fill: number, n: number): boolean {
  return fill > 0 && n < fill * P.wet.puddleCoverMax;
}

/** `wetPatch`: whether a place with noise `n` is darkened at wetness `wet`. */
export function wetPatch(wet: number, n: number): boolean {
  return wet >= 1 ? true : wet * 1.25 - 0.25 > n;
}

/** Salts of the surface noise fields (the same numbers as the shaders' literals). */
export const NOISE_SALT = { snow: 11, puddle: 23, wet: 37 } as const;

/**
 * `outlineGlint` (outline.frag, M5-24): whether the outline pixel at world px (x, y) shows the glint at presentation
 * time `t` – diagonal bands `width` px wide every `spacing` px, travelling one spacing per `seconds`.
 */
export function outlineGlint(x: number, y: number, t: number, spacing: number = P.effects.outlineGlintSpacingPx, width: number = P.effects.outlineGlintWidthPx, seconds: number = P.effects.outlineGlintSeconds): boolean {
  const v = (Math.floor(x) + Math.floor(y)) / spacing - t / seconds;
  return v - Math.floor(v) < width / spacing;
}

/** 4×4 Bayer threshold at px (x, y) in [0, 1) (`bayer4` of bayer.glsl). */
export function bayer4(x: number, y: number): number {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const qx = ((Math.floor(x) % 4) + 4) % 4;
  const qy = ((Math.floor(y) % 4) + 4) % 4;
  return ((m[qx + qy * 4] as number) + 0.5) / 16;
}

/** Dither fade (sprite_gbuffer.frag, M5-24): whether pixel (x, y) of a sprite faded by `fade` (0…1, 8 bit) is drawn. */
export function fadeKeeps(fade: number, x: number, y: number): boolean {
  const f = Math.round(Math.min(1, Math.max(0, fade)) * 255) / 255;
  return !(f > bayer4(x, y));
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Canopy see-through (sprite_gbuffer.frag, M5-18): whether a crown or roof pixel at relative distance `d` from the
 * circle's centre (1 = its radius) and world px (x, y) is drawn – gone in the core, dithered out in the ring.
 */
export function canopyKeeps(d: number, x: number, y: number, core: number = P.canopy.core): boolean {
  return !(d < 1 && smoothstep(core, 1, d) < bayer4(x, y));
}

/**
 * Palette swap order (sprite_gbuffer.frag, M5-19, M5-24): the row blend a pixel of ramp position `rank` (0 dark … 1
 * light) on a sprite with seed `seed` (0…1) needs before it takes the second row – light steps first, then the seed.
 */
export function swapThreshold(rank: number, seed: number, weight: number = P.seasons.rankWeight): number {
  return (seed + (1 - rank - seed) * weight) * 0.98 + 0.01;
}

/**
 * The see-through circle around the player (M5-18): how far it is open after a frame of `dt` s (`dt` ≤ 0 or not finite:
 * a frozen clock, one `frozenStep`) – it irises open over `openSeconds` while a crown or roof covers the player and is
 * shut (0) while nothing does (the crowns are then drawn whole anyway).
 */
export function irisStep(open: number, covered: boolean, dt: number): number {
  const c = P.canopy;
  if (!covered) return 0;
  const step = Number.isFinite(dt) && dt > 0 ? dt / c.openSeconds : c.frozenStep;
  return Math.min(1, Math.max(0, open) + step);
}

/** The circle's radius share for an open share `open` (smoothstep: fast at first, settling gently). */
export function irisEase(open: number): number {
  const t = Math.min(1, Math.max(0, open));
  return t * t * (3 - 2 * t);
}

/**
 * Pressure of a figure on the grass (interaction_stamp.frag, M5-17) at distance `d` px from its feet: a dome, full at
 * the feet, zero at `radius`, scaled by `strength`.
 */
export function pushDome(d: number, radius: number, strength: number): number {
  const x = d / Math.max(1, radius);
  return x >= 1 ? 0 : strength * (1 - x * x);
}

/**
 * The grass springs back (interaction_decay.frag, M5-17): the pressure left of `p` after `dt` s with half-life
 * `halfLife` s; below one and a half 8-bit steps nothing is left (no residue that never fades).
 */
export function pressureAfter(p: number, dt: number, halfLife: number = P.grass.springBackSeconds): number {
  const left = p * (dt > 0 ? Math.pow(0.5, dt / halfLife) : 1);
  return left < 1.5 / 255 ? 0 : left;
}

/**
 * Palette swap order of an effect (`creep`, sprite_gbuffer.frag, M5-24): the row blend a pixel of ramp position `rank`
 * with cluster noise `noise` (0…1, world-anchored) needs – the light steps first, the clusters spreading the rest.
 */
export function creepThreshold(rank: number, noise: number, weight: number = P.effects.creepRankWeight): number {
  return (noise + (1 - rank - noise) * weight) * 0.98 + 0.01;
}
