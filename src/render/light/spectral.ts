/**
 * Spectral light colour of the composition (M1-26, MASTERPROMPT §4.1 „warme Lichtinseln in kühler,
 * bedrohlicher Dunkelheit“, §4.3 hue shifting, ADR-0018): TypeScript mirror of `reflectLight` in
 * `shaders/spectral.glsl`, for tests and CPU consumers (swatches, previews).
 *
 * The plain RGB product albedo ⊙ light treats each channel as a disjoint box spectrum. For white
 * light that is exact; for a saturated light it underestimates how much the light's own hue
 * dominates what a surface reflects: a flame emits a steep, red-heavy spectrum, so green grass under
 * it returns mostly the red-orange part of that spectrum – it reads golden, not lime (the product
 * keeps grass's green channel on top). The same holds for the narrow blue of the night ambient: a
 * green surface in moonlight reads blue-grey, not green-black.
 *
 * Model: a light `c` reflects off albedo `a` as
 *   mix(a ⊙ c, ρ · c, share(c)),   ρ = (a · c) / (c.r + c.g + c.b),   share = SPECTRAL_WEIGHT · (1 − min/max),
 * i.e. the RGB product, blended by the light's (weighted) saturation towards the light colour scaled
 * with the surface's reflectance weighted by the light's spectrum. White or grey light (saturation 0) gives
 * exactly the RGB product – palette colours under full daylight and unlit frames stay unchanged
 * (ADR-0012 „Identität bis Licht 1“) –, and so does a light in one primary (then ρ is the albedo's
 * own channel). Both terms are linear in the light's intensity, so the ambient and the point lights
 * are reflected on their own and added: the warm share of a pixel grows with the torch light's share
 * of its total light – its hue shifts from the cool ambient towards the flame as the torch light
 * rises. On top, `warmLight` turns a rising warm point light from orange towards warm yellow.
 */
import { smoothstep } from '../../engine/lightFalloff';

/**
 * How far a saturated light pulls the reflected colour towards its own hue (0 = plain RGB product,
 * 1 = a fully saturated light only modulates brightness). Below 1 every material keeps a trace of its
 * own colour under a torch – grass reads golden, earth orange, stone beige, skin apricot – instead of
 * all of them sinking into one sepia tone; the moonlit dark stays blue on every Grünhain material.
 */
export const SPECTRAL_WEIGHT = 0.9;

/** Share of the spectral term for a light with darkest channel `lo` and brightest `hi` (`spectralShare` in spectral.glsl). */
export function spectralShare(lo: number, hi: number): number {
  return hi > 0 ? (1 - lo / hi) * SPECTRAL_WEIGHT : 0;
}

/** Surface reflectance under a light: the albedo weighted with the light's spectrum (`lightReflectance` in spectral.glsl). */
export function lightReflectance(ar: number, ag: number, ab: number, lr: number, lg: number, lb: number): number {
  return (ar * lr + ag * lg + ab * lb) / (lr + lg + lb);
}

/**
 * Colour reflected by albedo (ar, ag, ab) under light (lr, lg, lb), linear, light unbounded (HDR);
 * writes into `out` and returns it (`reflectLight` in spectral.glsl).
 */
export function reflectLight(ar: number, ag: number, ab: number, lr: number, lg: number, lb: number, out: [number, number, number]): [number, number, number] {
  const hi = Math.max(lr, lg, lb);
  if (hi <= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const share = spectralShare(Math.min(lr, lg, lb), hi);
  const rho = lightReflectance(ar, ag, ab, lr, lg, lb);
  out[0] = ar * lr * (1 - share) + lr * rho * share;
  out[1] = ag * lg * (1 - share) + lg * rho * share;
  out[2] = ab * lb * (1 - share) + lb * rho * share;
  return out;
}

/**
 * Warm hue shift of the point light (§4.3 „Lichter Richtung Warmgelb“): the more a warm light rises,
 * the further its green channel climbs towards its red – its hue moves from orange towards warm
 * yellow, as a palette ramp turns yellower towards its highlights and a flame is orange at the rim of
 * its pool and golden at its heart. `WARM_SHIFT` is the most of the gap between green and red a light
 * closes (times its warmth): at full level the orange `feuer.3` light turns amber, most of the way to
 * the yellow of `feuer.4` – further would drag green surfaces back to yellow-green.
 */
export const WARM_SHIFT = 0.35;
/**
 * Light levels (brightest channel, HDR) between which the warm shift sets in (smoothstep): dim and
 * middle light stays orange – a dark yellow reads olive, not warm –, only the bright heart of a pool
 * turns golden.
 */
export const WARM_SHIFT_START_LEVEL = 0.5;
export const WARM_SHIFT_FULL_LEVEL = 1.5;

/**
 * Share of the green-to-red gap a light closes (`warmShare` in spectral.glsl): grows with its level
 * `r` (red is its brightest channel) and with its warmth (r − b) / r – white and grey light (b = r)
 * stay unchanged.
 */
export function warmShare(r: number, b: number): number {
  if (r <= 0) return 0;
  return WARM_SHIFT * smoothstep(WARM_SHIFT_START_LEVEL, WARM_SHIFT_FULL_LEVEL, r) * Math.min(Math.max((r - b) / r, 0), 1);
}

/**
 * Light (lr, lg, lb) with its warm hue shift, written into `out` (`warmLight` in spectral.glsl): only
 * a light whose red is its brightest channel is shifted; brightest channel and blue stay, so the light
 * bands and the gameplay light level are untouched.
 */
export function warmLight(lr: number, lg: number, lb: number, out: [number, number, number]): [number, number, number] {
  const s = lr > 0 && lr >= lg && lr >= lb ? warmShare(lr, lb) : 0;
  out[0] = lr;
  out[1] = lg + (lr - lg) * s;
  out[2] = lb;
  return out;
}

/** GLSL float literal of `v`. */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of programs that include spectral.glsl. */
export function spectralDefines(): Readonly<Record<string, string>> {
  return {
    DH_SPECTRAL_WEIGHT: glslFloat(SPECTRAL_WEIGHT),
    DH_WARM_SHIFT: glslFloat(WARM_SHIFT),
    DH_WARM_SHIFT_START_LEVEL: glslFloat(WARM_SHIFT_START_LEVEL),
    DH_WARM_SHIFT_FULL_LEVEL: glslFloat(WARM_SHIFT_FULL_LEVEL),
  };
}
