/**
 * Bloom (MASTERPROMPT §6.1 pass 9 "Bloom (Schwelle, 4 Stufen, interne Auflösung)", M5-13): the bright
 * part of the HDR scene (above `BLOOM.threshold`, soft knee) glows over its surroundings.
 *
 * Four levels at 1/2, 1/4, 1/8 and 1/16 of the internal resolution (computed from the internal target,
 * never from the screen): bright pass into level 0, dual-filter steps down to level 3, tent steps back
 * up, each adding the level's own light – then the glow is added over the scene, read from a copy of the
 * HDR target and written into it (no blending: the same result with float targets and the RGBA8
 * fallback, whose levels store HDR / 4 like the target). Colours at full daylight (≤ 1) never glow.
 * The setting `graphics.bloom` switches it (`configure`).
 */
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from '../post/settings';
import type { PostShared } from '../post/shared';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/**
 * Bloom look: threshold and knee (HDR; threshold − knee ≥ 1), strength of the glow over the scene,
 * steps of its quantisation (fine: a soft glow with Bayer seams), number of levels.
 */
export const BLOOM = { threshold: 1.3, knee: 0.25, intensity: 0.8, steps: 32, levels: 4 } as const;

const UNIT_A = 0;
const UNIT_B = 1;

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the bloom shaders. */
export function bloomDefines(): Readonly<Record<string, string>> {
  return {
    DH_BLOOM_THRESHOLD: glslFloat(BLOOM.threshold),
    DH_BLOOM_KNEE: glslFloat(BLOOM.knee),
    DH_BLOOM_STEPS: glslFloat(BLOOM.steps),
  };
}

/**
 * Share of a colour whose brightest channel is `peak` that glows (mirror of `bloomShare` in
 * bloom_bright.frag): 0 up to threshold − knee (≥ 1: colours at full daylight never glow), a quadratic
 * knee, then everything above the threshold.
 */
export function bloomShare(peak: number): number {
  const k = BLOOM.knee;
  const soft0 = Math.max(0, Math.min(2 * k, peak - BLOOM.threshold + k));
  const soft = (soft0 * soft0) / (4 * k);
  return Math.max(soft, peak - BLOOM.threshold) / Math.max(peak, 0.0001);
}

/** Size of bloom level `level` (0 = half) for a target of `width` × `height`. */
export function bloomLevelSize(width: number, height: number, level: number): [number, number] {
  const div = 2 ** (level + 1);
  return [Math.max(1, Math.ceil(width / div)), Math.max(1, Math.ceil(height / div))];
}

export class BloomPass implements RenderPass {
  readonly name = 'bloom';
  enabled = DEFAULT_ATMOSPHERE_POST_SETTINGS.bloom;
  private readonly down: RenderTarget[] = [];
  private readonly up: RenderTarget[] = [];
  private brightProgram: ShaderProgram | null = null;
  private downProgram: ShaderProgram | null = null;
  private upProgram: ShaderProgram | null = null;
  private compositeProgram: ShaderProgram | null = null;
  /** 1 / size of each down level and the size of each up level, kept from `resize` (no arithmetic per frame). */
  private readonly texel: Float32Array[] = Array.from({ length: BLOOM.levels }, () => new Float32Array(2));
  private readonly levelSize: Float32Array[] = Array.from({ length: BLOOM.levels }, () => new Float32Array(2));
  private readonly sourceMax = new Int32Array(2);

  constructor(private readonly shared: PostShared) {}

  configure(settings: AtmospherePostSettings): void {
    this.enabled = settings.bloom;
  }

  /** The glow of the last frame (level 0 after the up steps), null before `init`. */
  get texture(): Texture2D | null {
    return this.up[0]?.texture(0) ?? null;
  }

  /** Sizes of the four down levels (tests). */
  get levelSizes(): readonly (readonly [number, number])[] {
    return this.down.map((t) => [t.width, t.height] as const);
  }

