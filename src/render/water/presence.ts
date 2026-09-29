/**
 * Whether a frame can show water (M5 integration, MASTERPROMPT §30): a water pixel of the G-buffer (`DH_MASK_WATER`)
 * comes from the world terrain's water tiles or from a sprite on the water layer (the M1 ponds). The water pass draws
 * nothing in a frame without one, and the occluder pass floods no water field then (its only reader is the water pass;
 * the render debugger's `sdf` view shows the frame, where every texel is land and its own seed anyway) – on a software
 * rasteriser (SwiftShader, the E2E browser) every full-screen texel costs, taken branch or not.
 */
import { LAYER } from '../batch/spriteLayout';
import type { RenderContext } from '../passes/registry';

/**
 * Whether the G-buffer of the frame can hold a water pixel: sprites on the water layer; with the water strand's tile
 * grid of the view (`scene.water.tiles.known`, the game view) water or ice tiles or a figure in water; without it (M1/M2
 * debug scenes) a ground that may draw water (`GBufferDrawable.drawsWater` not `false`).
 */
export function frameMayShowWater(ctx: RenderContext): boolean {
  if (ctx.sprites.layerCount(LAYER.water) > 0) return true;
  const water = ctx.scene.water;
  const tiles = water.tiles;
  if (tiles.known) return tiles.waterTiles + tiles.frozenTiles > 0 || water.immersions.count > 0;
  const ground = ctx.scene.ground;
  for (let i = 0; i < ground.length; i++) if (ground[i]?.drawsWater !== false) return true;
  return false;
}
