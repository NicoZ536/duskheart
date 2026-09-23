/**
 * Post chain, last step (MASTERPROMPT §6.1 pass 9, M1-19 "Post-Kette als Gerüst … Tonemapping"):
 * HDR → LDR with exposure and tonemapping. The chain itself is the pass registry: later post
 * effects (distortion, bloom, grading LUTs, state effects, vignette, grain) register between
 * `PASS_ORDER.atmosphere` and this pass and work on the HDR target; this pass always closes it.
 *
 * Tonemapping is the identity up to 1 – palette colours under full light reach the screen exactly –
 * with a hue-preserving shoulder above (see `tonemap`). The post pass replaces the renderer's plain
 * HDR resolve: while it is enabled `resolve` is off, switching it off brings the resolve back.
 */
import type { ShaderProgram } from '../gl/shaders';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** How far overexposed colours move towards white (0 = pure hue-preserving clip, 1 = white at infinity). */
export const TONEMAP_WHITE = 0.6;
/** Exposure of the scene (1 = palette colours under full light unchanged). */
export const DEFAULT_EXPOSURE = 1;

/** Share of white mixed into a colour whose brightest channel is `peak` (`tonemapWhite` in post.glsl). */
export function tonemapWhite(peak: number): number {
  return peak <= 1 ? 0 : (1 - 1 / peak) * TONEMAP_WHITE;
}

/**
 * The tonemapping curve of `post.glsl` on one colour (TypeScript mirror for tests): identity while
 * every channel is ≤ 1; above, the hue is kept (brightest channel 1) and the colour rises towards
 * white with the overexposure. Writes into `out` and returns it.
 */
export function tonemap(r: number, g: number, b: number, out: [number, number, number]): [number, number, number] {
  const cr = Math.max(0, r);
  const cg = Math.max(0, g);
  const cb = Math.max(0, b);
  const peak = Math.max(cr, cg, cb);
  if (peak <= 1) {
    out[0] = cr;
    out[1] = cg;
    out[2] = cb;
    return out;
  }
  const w = tonemapWhite(peak);
  out[0] = cr / peak + (1 - cr / peak) * w;
  out[1] = cg / peak + (1 - cg / peak) * w;
  out[2] = cb / peak + (1 - cb / peak) * w;
  return out;
}

/** `#define`s of the post programs. */
export function postDefines(): Readonly<Record<string, string>> {
  return { DH_TONEMAP_WHITE: Number.isInteger(TONEMAP_WHITE) ? TONEMAP_WHITE.toFixed(1) : String(TONEMAP_WHITE) };
}

export class PostPass implements RenderPass {
  readonly name = 'post';
  exposure = DEFAULT_EXPOSURE;
  private on = true;
  private program: ShaderProgram | null = null;

  /** @param replaces the plain HDR resolve this pass stands in for (off while this pass is on) */
  constructor(private readonly replaces: RenderPass | undefined) {
    this.enabled = true;
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    if (this.replaces) this.replaces.enabled = !on;
  }

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'post-tonemap', vertex: 'fullscreen.vert', fragment: 'post_tonemap.frag', defines: postDefines() });
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
    ctx.gl.uniform1f(p.uniform('uExposure'), this.exposure);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    this.program = null;
    if (this.replaces) this.replaces.enabled = true;
  }
}
