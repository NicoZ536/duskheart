/**
 * Canonical light model of a light source (MASTERPROMPT §6.1 pass 5, §12.1): soft distance falloff,
 * soft cone edge and deterministic flicker. Both consumers evaluate exactly these functions:
 *
 * - the renderer (`src/render/light/*`): flicker per light on the CPU, falloff and cone per pixel in
 *   `src/render/shaders/lighting.glsl`, a line-by-line mirror of `lightFalloff` and `lightCone`
 *   (`tests/unit/render/falloff.test.ts` evaluates the GLSL against this module);
 * - the gameplay light map (§12.1, CPU per tile, fed from the same light list): `lightLevelAt`.
 *
 * Coordinates are world pixels: x east, y south (screen down), z height above the ground. A light
 * sits at its footprint (x, y) at `height`; a lit point at (x, y, z). Headless and deterministic
 * (no clock, no randomness): time comes in as an argument. Cosines and sines are the portable ones
 * (`src/engine/portableMath.ts`, M7-76): the gameplay light map gives the same bits on every JS engine.
 */
import { createSinCosRegister, SIN_COS_ANGLE, SIN_COS_COS, SIN_COS_SIN, sinCosIn } from './portableMath';

/** A light as far as its brightness is concerned (render `LightDesc`, later the world's light components). */
export interface LightSource {
  readonly x: number;
  readonly y: number;
  /** Height of the light above the ground (px). */
  readonly height: number;
  /** Reach (px): the falloff is zero at and beyond this distance. */
  readonly radius: number;
  /** Brightness at the light itself (1 = fully lit, the "Hell/Gleißend" border of §12.1 lies at 0.9). */
  readonly intensity: number;
  /** Flicker amount 0…1 (fire ≈ 0.2–0.35, electric light 0). */
  readonly flicker: number;
  /** Phase seed of the flicker, so neighbouring fires do not pulse in step. */
  readonly seed: number;
  /** Cone axis in radians, clockwise from east (y points south, like the screen). */
  readonly coneDirection: number;
  /** Full opening angle of the cone in radians; a full turn or more is a point light. */
  readonly coneAngle: number;
}

/** A full turn: cone angles from here on describe point lights. */
export const LIGHT_FULL_CIRCLE = Math.PI * 2;

/**
 * Width of the soft cone edge in radians (≈ 9°): the cone fades from full to zero over this angle,
 * centred on its nominal border.
 */
export const LIGHT_CONE_SOFT_EDGE = 0.16;

/** Below this planar distance (px) the direction to a point is undefined: it counts as inside the cone. */
export const LIGHT_CONE_EPSILON = 1e-4;

/** Cone cosines that make `lightCone` 1 for every direction (point lights). */
export const LIGHT_CONE_OPEN_OUTER = -3;
export const LIGHT_CONE_OPEN_INNER = -2;

/**
 * Weight of the hot core of the falloff: the (1 − x²)² window is divided by (1 + CORE · x²), so the
 * brightness drops quickly near the light and fades out in a long soft tail – a light source reads as
 * a glowing point with a halo, not as a flat disc.
 */
export const LIGHT_FALLOFF_CORE = 2;

/**
 * Soft distance falloff: (1 − x²)² / (1 + CORE · x²) with x = d / r. 1 at the light, 0 at the radius
 * with zero slope (no hard rim; neighbouring pools blend without a crease), steepest near the light.
 *
 * Mirrored in GLSL (`lighting.glsl`, same statements):
 * `x = distance / radius; w = max(0, 1 − x·x); return w·w / (1 + CORE·x·x)`.
 */
export function lightFalloff(distance: number, radius: number): number {
  if (!(radius > 0)) return 0;
  const x = distance / radius;
  const w = Math.max(0, 1 - x * x);
  return (w * w) / (1 + LIGHT_FALLOFF_CORE * x * x);
}

/** Hermite smoothstep as GLSL defines it (edge0 < edge1). */
export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Register of the portable sine and cosine (cone borders, `coneCosine`, `lightFlicker` – code of every frame and every
 * light-map query): the angle goes in, the results come out, no fraction crosses a call.
 */
const TRIG = createSinCosRegister();

/** Cosine of the outer cone border (factor 0) for an opening angle; always-open value for point lights. */
export function lightConeOuter(coneAngle: number): number {
  if (!(coneAngle < LIGHT_FULL_CIRCLE)) return LIGHT_CONE_OPEN_OUTER;
  TRIG[SIN_COS_ANGLE] = Math.min(Math.PI, coneAngle / 2 + LIGHT_CONE_SOFT_EDGE / 2);
  sinCosIn(TRIG);
  return TRIG[SIN_COS_COS] as number;
}

/** Cosine of the inner cone border (factor 1) for an opening angle; always-open value for point lights. */
export function lightConeInner(coneAngle: number): number {
  if (!(coneAngle < LIGHT_FULL_CIRCLE)) return LIGHT_CONE_OPEN_INNER;
  TRIG[SIN_COS_ANGLE] = Math.max(0, coneAngle / 2 - LIGHT_CONE_SOFT_EDGE / 2);
  sinCosIn(TRIG);
  return TRIG[SIN_COS_COS] as number;
}

/**
 * Soft cone factor from the cosine between the cone axis and the direction light → point.
 * Mirrored in GLSL (`lighting.glsl`): `return smoothstep(cosOuter, cosInner, cosAngle)`.
 */
export function lightCone(cosAngle: number, cosOuter: number, cosInner: number): number {
  return smoothstep(cosOuter, cosInner, cosAngle);
}

