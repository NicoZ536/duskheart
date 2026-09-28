/**
 * The GPU side of the world surface per WebGL context (M5-17 … M5-24): the interaction texture the interaction pass
 * wrote this frame, the surface settings, and the uniforms the sprite and terrain programs read. Keyed by the
 * context, so the G-buffer pass, the terrain pass and the surface's own passes meet without further wiring; the
 * texture itself is a registry resource of the interaction pass (restored after a context loss, then empty).
 */
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import type { RenderContext } from '../passes/registry';
import { SURFACE_PARAMS } from './params';
import { DEFAULT_SURFACE_SETTINGS, type SurfaceRenderSettings } from './settings';

/** Largest |env.wind| of scenes without weather that still counts as full wind for the flutter. */
const FULL_ENV_WIND = 1;

export class SurfaceFrame {
  settings: SurfaceRenderSettings = DEFAULT_SURFACE_SETTINGS;
  /** Interaction texture of this frame (R: grass pressure, G: footprints), or null. */
  interaction: Texture2D | null = null;
  /** World px of its texel (0, 0) and its size in texels; width 0 = none this frame. */
  rectX = 0;
  rectY = 0;
  rectW = 0;
  rectH = 0;
  /** Frame index the texture belongs to (a stale texture of an earlier frame is not used). */
  frame = -1;

  /** Whether the interaction texture is valid for frame `index`. */
  hasInteraction(index: number): boolean {
    return this.interaction !== null && this.frame === index && this.rectW > 0;
  }
}

const frames = new WeakMap<WebGL2RenderingContext, SurfaceFrame>();

/** The surface frame of context `gl` (created on first use). */
export function surfaceFrameOf(gl: WebGL2RenderingContext): SurfaceFrame {
  let f = frames.get(gl);
  if (f === undefined) {
    f = new SurfaceFrame();
    frames.set(gl, f);
  }
  return f;
}

/** Wind vector of the frame: the weather's, or `env.wind` along x in scenes without weather. */
function windOf(ctx: RenderContext, out: Float32Array): Float32Array {
  const s = ctx.scene.surface;
  if (s.weatherDriven) {
    out[0] = s.windX;
    out[1] = s.windY;
    out[2] = s.gust;
  } else {
    out[0] = ctx.scene.env.wind;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}

const wind = new Float32Array(3);
/**
 * Uniform values handed over as typed arrays (`uniform*fv`): a double passed to a WebGL call is boxed on its way in,
 * a typed array is not (the frame path allocates nothing, §30).
 */
const U_ORIGIN = new Float32Array(2);
const U_WIND = new Float32Array(4);
const U_WEATHER = new Float32Array(4);
const U_FLASH = new Float32Array(1);
const U_RECT = new Float32Array(4);

/** Flutter amplitude [px, signed downwind] of wind-flagged pixels on rigid sprites. */
function flutterOf(ctx: RenderContext, motion: number): number {
  const w = windOf(ctx, wind);
  const strength = ctx.scene.surface.weatherDriven ? (w[2] as number) : Math.min(FULL_ENV_WIND, Math.abs(w[0] as number));
  return SURFACE_PARAMS.wind.flutterPx * strength * motion * ((w[0] as number) < 0 ? -1 : 1);
}

/** Sets the surface uniforms of the sprite program (bound) and binds the interaction texture to `unit`. */
export function bindSpriteSurface(ctx: RenderContext, prog: ShaderProgram, unit: number): void {
  const gl = ctx.gl;
  const f = ctx.frame;
  const s = ctx.scene.surface;
  const frame = surfaceFrameOf(gl);
  const motion = frame.settings.motionScale;
  const w = windOf(ctx, wind);
  U_ORIGIN[0] = f.camera.originX;
  U_ORIGIN[1] = f.camera.originY;
  gl.uniform2fv(prog.uniform('uOrigin'), U_ORIGIN);
  U_WIND[0] = w[0] as number;
  U_WIND[1] = w[1] as number;
  U_WIND[2] = f.time;
  U_WIND[3] = (w[2] as number) * motion;
  gl.uniform4fv(prog.uniform('uWind'), U_WIND);
  U_WEATHER[0] = s.snow;
  U_WEATHER[1] = s.wetness;
  U_WEATHER[2] = f.time;
  U_WEATHER[3] = flutterOf(ctx, motion);
  gl.uniform4fv(prog.uniform('uWeather'), U_WEATHER);
  U_FLASH[0] = frame.settings.flashStrength;
  gl.uniform1fv(prog.uniform('uFlashStrength'), U_FLASH);
  bindInteraction(ctx, prog, unit, frame);
}

/** Binds the interaction texture (or nothing) and sets `uInteractionRect`; width 0 tells the shader there is none. */
export function bindInteraction(ctx: RenderContext, prog: ShaderProgram, unit: number, frame: SurfaceFrame = surfaceFrameOf(ctx.gl)): void {
  const gl = ctx.gl;
  const live = frame.hasInteraction(ctx.frame.index);
  if (live && frame.interaction !== null) frame.interaction.bind(unit);
  else {
    // Nothing bound on the unit: no stale attachment of another target can form a feedback loop with the G-buffer.
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.uniform1i(prog.uniform('uInteraction'), unit);
  U_RECT[0] = frame.rectX;
  U_RECT[1] = frame.rectY;
  U_RECT[2] = live ? frame.rectW : 0;
  U_RECT[3] = live ? frame.rectH : 0;
  gl.uniform4fv(prog.uniform('uInteractionRect'), U_RECT);
}
