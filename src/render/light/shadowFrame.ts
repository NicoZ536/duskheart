/**
 * Where the sun and moon silhouettes live and which casters feed them (M5-02; M5 review Minor 1: shadows popped at the
 * view's edges). A receiver looks up its shadow where its own point projects onto the ground plane along the shadow
 * vector – `ground + direction · length · z` –, so the silhouette target has to reach that far beyond the view on the side
 * the shadows fall to, and further south by the G-buffer's height range (the ground points of the view's tallest
 * pixels lie below it); and the view pushes casters that far beyond itself on the side the sun shines from, so a tree
 * outside the picture still throws its evening shadow into it.
 *
 * Pure functions of the frame (tests: tests/unit/render/schatten-rand.test.ts); the shadow pass and the game view use them.
 */
import { GBUFFER_HEIGHT_RANGE_PX } from '../gbuffer';
import { SUN_SHADOW } from './params';

/** Shadow length the renderer draws for the calendar's `length` (capped: the horizon's shadows would cross the view). */
export function drawnShadowLength(length: number): number {
  return Math.max(0, Math.min(SUN_SHADOW.maxLength, length));
}

/**
 * How far a receiver's lookup can lie from its ground point along the shadow direction [px]: the longest drawn shadow of
 * the highest receiver the G-buffer holds.
 */
export const SHADOW_LOOKUP_REACH_PX = Math.ceil(SUN_SHADOW.maxLength * GBUFFER_HEIGHT_RANGE_PX);

/**
 * Size of the silhouette target for a frame of `width` × `height` px with the occluder pass's `margin` [px]: the frame and
 * its margin, `SHADOW_LOOKUP_REACH_PX` on the side the shadows fall to (placed per frame by `shadowTargetOrigin`) and the
 * height range further south (ground points below the view).
 */
export function shadowTargetSize(width: number, height: number, margin: number): { width: number; height: number } {
  return { width: width + 2 * margin + SHADOW_LOOKUP_REACH_PX, height: height + 2 * margin + GBUFFER_HEIGHT_RANGE_PX + SHADOW_LOOKUP_REACH_PX };
}

/**
 * World px of the silhouette target's top-left corner for the view whose top-left is (originX, originY): the reach lies
 * on the side the shadows fall to (direction `shadowX`, `shadowY`, +y south) – west of the view when they fall west,
 * north when they fall north, else east and south. Writes `out[0]`, `out[1]`.
 */
export function shadowTargetOrigin(originX: number, originY: number, margin: number, shadowX: number, shadowY: number, out: Float32Array): Float32Array {
  out[0] = originX - margin - (shadowX < 0 ? SHADOW_LOOKUP_REACH_PX : 0);
  out[1] = originY - margin - (shadowY < 0 ? SHADOW_LOOKUP_REACH_PX : 0);
  return out;
}

/** How far beyond the view casters are pushed on each side [px] (`casterReach`). */
export interface CasterReach {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far beyond the view the casters of a sun shadow with direction (`shadowX`, `shadowY`) and calendar length `length`
 * stand whose silhouettes still reach into it, for casters up to `height` px tall: against the shadow direction by the
 * drawn length of the tallest caster (shadows falling east: casters west of the view).
 */
export function casterReach(shadowX: number, shadowY: number, length: number, height: number, out: CasterReach): CasterReach {
  const reach = drawnShadowLength(length) * height;
  out.left = shadowX > 0 ? shadowX * reach : 0;
  out.right = shadowX < 0 ? -shadowX * reach : 0;
  out.top = shadowY > 0 ? shadowY * reach : 0;
  out.bottom = shadowY < 0 ? -shadowY * reach : 0;
  return out;
}
