/**
 * Interaction outline (MASTERPROMPT §4.6 "1-px-Outline in Akzentfarbe (Shader)"): sprites with the
 * `outline` flag mark their pixels in the G-buffer; this pass draws the accent colour on every
 * unmarked pixel next to a marked one – around the silhouette of the whole figure (body and
 * equipment together), on top of the final image.
 */
import { PALETTE_HEX, UI_HEX } from '../../generated/palette';
import type { ShaderProgram } from '../gl/shaders';
import { GBUFFER_EMISSIVE } from '../gbuffer';
import { nearestPaletteIndex } from '../palette/lut';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

export class OutlinePass implements RenderPass {
  readonly name = 'outline';
  enabled = true;
  private program: ShaderProgram | null = null;
  /** Palette colour closest to the UI accent colour. */
  private readonly accentIndex = nearestPaletteIndex(PALETTE_HEX, UI_HEX.akzent);

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'outline', vertex: 'fullscreen.vert', fragment: 'outline.frag' });
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's LDR target.
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || ctx.scene.sprites.count === 0 || !p.use()) return;
    const gl = ctx.gl;
    ctx.targets.ldr.bind();
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(0);
    ctx.palette.texture.bind(1);
    gl.uniform1i(p.uniform('uMask'), 0);
    gl.uniform1i(p.uniform('uPaletteLut'), 1);
    gl.uniform1i(p.uniform('uAccentIndex'), this.accentIndex);
    ctx.drawFullscreen();
  }
}
