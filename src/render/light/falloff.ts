/**
 * The renderer's view of the canonical light model (`src/engine/lightFalloff.ts`): the same falloff,
 * cone and flicker functions (re-exported, never re-implemented) plus the shading constants of the
 * lighting shaders, handed to GLSL as `#define`s so `lighting.glsl` and TypeScript share one set of
 * numbers. The per-pixel falloff/cone in `lighting.glsl` mirror `lightFalloff`/`lightCone` statement
 * by statement; `tests/unit/render/falloff.test.ts` evaluates the GLSL source against them.
 */
import {
  coneCosine,
  LIGHT_CONE_EPSILON,
  LIGHT_FALLOFF_CORE,
  lightCone,
  lightConeInner,
  lightConeOuter,
  lightDistance,
  lightFalloff,
  lightFlicker,
  lightLevelAt,
  type LightSource,
} from '../../engine/lightFalloff';

export { coneCosine, lightCone, lightConeInner, lightConeOuter, lightDistance, lightFalloff, lightFlicker, lightLevelAt, type LightSource };

/**
 * Relief strength of the normal mapping: shade = 1 + RELIEF · (n·l − l.z). A flat surface (n = +z)
 * gets exactly the falloff – the value the gameplay light map computes – while surfaces turned
 * towards the light brighten and those turned away darken (down to black at grazing light).
 */
export const LIGHT_RELIEF = 1.4;

/**
 * Least height of the light above a lit pixel used for the normal-mapping direction (px): a pixel
 * level with or above the flame still sees it slightly from the front instead of exactly edge-on.
 */
export const LIGHT_MIN_NORMAL_HEIGHT = 6;

/** Specular highlight (wet, metal, ice): strength at full gloss and Blinn-Phong exponent. */
export const LIGHT_SPECULAR_STRENGTH = 1.4;
export const LIGHT_SHININESS = 24;

/** Shading factor of a surface normal `n` (unit, +y up on screen, +z towards the viewer) for the unit direction `l` to the light. */
export function lightShade(nx: number, ny: number, nz: number, lx: number, ly: number, lz: number): number {
  return Math.max(0, 1 + LIGHT_RELIEF * (nx * lx + ny * ly + nz * lz - lz));
}

/** `#define`s of the lighting programs (shared constants of this module and the canonical model). */
export function lightingDefines(): Readonly<Record<string, string>> {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return {
    DH_LIGHT_RELIEF: f(LIGHT_RELIEF),
    DH_LIGHT_MIN_NORMAL_HEIGHT: f(LIGHT_MIN_NORMAL_HEIGHT),
    DH_LIGHT_SPECULAR: f(LIGHT_SPECULAR_STRENGTH),
    DH_LIGHT_SHININESS: f(LIGHT_SHININESS),
    DH_LIGHT_CONE_EPSILON: f(LIGHT_CONE_EPSILON),
    DH_LIGHT_FALLOFF_CORE: f(LIGHT_FALLOFF_CORE),
  };
}
