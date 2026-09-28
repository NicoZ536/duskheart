/**
 * All `#define`s of the water shaders: the numbers of `params.ts`, the palette colours of the water as GLSL
 * `vec3` literals, the height of a terrain level and the range of the occluder pass's water distance field (the
 * light strand's `SDF.maxDistancePx`, read here so both sides decode the field with one number).
 */
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { SDF } from '../light/params';
import { CAUSTICS, DEPTH, FOAM, GLITTER, ICE, IMMERSION, MOON, STARS, waterDefines } from './params';
import { paletteRgb } from './colour';

/** A palette colour as a GLSL `vec3` literal. */
export function glslColour(ref: string): string {
  const [r, g, b] = paletteRgb(ref);
  const n = (v: number): string => v.toFixed(5);
  return `vec3(${n(r)}, ${n(g)}, ${n(b)})`;
}

/** Palette colours of the water shaders by define name. */
export const WATER_COLOURS: Readonly<Record<string, string>> = {
  DH_COL_DEEP: DEPTH.deepColor,
  DH_COL_SHALLOW: DEPTH.shallowColor,
  DH_COL_FOAM: FOAM.color,
  DH_COL_FOAM_SHADE: FOAM.shadeColor,
  DH_COL_CAUSTIC: CAUSTICS.color,
  DH_COL_STAR: STARS.color,
  DH_COL_MOON: MOON.color,
  DH_COL_GLITTER: GLITTER.color,
  DH_COL_IMMERSE: IMMERSION.tint,
  DH_COL_ICE: ICE.color,
  DH_COL_ICE_CRACK: ICE.crackColor,
  DH_COL_ICE_LIP: ICE.lipColor,
  DH_COL_ICE_DEEP: ICE.deepColor,
};

/** Every `#define` of the water programs. */
export function waterShaderDefines(): Readonly<Record<string, string>> {
  const colours: Record<string, string> = {};
  for (const [name, ref] of Object.entries(WATER_COLOURS)) colours[name] = glslColour(ref);
  return {
    ...waterDefines(),
    ...colours,
    DH_LEVEL_PX: WAND_PX_JE_STUFE.toFixed(1),
    DH_SHORE_RANGE: SDF.maxDistancePx.toFixed(1),
  };
}
