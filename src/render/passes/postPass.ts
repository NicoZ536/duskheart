/**
 * Post chain, last step (MASTERPROMPT §6.1 pass 9, M1-19 "Post-Kette als Gerüst … Tonemapping"):
 * HDR → LDR with exposure and tonemapping. The chain itself is the pass registry: later post
 * effects (distortion, bloom, grading LUTs, vignette, grain) register between
 * `PASS_ORDER.atmosphere` and this pass and work on the HDR target; this pass always closes it.
 *
 * On the tonemapped colours it lays the player's picture-wide state effects (§6.1 "Zustandseffekte",
 * `RenderScene.post`; M3-20): the eyelids of a blink close from the top and the bottom (§11.1 "Müde …
 * Lidschlag-Effekt"), frost creeps in from the edges of a freezing player's picture (§11.2 "Unterkühlt …
 * Frostrand") – both on whole internal pixels with a Bayer-dithered edge, so they stay pixel art.
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

/** Rows of the dithered eyelid edge [px]. */
export const LID_SOFT_PX = 3;
/** How far frost reaches in from the edges at full strength [px], and how much of its colour it lays over the picture. */
export const FROST_REACH_PX = 44;
export const FROST_MIX = 0.6;

/**
 * Whether the eyelids cover a pixel `dist` rows from the nearer top or bottom edge of a picture
 * `height` rows high at closure `lid`, with Bayer threshold `bayer` (mirror of `lidCovers` in post.glsl).
 * At closure 1 even the dithered edge has passed the middle: shut lids cover the whole picture.
 */
export function lidCovers(dist: number, height: number, lid: number, bayer: number): boolean {
  const lidPx = Math.max(0, Math.min(1, lid)) * (height / 2 + LID_SOFT_PX);
  const t = Math.max(0, Math.min(1, (lidPx - dist) / LID_SOFT_PX));
  return t > bayer;
}

/** Frost share 0–1 of a pixel `dist` px from the nearest edge at strength `frost` (before the crystal pattern; mirror of `frostShare`). */
export function frostShare(dist: number, frost: number): number {
  const reach = FROST_REACH_PX * Math.max(0, Math.min(1, frost));
  if (reach <= 0) return 0;
  const m = Math.max(0, Math.min(1, 1 - dist / reach));
  return m * m;
}

/** GLSL float literal. */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the post programs. */
export function postDefines(): Readonly<Record<string, string>> {
  return {
    DH_TONEMAP_WHITE: glslFloat(TONEMAP_WHITE),
    DH_LID_SOFT_PX: glslFloat(LID_SOFT_PX),
    DH_FROST_REACH_PX: glslFloat(FROST_REACH_PX),
    DH_FROST_MIX: glslFloat(FROST_MIX),
  };
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
    const f = ctx.frame;
    ctx.gl.uniform4f(p.uniform('uView'), (f.width - f.viewWidth) / 2, (f.height - f.viewHeight) / 2, f.viewWidth, f.viewHeight);
    ctx.gl.uniform1f(p.uniform('uLid'), ctx.scene.post.lid);
    ctx.gl.uniform1f(p.uniform('uFrost'), ctx.scene.post.frost);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    this.program = null;
    if (this.replaces) this.replaces.enabled = true;
  }
}
