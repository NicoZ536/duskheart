/**
 * Post chain, last step (MASTERPROMPT §6.1 pass 9, M1-19; M5-13 … M5-15): HDR → LDR. The chain itself is
 * the pass registry: the atmosphere (fog, `PASS_ORDER.atmosphere`), the distortion field
 * (`PASS_ORDER.distortion`) and bloom (`PASS_ORDER.bloom`) run before it on the HDR target; this pass
 * always closes it (post_tonemap.frag):
 *
 * 1. reads the picture through the distortion field and the state effects' sway, whole pixels at a time;
 * 2. exposure and tonemapping – the identity up to 1 (palette colours under full light reach the screen
 *    exactly), a hue-preserving shoulder above (`tonemap`);
 * 3. colour grading through the 3D LUT of the frame's grade (`RenderScene.grading`, M5-14), regenerated
 *    from the blended parameters only when they changed noticeably; the colour-blind correction of the
 *    settings is folded into the same LUT (and applies without a grade too);
 * 4. the player's picture-wide state effects (`RenderScene.post`, M5-15, `post/state.ts`), vignette, grain,
 *    the eyelids of a blink and the frost rim (M3-20), and Bayer transitions.
 *
 * Grading, the grade's vignette and grain skip pixels where nothing is drawn: the background stays exact.
 * A scene that fills none of it (the M1 scenes, the world debug scenes) is only tonemapped.
 *
 * The post pass replaces the renderer's plain HDR resolve: while it is enabled `resolve` is off, switching
 * it off brings the resolve back.
 */
import { GBUFFER_ALBEDO } from '../gbuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import { createGrading, generateGradingLut, GRADING_INDEX, GRADING_LUT_BYTES, GRADING_LUT_SIZE, GRADING_PARAM_COUNT, GRADING_REGEN_EPSILON, gradingDistance, isNeutralGrading, type ColorblindMode } from '../post/grading';
import { Texture3D } from '../post/lut3d';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from '../post/settings';
import type { PostShared } from '../post/shared';
import { FEAR_TENDRILS_FROM, fearDrain, fearTendrils, heartbeat, HEARTBEAT_DEPTH } from '../post/state';
import { distortionDefines, type DistortionPass } from './distortionPass';
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
 * Look of the state effects (post.glsl): vignette (inner edge on the 0…1 radial scale, deepest darkening,
 * steps), fear (tendril reach as a share of the picture's short side, noise tile [px], flow [tiles/s], stretch of the
 * noise inwards),
 * low-health rim (inner and outer edge on the radial scale, gain of the rim value, strongest mix) and
 * poison rim (inner edge), intoxication (sway [px], double image offset [px] and share),
 * poison sway [px], heat shimmer at the edges (reach as a share of the height, sway [px]), grain amount
 * (at black) and its steps per second (the pattern changes at this rate, not every frame), the width of a
 * transition's dithered rim (share of the key range).
 */
export const POST_LOOK = {
  vignetteInner: 0.42,
  vignetteDepth: 0.75,
  vignetteSteps: 24,
  fearReach: 0.38,
  fearTile: 150,
  fearFlow: 0.025,
  fearStretch: 4,
  rimInner: 0.38,
  rimOuter: 0.9,
  rimGain: 1.4,
  rimMix: 0.9,
  sickInner: 0.35,
  drunkPx: 2.5,
  drunkGhostPx: 3,
  drunkGhost: 0.3,
  poisonPx: 1.2,
  heatEdgeReach: 0.22,
  heatEdgePx: 1.5,
  grainAmount: 0.05,
  grainRate: 12,
  transitionSeam: 0.16,
} as const;
/** Distinct grain patterns before the seed repeats. */
const GRAIN_PATTERNS = 997;
/** Slow swell of the poison rim [s] and its depth; how much exhaustion adds to the vignette and drains. */
export const POISON_SWELL = { seconds: 2.6, depth: 0.3 } as const;
export const TIRED_LOOK = { vignette: 0.55, drain: 0.2 } as const;
/** Fear's breathing: period [s] and depth of the tendrils' reach. */
export const FEAR_BREATH = { seconds: 4.2, depth: 0.08 } as const;
/** Colour drain at the lowest health (below a quarter of the rim's range). */
export const HURT_DRAIN = { from: 0.75, amount: 0.5 } as const;

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

