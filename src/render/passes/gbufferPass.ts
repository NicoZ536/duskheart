/**
 * G-buffer pass (MASTERPROMPT §6.1 pass 2): clears the three attachments, draws the ground
 * geometry (`scene.ground`, e.g. chunk meshes) and then the sprite layers in painter's order –
 * ground → water mask → y-sorted objects → roofs/canopy (with the dither see-through circle around
 * the player). One instanced draw call per non-empty layer.
 */
import { snapToPixel } from '../camera';
import { GBUFFER_CLEAR } from '../gbuffer';

const GBUFFER_ZERO: readonly number[] = [0, 0, 0, 0];
import { LAYER_COUNT } from '../batch/spriteLayout';
import { brightestPaletteIndex } from '../palette/lut';
import { PALETTE_HEX } from '../../generated/palette';
import type { FrameSize, RenderContext, RenderPass } from './registry';

/** Texture units of the sprite pass. */
const UNIT_ALBEDO = 0;
const UNIT_NORMAL = 1;
const UNIT_LUT = 2;

export class GBufferPass implements RenderPass {
  readonly name = 'gbuffer';
  enabled = true;
  /** The hit flash shows the palette's brightest colour. */
  private readonly flashIndex = brightestPaletteIndex(PALETTE_HEX);

  resize(_size: FrameSize): void {
    // The G-buffer target is owned and resized by the renderer.
  }

  execute(ctx: RenderContext): void {
    const gl = ctx.gl;
    const target = ctx.targets.gbuffer;
    target.bind();
    for (let i = 0; i < GBUFFER_CLEAR.length; i++) gl.clearBufferfv(gl.COLOR, i, GBUFFER_CLEAR[i] ?? GBUFFER_ZERO);
    const ground = ctx.scene.ground;
    for (let i = 0; i < ground.length; i++) ground[i]?.drawGBuffer(ctx);
    const atlas = ctx.atlas;
    const batch = ctx.sprites;
    if (atlas === null || batch.size === 0) return;
    const prog = batch.program;
    if (!prog.use()) return;
    const f = ctx.frame;
    const scene = ctx.scene;
    gl.uniform2f(prog.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(prog.uniform('uTargetSize'), f.width, f.height);
    gl.uniform2f(prog.uniform('uWind'), scene.env.wind, f.time);
    const fadeX = snapToPixel(scene.fadeX) - f.camera.originX;
    const fadeY = snapToPixel(scene.fadeY) - f.camera.originY;
    gl.uniform3f(prog.uniform('uFade'), fadeX, fadeY, scene.fadeRadius);
    gl.uniform1i(prog.uniform('uFlashIndex'), this.flashIndex);
    atlas.albedo.bind(UNIT_ALBEDO);
    atlas.normal.bind(UNIT_NORMAL);
    ctx.palette.texture.bind(UNIT_LUT);
    gl.uniform1i(prog.uniform('uAtlasAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(prog.uniform('uAtlasNormal'), UNIT_NORMAL);
    gl.uniform1i(prog.uniform('uPaletteLut'), UNIT_LUT);
    const layerLoc = prog.uniform('uLayer');
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      gl.uniform1i(layerLoc, layer);
      const calls = batch.drawLayer(layer);
      ctx.stats.drawCalls += calls;
      ctx.stats.spriteDrawCalls += calls;
    }
  }
}