  init(setup: PassSetup): void {
    this.shared.acquire(setup);
    const make = (label: string): RenderTarget =>
      setup.resources.add(new RenderTarget(setup.gl, { label, width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA16F', filter: 'linear' }], floatTargets: setup.caps.floatTargets }));
    for (let i = 0; i < BLOOM.levels; i++) this.down.push(make(`bloom-down-${i}`));
    for (let i = 0; i < BLOOM.levels - 1; i++) this.up.push(make(`bloom-up-${i}`));
    const defines = bloomDefines();
    this.brightProgram = setup.shaders.program({ name: 'bloom-bright', vertex: 'fullscreen.vert', fragment: 'bloom_bright.frag', defines });
    this.downProgram = setup.shaders.program({ name: 'bloom-down', vertex: 'fullscreen.vert', fragment: 'bloom_down.frag', defines });
    this.upProgram = setup.shaders.program({ name: 'bloom-up', vertex: 'fullscreen.vert', fragment: 'bloom_up.frag', defines });
    this.compositeProgram = setup.shaders.program({ name: 'bloom-composite', vertex: 'fullscreen.vert', fragment: 'bloom_composite.frag', defines });
  }

  resize(size: FrameSize): void {
    for (let i = 0; i < this.down.length; i++) {
      const [w, h] = bloomLevelSize(size.width, size.height, i);
      this.down[i]?.resize(w, h);
      this.up[i]?.resize(w, h);
      this.texel[i]?.set([1 / w, 1 / h]);
      this.levelSize[i]?.set([w, h]);
    }
    this.sourceMax.set([size.width - 1, size.height - 1]);
    this.shared.resize(size);
  }

  execute(ctx: RenderContext): void {
    const bright = this.brightProgram;
    const downP = this.downProgram;
    const upP = this.upProgram;
    const comp = this.compositeProgram;
    const last = this.down.length - 1;
    if (bright === null || downP === null || upP === null || comp === null || last < 1) return;
    const gl = ctx.gl;
    const hdr = ctx.targets.hdr;
    // Level 0: the bright part at half resolution.
    if (!bright.use()) return;
    const l0 = this.down[0] as RenderTarget;
    l0.bind();
    hdr.texture(0).bind(UNIT_A);
    gl.uniform1i(bright.uniform('uHdr'), UNIT_A);
    gl.uniform2iv(bright.uniform('uSourceMax'), this.sourceMax);
    ctx.drawFullscreen();
    // Down to level 3.
    if (!downP.use()) return;
    gl.uniform1i(downP.uniform('uSource'), UNIT_A);
    for (let i = 1; i <= last; i++) {
      const src = this.down[i - 1] as RenderTarget;
      const dst = this.down[i] as RenderTarget;
      dst.bind();
      src.texture(0).bind(UNIT_A);
      gl.uniform2fv(downP.uniform('uSourceTexel'), this.texel[i - 1] as Float32Array);
      ctx.drawFullscreen();
    }
    // Up to level 0, each step adding the level's own light.
    if (!upP.use()) return;
    gl.uniform1i(upP.uniform('uLower'), UNIT_A);
    gl.uniform1i(upP.uniform('uSame'), UNIT_B);
    for (let i = last - 1; i >= 0; i--) {
      // The level below has the size of level i + 1 (a down level or the up level of the same size).
      const lower = i === last - 1 ? (this.down[last] as RenderTarget) : (this.up[i + 1] as RenderTarget);
      const dst = this.up[i] as RenderTarget;
      dst.bind();
      lower.texture(0).bind(UNIT_A);
      (this.down[i] as RenderTarget).texture(0).bind(UNIT_B);
      gl.uniform2fv(upP.uniform('uLowerTexel'), this.texel[i + 1] as Float32Array);
      gl.uniform2fv(upP.uniform('uSize'), this.levelSize[i] as Float32Array);
      ctx.drawFullscreen();
    }
    // The glow over the scene.
    const copy = this.shared.copyHdr(ctx);
    if (copy === null || !comp.use()) return;
    const f = ctx.frame;
    const glow = this.up[0] as RenderTarget;
    copy.bind(UNIT_A);
    glow.texture(0).bind(UNIT_B);
    gl.uniform1i(comp.uniform('uScene'), UNIT_A);
    gl.uniform1i(comp.uniform('uBloom'), UNIT_B);
    gl.uniform2fv(comp.uniform('uBloomSize'), this.levelSize[0] as Float32Array);
    gl.uniform1f(comp.uniform('uIntensity'), BLOOM.intensity);
    gl.uniform2f(comp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(comp.uniform('uTargetSize'), f.width, f.height);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    for (const t of this.down) setup.resources.remove(t);
    for (const t of this.up) setup.resources.remove(t);
    this.down.length = 0;
    this.up.length = 0;
    for (const p of [this.brightProgram, this.downProgram, this.upProgram, this.compositeProgram]) if (p !== null) setup.shaders.release(p);
    this.brightProgram = null;
    this.downProgram = null;
    this.upProgram = null;
    this.compositeProgram = null;
    this.shared.release(setup);
  }
}