/**
 * Key of a pixel in a Bayer transition (mirror of `transitionKey` in post.glsl): `radialDistance` 0 in the
 * middle … 1 in the corners, `bayerCell` the Bayer threshold of its 2 × 2 cell. A cover `t` hides the pixels
 * whose key is below it – the corners first, the middle last, a dithered rim between.
 */
export function transitionKey(radialDistance: number, bayerCell: number): number {
  return (1 - Math.min(1, radialDistance)) * (1 - POST_LOOK.transitionSeam) + bayerCell * POST_LOOK.transitionSeam;
}

/** GLSL float literal. */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the post programs. */
export function postDefines(): Readonly<Record<string, string>> {
  return {
    ...distortionDefines(),
    DH_TONEMAP_WHITE: glslFloat(TONEMAP_WHITE),
    DH_LID_SOFT_PX: glslFloat(LID_SOFT_PX),
    DH_FROST_REACH_PX: glslFloat(FROST_REACH_PX),
    DH_FROST_MIX: glslFloat(FROST_MIX),
    DH_LUT_SIZE: glslFloat(GRADING_LUT_SIZE),
    DH_VIGNETTE_INNER: glslFloat(POST_LOOK.vignetteInner),
    DH_VIGNETTE_DEPTH: glslFloat(POST_LOOK.vignetteDepth),
    DH_VIGNETTE_STEPS: glslFloat(POST_LOOK.vignetteSteps),
    DH_FEAR_REACH: glslFloat(POST_LOOK.fearReach),
    DH_FEAR_TILE: glslFloat(POST_LOOK.fearTile),
    DH_FEAR_FLOW: glslFloat(POST_LOOK.fearFlow),
    DH_FEAR_STRETCH: glslFloat(POST_LOOK.fearStretch),
    DH_RIM_INNER: glslFloat(POST_LOOK.rimInner),
    DH_RIM_OUTER: glslFloat(POST_LOOK.rimOuter),
    DH_RIM_GAIN: glslFloat(POST_LOOK.rimGain),
    DH_RIM_MIX: glslFloat(POST_LOOK.rimMix),
    DH_SICK_INNER: glslFloat(POST_LOOK.sickInner),
    DH_DRUNK_PX: glslFloat(POST_LOOK.drunkPx),
    DH_DRUNK_GHOST_PX: glslFloat(POST_LOOK.drunkGhostPx),
    DH_DRUNK_GHOST: glslFloat(POST_LOOK.drunkGhost),
    DH_POISON_PX: glslFloat(POST_LOOK.poisonPx),
    DH_HEAT_EDGE_REACH: glslFloat(POST_LOOK.heatEdgeReach),
    DH_HEAT_EDGE_PX: glslFloat(POST_LOOK.heatEdgePx),
    DH_GRAIN_AMOUNT: glslFloat(POST_LOOK.grainAmount),
    DH_TRANSITION_SEAM: glslFloat(POST_LOOK.transitionSeam),
  };
}

/** What the post pass reads besides the scene (set by the atmosphere/post install, `post/pipeline.ts`). */
export interface PostPassDeps {
  readonly shared: PostShared;
  readonly distortion: DistortionPass;
}

const UNIT_HDR = 0;
const UNIT_ALBEDO = 1;
const UNIT_DISTORTION = 2;
const UNIT_NOISE = 3;
const UNIT_LUT = 4;
const VIGNETTE = GRADING_INDEX.vignette;
/** The neutral grade (the LUT of a colour-blind correction without a grade). */
const NEUTRAL = createGrading();

