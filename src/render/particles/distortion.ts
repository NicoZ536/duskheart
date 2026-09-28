/**
 * Who draws the heat shimmer of `scene.particles.distortion` (M5-21, docs/RENDER.md §4), so the effect is never lost and
 * never doubled:
 * - a pass that reads the list itself claims it for its renderer with `claimHeatShimmer(passes)`;
 * - while the post chain's distortion pass (M5-13, `POST_DISTORTION_PASS`) runs, the particle strand's `heat-shimmer`
 *   pass hands every column to its buffer as a heat area (`forwardHeat` into `scene.post.distortion`);
 * - otherwise the `heat-shimmer` pass displaces the picture itself (`shimmer.ts`).
 */
import type { PassRegistry } from '../passes/registry';
import type { DistortionList } from './sceneParticles';

/** Name of the post chain's distortion pass (M5-13), which draws heat areas into its offset field. */
export const POST_DISTORTION_PASS = 'distortion';

/** What the post chain's distortion list takes: a heat area around world px (x, y) with half axes (rx, ry). */
export interface HeatAreaSink {
  heat(x: number, y: number, rx: number, ry: number, strength: number): number;
}

/**
 * Hands every column of hot air of `list` to `sink` as a heat area: the ellipse over the column – centred half its
 * height above its foot (which stands `z` px over its ground point), as wide and as high as the column.
 */
export function forwardHeat(list: DistortionList, sink: HeatAreaSink): number {
  let n = 0;
  for (let i = 0; i < list.count; i++) {
    const h = list.height[i] as number;
    if (sink.heat(list.x[i] as number, (list.y[i] as number) - (list.z[i] as number) - h / 2, (list.width[i] as number) / 2, h / 2, list.strength[i] as number) >= 0) n++;
  }
  return n;
}

const claimed = new WeakSet<PassRegistry>();

/** The post chain of `passes` takes over the heat shimmer (the particle strand's own pass stops drawing it). */
export function claimHeatShimmer(passes: PassRegistry): void {
  claimed.add(passes);
}

/** Whether another pass of `passes` draws the heat shimmer. */
export function heatShimmerClaimed(passes: PassRegistry): boolean {
  return claimed.has(passes);
}
