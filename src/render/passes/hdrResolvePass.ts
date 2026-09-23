/**
 * HDR → LDR resolve (decode + clamp). The post chain (bloom, grading, tonemapping) replaces it by
 * disabling it (`passes.setEnabled('resolve', false)`) and writing `ctx.targets.ldr` itself.
 */
import type { ShaderProgram } from '../gl/shaders';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

export class HdrResolvePass implements RenderPass {
  readonly name = 'resolve';
  enabled = true;
  private program: ShaderProgram | null = null;

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'hdr-resolve', vertex: 'fullscreen.vert', fragment: 'hdr_resolve.frag' });
  }

  resize(_size: FrameSize): void {
    // Reads the HDR target and writes the LDR target, both owned by the renderer.
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || !p.use()) return;
    ctx.targets.ldr.bind();
    ctx.targets.hdr.texture(0).bind(0);
    ctx.gl.uniform1i(p.uniform('uHdr'), 0);
    ctx.drawFullscreen();
  }
}