export class PostPass implements RenderPass {
  readonly name = 'post';
  exposure = DEFAULT_EXPOSURE;
  /** Accessibility: pulses held steady, grain still; scale of every sway (`configure`). */
  steady = DEFAULT_ATMOSPHERE_POST_SETTINGS.steady;
  motionScale = DEFAULT_ATMOSPHERE_POST_SETTINGS.motionScale;
  /** Colour-blind correction folded into the LUT (`configure`). */
  colorblind: ColorblindMode = DEFAULT_ATMOSPHERE_POST_SETTINGS.colorblind;
  private on = true;
  private program: ShaderProgram | null = null;
  private lut: Texture3D | null = null;
  private readonly lutData = new Uint8Array(GRADING_LUT_BYTES);
  /** The grade and the colour-blind correction the LUT holds (NaN / null until the first generation). */
  private readonly lutGrade = new Float32Array(GRADING_PARAM_COUNT).fill(Number.NaN);
  private lutMode: ColorblindMode | null = null;
  private deps: PostPassDeps | null = null;
  /** LUT generations so far (statistics, tests). */
  lutBuilds = 0;
  /** Whether the last frame was graded, and whether it went through the LUT (grade or colour-blind correction). */
  graded = false;
  lutApplied = false;

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

  /** Connects the distortion field and the shared noise (the atmosphere/post install). */
  attach(deps: PostPassDeps | null): void {
    this.deps = deps;
  }

