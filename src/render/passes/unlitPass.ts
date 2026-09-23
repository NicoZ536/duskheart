/**
 * Unlit composition: the G-buffer albedo (or the background colour) into the HDR target. It keeps
 * the pipeline complete before the light and composition passes exist; those disable it
 * (`passes.setEnabled('unlit', false)`) when they take over the HDR target.
 */
import { parseHexColor } from '../palette/lut';
import { PALETTE_HEX } from '../../generated/palette';
import type { ShaderProgram } from '../gl/shaders';
import { GBUFFER_ALBEDO } from '../gbuffer';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

const BYTE_MAX = 255;

const RGB = 3;

/** Palette colours as linear 0…1 RGB triples (index 1 at offset 0), parsed once. */
function paletteRgb(): Float32Array {
  const out = new Float32Array(PALETTE_HEX.length * RGB);
  PALETTE_HEX.forEach((hex, i) => parseHexColor(hex).forEach((v, c) => (out[i * RGB + c] = v / BYTE_MAX)));
  return out;
}

export class UnlitPass implements RenderPass {
  readonly name = 'unlit';
  enabled = true;
  private program: ShaderProgram | null = null;
  private readonly colors = paletteRgb();

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'unlit', vertex: 'fullscreen.vert', fragment: 'unlit.frag' });
  }

  resize(_size: FrameSize): void {
    // Draws straight into the renderer's HDR target; nothing of its own to resize.
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || !p.use()) return;
    const gl = ctx.gl;
    ctx.targets.hdr.bind();
    ctx.targets.gbuffer.texture(GBUFFER_ALBEDO).bind(0);
    gl.uniform1i(p.uniform('uAlbedo'), 0);
    const o = Math.max(0, Math.min(PALETTE_HEX.length - 1, ctx.scene.env.background - 1)) * RGB;
    const c = this.colors;
    gl.uniform3f(p.uniform('uBackground'), c[o] ?? 0, c[o + 1] ?? 0, c[o + 2] ?? 0);
    ctx.drawFullscreen();
  }
}
