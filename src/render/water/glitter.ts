/**
 * CPU mirrors of the sun glitter's scalar functions in `water_surface.frag` (`sunSeen`, `glitterPath`; parameters
 * `GLITTER` in `params.ts`), for the tests: how much of the sun reaches a water pixel, read from its light, and the
 * weight of the sun's mirror path around its mirror point.
 */
import { GLITTER } from './params';

/**
 * How much of the sun reaches a water pixel whose light (lit colour over albedo, luminance) is `light`, under a daylight
 * of luminance `level` of which `share` comes from the sun: 0 in full shade (only the sky part reaches it), 1 in full
 * sun (`sunSeen`).
 */
export function sunSeen(light: number, level: number, share: number): number {
  if (share <= 0 || level <= 0) return 0;
  return Math.min(1, Math.max(0, (light / level - (1 - share)) / share));
}

/**
 * Weight 0…1 of the sun's mirror path at (`dx`, `dy`) px from its mirror point (y towards the viewer): an oval over
 * `len` px towards the viewer, `halfWidth` px wide at its near end and `GLITTER.startWidth` of that at the mirror point
 * (`glitterPath`).
 */
export function glitterPath(dx: number, dy: number, len: number, halfWidth: number): number {
  if (len <= 0 || halfWidth <= 0) return 0;
  const along = dy / len;
  if (along <= 0 || along >= 1) return 0;
  const across = dx / (halfWidth * (GLITTER.startWidth + (1 - GLITTER.startWidth) * along));
  const middle = 2 * along - 1;
  return Math.min(1, Math.max(0, 1 - across * across - middle * middle));
}