  configure(settings: AtmospherePostSettings): void {
    this.steady = settings.steady;
    this.motionScale = settings.motionScale;
    this.colorblind = settings.colorblind;
  }

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'post-tonemap', vertex: 'fullscreen.vert', fragment: 'post_tonemap.frag', defines: postDefines() });
    this.lut = setup.resources.add(new Texture3D(setup.gl, { label: 'grading-lut', size: GRADING_LUT_SIZE, filter: 'linear', pixels: this.lutData }));
    this.lutGrade.fill(Number.NaN);
    this.lutMode = null;
  }

  resize(_size: FrameSize): void {
    // Reads the HDR target and writes the LDR target, both owned by the renderer.
  }

  /**
   * Brings the LUT to the frame's grade and the colour-blind correction; false when the frame needs no
   * LUT (no grade or a neutral one, no correction). Sets `graded`.
   */
  private updateLut(ctx: RenderContext): boolean {
    const grading = ctx.scene.grading;
    const lut = this.lut;
    this.graded = grading.active && lut !== null && !isNeutralGrading(grading.params);
    const mode = this.colorblind;
    if (lut === null || (!this.graded && mode === 'none')) return false;
    const params = this.graded ? grading.params : NEUTRAL;
    if (this.lutMode !== mode || Number.isNaN(this.lutGrade[0] as number) || gradingDistance(params, this.lutGrade) > GRADING_REGEN_EPSILON) {
      generateGradingLut(params, this.lutData, GRADING_LUT_SIZE, mode);
      lut.setPixels(this.lutData);
      this.lutGrade.set(params);
      this.lutMode = mode;
      this.lutBuilds++;
    }
    return true;
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const scene = ctx.scene;
    const post = scene.post;
    const lutOn = this.updateLut(ctx);
    const graded = this.graded;
    this.lutApplied = lutOn;
    const distortion = this.deps?.distortion ?? null;
    const field = distortion !== null && distortion.activeInFrame(f.index) ? distortion.texture : null;
    const noise = this.deps?.shared.noise ?? null;
    const hdr: Texture2D = ctx.targets.hdr.texture(0);
    ctx.targets.ldr.bind();
    hdr.bind(UNIT_HDR);
    ctx.targets.gbuffer.texture(GBUFFER_ALBEDO).bind(UNIT_ALBEDO);
    // Unused samplers point at the HDR target (never read: their effect is off).
    (field ?? hdr).bind(UNIT_DISTORTION);
    (noise ?? hdr).bind(UNIT_NOISE);
    this.lut?.bind(UNIT_LUT);
    gl.uniform1i(p.uniform('uHdr'), UNIT_HDR);
    gl.uniform1i(p.uniform('uAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(p.uniform('uDistortion'), UNIT_DISTORTION);
    gl.uniform1i(p.uniform('uNoise'), UNIT_NOISE);
    gl.uniform1i(p.uniform('uLut'), UNIT_LUT);
    gl.uniform1f(p.uniform('uExposure'), this.exposure);
    gl.uniform4f(p.uniform('uView'), (f.width - f.viewWidth) / 2, (f.height - f.viewHeight) / 2, f.viewWidth, f.viewHeight);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    gl.uniform1f(p.uniform('uTime'), f.time);
    gl.uniform1i(p.uniform('uDistort'), field !== null ? 1 : 0);
    gl.uniform1i(p.uniform('uGrade'), lutOn ? 1 : 0);
    gl.uniform1f(p.uniform('uLid'), post.lid);
    gl.uniform1f(p.uniform('uFrost'), post.frost);
    // Effects that are off get a plain 0: no per-frame arithmetic for a quiet picture.
    const t = f.time;
    const fear = post.fear;
    if (fear > FEAR_TENDRILS_FROM) {
      const breath = this.steady ? 1 : 1 - FEAR_BREATH.depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / FEAR_BREATH.seconds));
      gl.uniform2f(p.uniform('uFear'), fearTendrils(fear) * breath, fearDrain(fear));
    } else gl.uniform2f(p.uniform('uFear'), 0, 0);
    const hurt = Math.max(0, Math.min(1, post.hurt));
    const tired = post.tired;
    if (hurt > 0 || tired > 0) {
      const rim = hurt * (1 - HEARTBEAT_DEPTH + HEARTBEAT_DEPTH * heartbeat(t, hurt, this.steady));
      const hurtDrain = hurt <= HURT_DRAIN.from ? 0 : ((hurt - HURT_DRAIN.from) / (1 - HURT_DRAIN.from)) * HURT_DRAIN.amount;
      gl.uniform2f(p.uniform('uHurt'), rim, Math.max(hurtDrain, tired * TIRED_LOOK.drain));
    } else gl.uniform2f(p.uniform('uHurt'), 0, 0);
    gl.uniform2f(p.uniform('uHeatCold'), post.heat, post.cold);
    const poison = post.poison;
    if (poison > 0) {
      const swell = this.steady ? 1 - POISON_SWELL.depth / 2 : 1 - POISON_SWELL.depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / POISON_SWELL.seconds));
      gl.uniform2f(p.uniform('uPoison'), poison * swell, poison);
    } else gl.uniform2f(p.uniform('uPoison'), 0, 0);
    gl.uniform1f(p.uniform('uDrunk'), post.drunk);
    const vignette = post.vignette;
    if (graded || vignette > 0 || tired > 0) {
      const gradeVignette = graded ? (scene.grading.params[VIGNETTE] as number) : 0;
      gl.uniform1f(p.uniform('uVignette'), Math.min(1, gradeVignette + vignette + tired * TIRED_LOOK.vignette));
    } else gl.uniform1f(p.uniform('uVignette'), 0);
    const grain = post.grain;
    gl.uniform2f(p.uniform('uGrain'), grain, grain > 0 && !this.steady ? Math.floor(t * POST_LOOK.grainRate) % GRAIN_PATTERNS : 0);
    gl.uniform1f(p.uniform('uMotion'), this.motionScale);
    gl.uniform4f(p.uniform('uTransition'), post.transitionR, post.transitionG, post.transitionB, post.transition);
    ctx.drawFullscreen();
    gl.activeTexture(gl.TEXTURE0 + UNIT_LUT);
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    if (this.lut !== null) setup.resources.remove(this.lut);
    this.program = null;
    this.lut = null;
    if (this.replaces) this.replaces.enabled = true;
  }
}
