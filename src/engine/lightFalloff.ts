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
 * (no clock, no randomness): time comes in as an argument.
 */

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

/** Cosine of the outer cone border (factor 0) for an opening angle; always-open value for point lights. */
export function lightConeOuter(coneAngle: number): number {
  if (!(coneAngle < LIGHT_FULL_CIRCLE)) return LIGHT_CONE_OPEN_OUTER;
  return Math.cos(Math.min(Math.PI, coneAngle / 2 + LIGHT_CONE_SOFT_EDGE / 2));
}

/** Cosine of the inner cone border (factor 1) for an opening angle; always-open value for point lights. */
export function lightConeInner(coneAngle: number): number {
  if (!(coneAngle < LIGHT_FULL_CIRCLE)) return LIGHT_CONE_OPEN_INNER;
  return Math.cos(Math.max(0, coneAngle / 2 - LIGHT_CONE_SOFT_EDGE / 2));
}

/**
 * Soft cone factor from the cosine between the cone axis and the direction light → point.
 * Mirrored in GLSL (`lighting.glsl`): `return smoothstep(cosOuter, cosInner, cosAngle)`.
 */
export function lightCone(cosAngle: number, cosOuter: number, cosInner: number): number {
  return smoothstep(cosOuter, cosInner, cosAngle);
}

/** Cosine between the cone axis and the planar direction light → (dx, dy); 1 at the light itself. */
export function coneCosine(dx: number, dy: number, coneDirection: number): number {
  const len = Math.hypot(dx, dy);
  if (len < LIGHT_CONE_EPSILON) return 1;
  return (dx * Math.cos(coneDirection) + dy * Math.sin(coneDirection)) / len;
}

/** Angular speeds (rad/s), weights (sum 1) and seed factors of the three flicker waves (incommensurate, so it never visibly repeats). */
const FLICKER_SPEEDS: readonly number[] = [7.3, 13.1, 23.7];
const FLICKER_WEIGHTS: readonly number[] = [0.5, 0.3, 0.2];
const FLICKER_SEED_FACTORS: readonly number[] = [1, 2.3, 4.1];

/**
 * Flicker multiplier of a light at time `t` (seconds): 1 − amount · n(t) with n ∈ [0, 1] a weighted
 * sum of three raised sine waves phased by `seed`. `amount` 0 = steady; 1 = the light may dip to black.
 */
export function lightFlicker(amount: number, seed: number, t: number): number {
  const a = Math.min(1, Math.max(0, amount));
  if (a === 0) return 1;
  let n = 0;
  for (let i = 0; i < FLICKER_SPEEDS.length; i++) {
    const wave = Math.sin((FLICKER_SPEEDS[i] ?? 0) * t + seed * (FLICKER_SEED_FACTORS[i] ?? 0));
    n += (FLICKER_WEIGHTS[i] ?? 0) * (0.5 + 0.5 * wave);
  }
  return 1 - a * n;
}

/** Distance between a light and a point (px). */
export function lightDistance(light: Pick<LightSource, 'x' | 'y' | 'height'>, x: number, y: number, z: number): number {
  return Math.hypot(light.x - x, light.y - y, light.height - z);
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
