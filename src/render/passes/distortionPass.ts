/**
 * Distortion pass (MASTERPROMPT §6.1 pass 9 "Verzerrungspuffer (Schockwellen, Hitze, Unterwasser)",
 * M5-13; heat shimmer of M5-10): draws the frame's offset field – view-wide heat shimmer (`env.heat`)
 * and the sway under water (`post.underwater`) as one fullscreen draw, the shock waves and heat areas of
 * `post.distortion` as instanced quads, all added up (`distortion.glsl`). The post pass reads the picture
 * through the field, whole pixels at a time. Without any source the pass draws nothing and the post
 * pass reads straight.
 *
 * Accessibility (§29): shock waves scale with the screen shake setting, shimmer and sway calm down with
 * reduced motion (`configure`).
 */
import { DISTORTION_KIND, DISTORTION_RANGE_PX } from '../post/distortion';
import { InstancedQuads } from '../post/quads';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from '../post/settings';
import type { PostShared } from '../post/shared';
import { RenderTarget } from '../gl/framebuffer';
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Render-debugger view of the offset field. */
export const DISTORTION_DEBUG_VIEW = 'distortion';
/**
 * Heat shimmer: noise tile of the sway [px], how much the phase noise is stretched along the rows, rows per
 * px (row pattern), sway speed [rad/s], rise of the pattern [px/s], tile and threshold of the shimmering
 * patches, largest view-wide sway [px].
 */
export const HEAT_LOOK = { tile: 96, rowStretch: 8, rows: 0.8, speed: 5.5, rise: 18, patchTile: 220, patchFrom: 0.45, maxPx: 2.6 } as const;
/** Under water: rows and columns per px of the sway, its speed [rad/s] and largest offset [px]. */
export const WATER_LOOK = { rows: 0.09, columns: 0.07, speed: 1.7, swayPx: 2.5 } as const;
/**
 * Light gathered and spread by the bend (the post pass, `distortionShade`): a pixel that reads a wider
 * stretch of the picture than one pixel collects its light and brightens, one that reads a narrower
 * stretch (magnified) darkens – brightness × 1 + `gain` · divergence of the offset field beyond a dead
 * zone `dead`, within [`min`, `max`]. A shock wave reads as a dark lens with bright rims; the gentle bends
 * of heat haze and water stay as bright as they are (no ripples).
 */
export const DISTORTION_CAUSTIC = { gain: 0.75, dead: 0.08, min: 0.62, max: 1.5 } as const;

/** Brightness factor of a pixel whose offset field has divergence `divergence` [px/px] (mirror of `distortionShade`). */
export function distortionShade(divergence: number): number {
  const d = Math.sign(divergence) * Math.max(Math.abs(divergence) - DISTORTION_CAUSTIC.dead, 0);
  return Math.max(DISTORTION_CAUSTIC.min, Math.min(DISTORTION_CAUSTIC.max, 1 + DISTORTION_CAUSTIC.gain * d));
}
/** Floats per source instance: centre x, y, a, b, kind, strength. */
const SOURCE_FLOATS = 6;
const UNIT_NOISE = 0;
const ZERO: readonly number[] = [0, 0, 0, 0];

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the distortion shaders (also the post pass, which decodes the field). */
export function distortionDefines(): Readonly<Record<string, string>> {
  return {
    DH_DISTORTION_RANGE: glslFloat(DISTORTION_RANGE_PX),
    DH_CAUSTIC_GAIN: glslFloat(DISTORTION_CAUSTIC.gain),
    DH_CAUSTIC_DEAD: glslFloat(DISTORTION_CAUSTIC.dead),
    DH_CAUSTIC_MIN: glslFloat(DISTORTION_CAUSTIC.min),
    DH_CAUSTIC_MAX: glslFloat(DISTORTION_CAUSTIC.max),
    DH_HEAT_TILE: glslFloat(HEAT_LOOK.tile),
    DH_HEAT_ROW_STRETCH: glslFloat(HEAT_LOOK.rowStretch),
    DH_HEAT_ROWS: glslFloat(HEAT_LOOK.rows),
    DH_HEAT_SPEED: glslFloat(HEAT_LOOK.speed),
    DH_HEAT_RISE: glslFloat(HEAT_LOOK.rise),
    DH_HEAT_PATCH_TILE: glslFloat(HEAT_LOOK.patchTile),
    DH_HEAT_PATCH_FROM: glslFloat(HEAT_LOOK.patchFrom),
    DH_HEAT_MAX_PX: glslFloat(HEAT_LOOK.maxPx),
    DH_WATER_ROWS: glslFloat(WATER_LOOK.rows),
    DH_WATER_COLUMNS: glslFloat(WATER_LOOK.columns),
    DH_WATER_SPEED: glslFloat(WATER_LOOK.speed),
    DH_WATER_SWAY_PX: glslFloat(WATER_LOOK.swayPx),
  };
}

export class DistortionPass implements RenderPass {
  readonly name = 'distortion';
  enabled = true;
  shockwaveScale = DEFAULT_ATMOSPHERE_POST_SETTINGS.shockwaveScale;
  motionScale = DEFAULT_ATMOSPHERE_POST_SETTINGS.motionScale;
  private field: RenderTarget | null = null;
  private fieldProgram: ShaderProgram | null = null;
  private sourceProgram: ShaderProgram | null = null;
  private readonly sources = new InstancedQuads('distortion-sources', SOURCE_FLOATS, [
    { location: 1, components: 4, offset: 0 },
    { location: 2, components: 2, offset: 4 },
  ]);
  private ranAt = -1;
  /** Sources drawn in the last frame (statistics, tests). */
  sourcesDrawn = 0;

