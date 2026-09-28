/**
 * Winter ice (M5-09 "Winter-Eis mit Rissen", MASTERPROMPT §10 "Schnee und Eis"): three kinds of ice share one look
 * in the water pass – plates of `ICE.color` crossed by a crack network (dark core, bright lip; world-anchored, so the
 * cracks stay put under the camera), a faint mirror of the sky, and over deep water a glimpse of its blue:
 * - **frozen water** (the world's `WATER_FROZEN` tiles, which the terrain draws with the `eis` tileset),
 * - **glacier ice** (the `eis` ground of the Frostkamm, material `eis` in the G-buffer),
 * - **shore ice**: in hard frost thin ice grows from the banks over open water, the wider the colder (`shoreIcePx`).
 *   It is presentation only – thin ice at the rim of a lake that the game does not walk on; lakes that freeze over
 *   and carry the player are the world's frozen tiles (M8-36).
 */
import { ICE } from './params';

/** Width of the shore ice at air temperature `tempC` [px]: none above `ICE.freezeC`, `ICE.maxShorePx` at `ICE.hardFreezeC` and below. */
export function shoreIcePx(tempC: number): number {
  if (!Number.isFinite(tempC) || tempC >= ICE.freezeC) return 0;
  const t = Math.min(1, (ICE.freezeC - tempC) / (ICE.freezeC - ICE.hardFreezeC));
  return t * ICE.maxShorePx;
}
