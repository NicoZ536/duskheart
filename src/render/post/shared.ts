/**
 * GPU resources the atmosphere and post passes share (M5-10 … M5-22): the tiling noise texture
 * (`noise.ts`) and a scratch copy of the HDR target for passes that rewrite the lit scene in place
 * (corruption, bloom composite: read the copy, write the target – no feedback loop, no blending, works
 * the same with float targets and the RGBA8 fallback). Created through the pass setup on first use, so a
 * context loss restores them; released when the last pass that uses them is removed.
 */
import { RenderTarget } from '../gl/framebuffer';
import { Texture2D } from '../gl/texture';
import type { FrameSize, PassSetup, RenderContext } from '../passes/registry';
import { buildNoiseTexels, NOISE_SIZE } from './noise';

/** The noise texels, built once per page (≈ 40 ms). */
let noiseTexels: Uint8Array | null = null;

export class PostShared {
  private users = 0;
  private noiseTexture: Texture2D | null = null;
  private scratchTarget: RenderTarget | null = null;
  private size: FrameSize | null = null;

  /** Registers a user; the first creates the resources. */
  acquire(setup: PassSetup): void {
    if (this.users++ > 0) return;
    noiseTexels ??= buildNoiseTexels();
    this.noiseTexture = setup.resources.add(new Texture2D(setup.gl, { label: 'post-noise', width: NOISE_SIZE, height: NOISE_SIZE, format: 'RGBA8', filter: 'linear', wrap: 'repeat', pixels: noiseTexels }));
    this.scratchTarget = setup.resources.add(
      new RenderTarget(setup.gl, { label: 'hdr-copy', width: this.size?.width ?? 1, height: this.size?.height ?? 1, attachments: [{ name: 'color', format: 'RGBA16F' }], floatTargets: setup.caps.floatTargets }),
    );
  }

  /** Unregisters a user; the last releases the resources. */
  release(setup: PassSetup): void {
    if (this.users === 0 || --this.users > 0) return;
    if (this.noiseTexture !== null) setup.resources.remove(this.noiseTexture);
    if (this.scratchTarget !== null) setup.resources.remove(this.scratchTarget);
    this.noiseTexture = null;
    this.scratchTarget = null;
  }

  resize(size: FrameSize): void {
    this.size = size;
    this.scratchTarget?.resize(size.width, size.height);
  }

  /** The noise tile (null before the first `acquire`). */
  get noise(): Texture2D | null {
    return this.noiseTexture;
  }

  /**
   * Copies the frame's HDR target into the scratch target (one blit) and binds the HDR target for
   * drawing again; returns the copy, or null without resources.
   */
  copyHdr(ctx: RenderContext): Texture2D | null {
    const scratch = this.scratchTarget;
    if (scratch === null) return null;
    const gl = ctx.gl;
    const hdr = ctx.targets.hdr;
    const w = hdr.width;
    const h = hdr.height;
    if (scratch.width !== w || scratch.height !== h) scratch.resize(w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.handle);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scratch.handle);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    hdr.bind();
    return scratch.texture(0);
  }
}
