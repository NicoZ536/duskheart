/**
 * CPU mirrors of the sun through glass (M5-05, M5-58, M5-68), for tests and CPU consumers that must show the same light:
 * - `glassThrough` (shadow_glass.glsl): the light a pane of a colour lets through – its hue at full brightness to the
 *   power `GLASS.density` (Beer–Lambert), lifted towards white by `GLASS.whiten`, dimmed to `GLASS.transmission`;
 *   `glassChannel` its scalar core; `paneLight` (shadow_block.frag): clear glass (the ramp `GLASS.clearRamp`, the sky's
 *   reflex painted on it) grey instead.
 * - `glassTint` (shadow.glsl): whether light of the silhouette target is a stained-glass pane's colour – grey there (the
 *   sun unshadowed, behind a wall, through a clear pane) differs by less than `GLASS.tintEpsilon`. Such a receiver keeps
 *   its pane's colour unblurred (`sunVisibility`).
 * - `reflectGlassLight` (composite.frag): how a surface reflects the light of a stained-glass pane – with the spectral
 *   share `GLASS.spectralShare` instead of the daylight's, so the patch keeps the pane's hue on warm boards (M5-68).
 */
import { GLASS, glassClearIndices } from './params';
import { lightReflectance } from './spectral';

type Rgb = readonly [number, number, number];

/** One channel `c` of a pane whose brightest channel is `peak` > 0 (`glassChannel` of shadow_glass.glsl). */
export function glassChannel(c: number, peak: number): number {
  const w = GLASS.whiten;
  return (Math.pow(c / peak, GLASS.density) * (1 - w) + w) * GLASS.transmission;
}

/** The light a pane of colour `pane` lets through (`glassThrough` of shadow_glass.glsl); black for a black pane. */
export function glassThrough(pane: Rgb): [number, number, number] {
  const peak = Math.max(pane[0], pane[1], pane[2]);
  if (!(peak > 0)) return [0, 0, 0];
  return [glassChannel(pane[0], peak), glassChannel(pane[1], peak), glassChannel(pane[2], peak)];
}

/**
 * The light a glass texel of palette index `index` (1 … 64) and colour `pane` lets through (shadow_block.frag): clear glass
 * (the ramp `GLASS.clearRamp`) grey at `GLASS.transmission`, a coloured pane its own hue (`glassThrough`).
 */
export function paneLight(index: number, pane: Rgb): [number, number, number] {
  const { first, last } = glassClearIndices();
  if (index >= first && index <= last) return [GLASS.transmission, GLASS.transmission, GLASS.transmission];
  return glassThrough(pane);
}

/** 1 when light whose darkest channel is `lo` and brightest `hi` is a stained-glass pane's colour, else 0 (`glassTint`). */
export function glassTint(lo: number, hi: number): number {
  return hi - lo > GLASS.tintEpsilon ? 1 : 0;
}

/**
 * Colour reflected by albedo (ar, ag, ab) under the light (lr, lg, lb) of a stained-glass pane (`reflectGlassLight` of
 * composite.frag): the RGB product blended by `GLASS.spectralShare` towards the light's colour × the surface's
 * reflectance under it (`lightReflectance`, spectral.ts) – at 1 exactly the pane's hue. Black without light.
 */
export function reflectGlassLight(ar: number, ag: number, ab: number, lr: number, lg: number, lb: number): [number, number, number] {
  const sum = lr + lg + lb;
  if (!(sum > 0)) return [0, 0, 0];
  const rho = lightReflectance(ar, ag, ab, lr, lg, lb);
  const k = GLASS.spectralShare;
  return [ar * lr * (1 - k) + lr * rho * k, ag * lg * (1 - k) + lg * rho * k, ab * lb * (1 - k) + lb * rho * k];
}