/**
 * Cosine between the cone axis and the planar direction light → (dx, dy); 1 at the light itself. The length is the
 * shader's `length(away)` = √(dx² + dy²) (lighting_point.frag; `Math.hypot` would differ by a rounding and allocates
 * its argument list on every call, M6-16f).
 */
export function coneCosine(dx: number, dy: number, coneDirection: number): number {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < LIGHT_CONE_EPSILON) return 1;
  TRIG[SIN_COS_ANGLE] = coneDirection;
  sinCosIn(TRIG);
  return (dx * (TRIG[SIN_COS_COS] as number) + dy * (TRIG[SIN_COS_SIN] as number)) / len;
}

/** Angular speeds (rad/s), weights (sum 1) and seed factors of the three flicker waves (incommensurate, so it never visibly repeats). */
const FLICKER_SPEEDS: readonly number[] = [7.3, 13.1, 23.7];
const FLICKER_WEIGHTS: readonly number[] = [0.5, 0.3, 0.2];
const FLICKER_SEED_FACTORS: readonly number[] = [1, 2.3, 4.1];

/** Slots of a `lightFlickerIn` register: the flicker amount 0…1 … */
export const FLICKER_AMOUNT = 0;
/** … the phase seed of the light … */
export const FLICKER_SEED = 1;
/** … the time [s] … */
export const FLICKER_TIME = 2;
/** … and the result, the flicker multiplier. */
export const FLICKER_RESULT = 3;

/** A register for `lightFlickerIn` (four doubles: amount, seed, time, result). Hold one per module; read the result right away. */
export function createFlickerRegister(): Float64Array<ArrayBuffer> {
  return new Float64Array(4);
}

/**
 * Flicker multiplier of a light into `r[FLICKER_RESULT]` from `r[FLICKER_AMOUNT]` (0…1), `r[FLICKER_SEED]` and
 * `r[FLICKER_TIME]` (seconds): 1 − amount · n(t) with n ∈ [0, 1] a weighted sum of three raised sine waves phased by the
 * seed. Amount 0 = steady; 1 = the light may dip to black.
 *
 * The register form for code that runs every frame (ADR-0274): no fractional number crosses the call. The light batch
 * packs every light through it – once the waves came from `sinCosIn` (M7-76), V8 no longer inlined the scalar
 * `lightFlicker` into `LightBatch.pack` and boxed its two fractional arguments and its result for every light
 * (≈ 2 KB per frame with 32 lights in `render:frame-pfad sprites-5000`; M7-137).
 */
export function lightFlickerIn(r: Float64Array): void {
  const a = Math.min(1, Math.max(0, r[FLICKER_AMOUNT] as number));
  if (a === 0) {
    r[FLICKER_RESULT] = 1;
    return;
  }
  const seed = r[FLICKER_SEED] as number;
  const t = r[FLICKER_TIME] as number;
  let n = 0;
  for (let i = 0; i < FLICKER_SPEEDS.length; i++) {
    // The phase modulo a full turn (`%` is exact): any clock time stays within the portable sine's range.
    TRIG[SIN_COS_ANGLE] = ((FLICKER_SPEEDS[i] ?? 0) * t + seed * (FLICKER_SEED_FACTORS[i] ?? 0)) % LIGHT_FULL_CIRCLE;
    sinCosIn(TRIG);
    const wave = TRIG[SIN_COS_SIN] as number;
    n += (FLICKER_WEIGHTS[i] ?? 0) * (0.5 + 0.5 * wave);
  }
  r[FLICKER_RESULT] = 1 - a * n;
}

const FLICKER = createFlickerRegister();

/**
 * Flicker multiplier of a light at time `t` (seconds): the scalar form of `lightFlickerIn`, bit for bit the same (the
 * gameplay light map, the determinism probe and the tests). Per-frame code uses the register form itself.
 */
export function lightFlicker(amount: number, seed: number, t: number): number {
  FLICKER[FLICKER_AMOUNT] = amount;
  FLICKER[FLICKER_SEED] = seed;
  FLICKER[FLICKER_TIME] = t;
  lightFlickerIn(FLICKER);
  return FLICKER[FLICKER_RESULT] as number;
}

/**
 * Distance between a light and a point (px): the shader's `length(toLight)` = √(dx² + dy² + dz²), summed in that order
 * (lighting_point.frag; tests/unit/engine/licht-paritaet.test.ts). Not `Math.hypot`: that rounds differently from the
 * shader and allocates its argument list on every call, even optimised (M6-16f).
 */
export function lightDistance(light: Pick<LightSource, 'x' | 'y' | 'height'>, x: number, y: number, z: number): number {
  const dx = light.x - x;
  const dy = light.y - y;
  const dz = light.height - z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Brightness a light adds at world point (x, y, z) at time `t`, before surface orientation: intensity ×
 * flicker × falloff × cone. The gameplay light map samples it at ground level (z = 0), where the
 * rendered light of a flat surface is exactly this value times the light colour.
 */
export function lightLevelAt(light: LightSource, x: number, y: number, z: number, t: number): number {
  const f = lightFalloff(lightDistance(light, x, y, z), light.radius);
  if (f === 0) return 0;
  const cone = lightCone(coneCosine(x - light.x, y - light.y, light.coneDirection), lightConeOuter(light.coneAngle), lightConeInner(light.coneAngle));
  return light.intensity * lightFlicker(light.flicker, light.seed, t) * f * cone;
}
