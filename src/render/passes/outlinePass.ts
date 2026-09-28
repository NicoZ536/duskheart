/**
 * Interaction outline (MASTERPROMPT §4.6 "1-px-Outline in Akzentfarbe (Shader)", §6.2; M5-24): sprites with the
 * `outline` flag mark their pixels in the G-buffer; this pass draws the accent colour on every unmarked pixel next to a
 * marked one – around the silhouette of the whole figure (body and equipment together), on top of the final image. A
 * glint of the accent's lighter step runs diagonally along it, anchored to the world (`SURFACE_PARAMS.effects`); with
 * the accessibility option "Reduzierte Bewegung" it stands still.
 */
import { PALETTE_HEX, UI_HEX } from '../../generated/palette';
import type { ShaderProgram } from '../gl/shaders';
import { GBUFFER_EMISSIVE } from '../gbuffer';
import { nearestPaletteIndex } from '../palette/lut';
import { lighterIndices } from '../world/shading';
import { surfaceDefines } from '../surface/params';
import { surfaceFrameOf } from '../surface/frame';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Palette index (1…64) of the outline's accent and of its glint (one step lighter in the accent's ramp). */
export function outlineColors(): { accent: number; glint: number } {
  const accent = nearestPaletteIndex(PALETTE_HEX, UI_HEX.akzent);
  return { accent, glint: lighterIndices()[accent - 1] ?? accent };
}

export class OutlinePass implements RenderPass {
  readonly name = 'outline';
  enabled = true;
  private program: ShaderProgram | null = null;
  private readonly colors = outlineColors();
  /** Origin, target size and time of the frame as a typed array (`uniform*fv`: no boxed number per frame). */
  private readonly uniforms = new Float32Array(5);

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'outline', vertex: 'fullscreen.vert', fragment: 'outline.frag', defines: surfaceDefines() });
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's LDR target.
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || ctx.scene.sprites.count === 0 || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    ctx.targets.ldr.bind();
    ctx.targets.gbuffer.texture(GBUFFER_EMISSIVE).bind(0);
    ctx.palette.texture.bind(1);
    gl.uniform1i(p.uniform('uMask'), 0);
    gl.uniform1i(p.uniform('uPaletteLut'), 1);
    gl.uniform1i(p.uniform('uAccentIndex'), this.colors.accent);
    gl.uniform1i(p.uniform('uGlintIndex'), this.colors.glint);
    const u = this.uniforms;
    u[0] = f.camera.originX;
    u[1] = f.camera.originY;
    u[2] = f.width;
    u[3] = f.height;
    // Reduced motion: the glint stands where it is at time 0.
    u[4] = surfaceFrameOf(gl).settings.motionScale < 1 ? 0 : f.time;
    gl.uniform2fv(p.uniform('uOrigin'), u, 0, 2);
    gl.uniform2fv(p.uniform('uTargetSize'), u, 2, 2);
    gl.uniform1fv(p.uniform('uTime'), u, 4, 1);
    ctx.drawFullscreen();
  }
}