  constructor(private readonly shared: PostShared) {}

  configure(settings: AtmospherePostSettings): void {
    this.shockwaveScale = settings.shockwaveScale;
    this.motionScale = settings.motionScale;
  }

  /** Whether the field holds this frame's offsets (else the post pass reads straight). */
  activeInFrame(frameIndex: number): boolean {
    return this.enabled && this.ranAt === frameIndex;
  }

  /** The offset field (null before `init`). */
  get texture(): Texture2D | null {
    return this.field?.texture(0) ?? null;
  }

  init(setup: PassSetup): void {
    this.shared.acquire(setup);
    const defines = distortionDefines();
    this.field = setup.resources.add(new RenderTarget(setup.gl, { label: 'distortion', width: 1, height: 1, attachments: [{ name: 'offset', format: 'RGBA8' }], floatTargets: setup.caps.floatTargets }));
    this.fieldProgram = setup.shaders.program({ name: 'distortion-field', vertex: 'fullscreen.vert', fragment: 'distortion_field.frag', defines });
    this.sourceProgram = setup.shaders.program({ name: 'distortion-source', vertex: 'distortion_source.vert', fragment: 'distortion_source.frag', defines });
    this.sources.init(setup);
    const field = this.field;
    setup.debugViews.register({ name: DISTORTION_DEBUG_VIEW, mode: 'rgb', source: () => field.texture(0) });
  }

  resize(size: FrameSize): void {
    this.field?.resize(size.width, size.height);
    this.shared.resize(size);
  }

  execute(ctx: RenderContext): void {
    const scene = ctx.scene;
    const list = scene.post.distortion;
    const heat = Math.max(0, Math.min(1, scene.env.heat));
    const water = Math.max(0, Math.min(1, scene.post.underwater));
    this.sourcesDrawn = 0;
    const field = this.field;
    const noise = this.shared.noise;
    if (field === null || noise === null || (heat <= 0 && water <= 0 && list.count === 0)) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    field.bind();
    gl.clearBufferfv(gl.COLOR, 0, ZERO);
    noise.bind(UNIT_NOISE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const fp = this.fieldProgram;
    if ((heat > 0 || water > 0) && fp !== null && fp.use()) {
      gl.uniform1i(fp.uniform('uNoise'), UNIT_NOISE);
      gl.uniform2f(fp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
      gl.uniform2f(fp.uniform('uTargetSize'), f.width, f.height);
      gl.uniform1f(fp.uniform('uTime'), f.time);
      gl.uniform1f(fp.uniform('uHeat'), heat);
      gl.uniform1f(fp.uniform('uUnderwater'), water);
      gl.uniform1f(fp.uniform('uMotion'), this.motionScale);
      ctx.drawFullscreen();
    }
    const n = this.packSources(ctx);
    const sp = this.sourceProgram;
    if (n > 0 && sp !== null && sp.use()) {
      gl.uniform1i(sp.uniform('uNoise'), UNIT_NOISE);
      gl.uniform2f(sp.uniform('uOrigin'), f.camera.originX, f.camera.originY);
      gl.uniform2f(sp.uniform('uTargetSize'), f.width, f.height);
      gl.uniform1f(sp.uniform('uTime'), f.time);
      gl.uniform1f(sp.uniform('uShockScale'), this.shockwaveScale);
      gl.uniform1f(sp.uniform('uMotion'), this.motionScale);
      this.sources.draw(ctx, n);
      this.sourcesDrawn = n;
    }
    gl.disable(gl.BLEND);
    this.ranAt = f.index;
  }

  /** Packs the sources that touch the view; returns their count. */
  private packSources(ctx: RenderContext): number {
    const list = ctx.scene.post.distortion;
    const f = ctx.frame;
    const left = f.camera.originX;
    const top = f.camera.originY;
    const right = left + f.width;
    const bottom = top + f.height;
    let n = 0;
    for (let i = 0; i < list.count; i++) {
      const kind = list.kind[i] as number;
      const x = list.x[i] as number;
      const y = list.y[i] as number;
      const a = list.a[i] as number;
      const b = list.b[i] as number;
      const ex = kind === DISTORTION_KIND.shockwave ? a + b : a;
      const ey = kind === DISTORTION_KIND.shockwave ? a + b : b;
      if (x + ex < left || x - ex > right || y + ey < top || y - ey > bottom) continue;
      this.sources.reserve(n + 1, n);
      const d = this.sources.data;
      const o = n * SOURCE_FLOATS;
      d[o] = x;
      d[o + 1] = y;
      d[o + 2] = a;
      d[o + 3] = b;
      d[o + 4] = kind;
      d[o + 5] = list.strength[i] as number;
      n++;
    }
    return n;
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(DISTORTION_DEBUG_VIEW);
    this.sources.dispose(setup);
    if (this.field !== null) setup.resources.remove(this.field);
    if (this.fieldProgram !== null) setup.shaders.release(this.fieldProgram);
    if (this.sourceProgram !== null) setup.shaders.release(this.sourceProgram);
    this.field = null;
    this.fieldProgram = null;
    this.sourceProgram = null;
    this.shared.release(setup);
  }
}
