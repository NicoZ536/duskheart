/**
 * The frame's ambient light as the shaders take it (MASTERPROMPT §30 "keine Allokation im Frame-Pfad"): colour ×
 * strength and the strength itself, read from `scene.env` once per frame and shared by every pass that lights with it
 * (composition, particles, fog). Code that runs once a frame stays in V8's baseline tier for a long time, where every
 * float read from a record or computed is a new heap number – so the four values are read once, not once per pass.
 * Beside them the frame's daylight level (`frameDayLevel`: the ambient's brightest channel, 0 … 1, `dayLevel` – under
 * weather that of the clear sky ÷ the weather's light share, `weatherDayLevel`, M5-66) for the point light's soft add over
 * the daylight in the composition, the particles and the fog (`uDayLevel`, M5-41).
 */
import type { RenderContext } from '../passes/registry';
import { weatherDayLevel } from './banding';

/** Slots of the record: r, g, b (× strength), strength. */
export const AMBIENT_R = 0;
export const AMBIENT_G = 1;
export const AMBIENT_B = 2;
export const AMBIENT_I = 3;

interface FrameAmbient {
  ctx: RenderContext | null;
  frame: number;
  readonly values: Float32Array;
  /** The daylight level of the same frame (one slot: uploaded with `uniform1fv`, no float read in JavaScript). */
  readonly level: Float32Array;
}

const current: FrameAmbient = { ctx: null, frame: -1, values: new Float32Array(4), level: new Float32Array(1) };

/**
 * The ambient record of `ctx`'s frame (`AMBIENT_*`), computed on the first call of the frame. The array is shared and
 * overwritten by the next frame: read it, upload it, do not keep it.
 */
export function frameAmbient(ctx: RenderContext): Float32Array {
  const index = ctx.frame.index;
  const a = current.values;
  if (current.ctx === ctx && current.frame === index) return a;
  current.ctx = ctx;
  current.frame = index;
  const env = ctx.scene.env;
  const intensity = env.ambientIntensity;
  const r = env.ambientR * intensity;
  const g = env.ambientG * intensity;
  const b = env.ambientB * intensity;
  a[AMBIENT_R] = r;
  a[AMBIENT_G] = g;
  a[AMBIENT_B] = b;
  a[AMBIENT_I] = intensity;
  current.level[0] = weatherDayLevel(r, g, b, env.weatherLight);
  return a;
}

/**
 * The daylight level of `ctx`'s frame (one slot): `weatherDayLevel` of the frame's ambient and weather – the
 * composition's `uDayLevel` –, also for `pointOverDaylight(uAmbient, uDayLevel)` in programs that light with the ambient
 * alone (particles, fog; M5-41).
 * Shared and overwritten by the next frame: upload it with `uniform1fv`, do not keep it.
 */
export function frameDayLevel(ctx: RenderContext): Float32Array {
  frameAmbient(ctx);
  return current.level;
}
