/**
 * CPU mirrors of the sun through glass (M5-05, M5-58), for tests and CPU consumers that must show the same light:
 * - `glassThrough` (shadow_glass.glsl): the light a pane of a colour lets through – its hue at full brightness, lifted
 *   towards white by `GLASS.whiten`, dimmed to `GLASS.transmission`; `paneLight` (shadow_block.frag): clear glass (the
 *   ramp `GLASS.clearRamp`, the sky's reflex painted on it) grey instead.
 * - `glassTint` (shadow.glsl): whether light of the silhouette target is a stained-glass pane's colour – grey there (the
 *   sun unshadowed, behind a wall, through a clear pane) differs by less than `GLASS.tintEpsilon`. Such a receiver keeps
 *   its pane's colour unblurred (`sunVisibility`).
 */
import { GLASS, glassClearIndices } from './params';

type Rgb = readonly [number, number, number];

/** The light a pane of colour `pane` lets through (`glassThrough` of shadow_glass.glsl); black for a black pane. */
export function glassThrough(pane: Rgb): [number, number, number] {
  const peak = Math.max(pane[0], pane[1], pane[2]);
  if (!(peak > 0)) return [0, 0, 0];
  const w = GLASS.whiten;
  const t = GLASS.transmission;
  return [((pane[0] / peak) * (1 - w) + w) * t, ((pane[1] / peak) * (1 - w) + w) * t, ((pane[2] / peak) * (1 - w) + w) * t];
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
