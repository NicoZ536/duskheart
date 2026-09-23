/**
 * G-buffer layout (MASTERPROMPT §6.1 pass 2, docs/RENDER.md §3, ADR-0011). The sprite shader writes
 * three RGBA8 attachments; lighting and composition read them through `shaders/gbuffer.glsl`.
 *
 * | Attachment | R | G | B | A |
 * |---|---|---|---|---|
 * | G0 albedo | palette colour (row, flash, tint applied) | | | coverage (1 = drawn) |
 * | G1 normal | normal x | normal y (+y = screen up) | height above ground / 128 px | material bits / 255 |
 * | G2 emissive | emissive intensity / 4 | gloss | wetness | mask bits / 255 (water, outline) |
 *
 * Height above ground: upright sprites (objects, canopy) add the distance of the pixel above their
 * anchor, flat sprites (ground, water) do not; the relief from the normal atlas (0…32 px) and the
 * instance's height base are added on top.
 */
import type { AttachmentSpec } from './gl/framebuffer';

export const GBUFFER_ATTACHMENTS: readonly AttachmentSpec[] = [
  { name: 'albedo', format: 'RGBA8' },
  { name: 'normal', format: 'RGBA8' },
  { name: 'emissive', format: 'RGBA8' },
];

export const GBUFFER_ALBEDO = 0;
export const GBUFFER_NORMAL = 1;
export const GBUFFER_EMISSIVE = 2;

/** Height range of the normal atlas B channel (docs/RENDER.md §2: 0…255 ≙ 0…32 px). */
export const ATLAS_HEIGHT_RANGE_PX = 32;
/** Height range of G1.B: tall trees (up to 96 px) plus relief and height base fit, at 0.5 px steps. */
export const GBUFFER_HEIGHT_RANGE_PX = 128;
/** Emissive intensity range of G2.R (emissive pixels at full boost reach it). */
export const EMISSIVE_RANGE = 4;
/** Largest extra emissive factor an instance can request (`emissiveBoost` 1.0 → ×(1 + 3)). */
export const EMISSIVE_BOOST_MAX = EMISSIVE_RANGE - 1;
/** Bits of G2.A: pixel of the water layer; pixel of a sprite with the interaction outline (§4.6). */
export const GBUFFER_MASK = {
  water: 1,
  outline: 2,
} as const;

/** Material bits of the albedo atlas B channel (docs/RENDER.md §2). */
export const MATERIAL = {
  metal: 1,
  wet: 2,
  ice: 4,
  wind: 8,
  canopy: 16,
} as const;
export type MaterialName = keyof typeof MATERIAL;

/** Gloss written to G2.G per material (strongest wins); everything else is matte. */
export const GLOSS = {
  metal: 0.85,
  ice: 0.7,
  wet: 0.5,
  matte: 0,
} as const;

/** Wind sway frequency in rad/s (the phase per instance desynchronises neighbours). */
export const WIND_FREQUENCY = 2.1;

/** Clear values: nothing drawn, flat normal at ground level, no emission. */
export const GBUFFER_CLEAR: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [0.5, 0.5, 0, 0],
  [0, 0, 0, 0],
];

/** `#define`s every shader gets, so GLSL and TypeScript share one set of constants. */
export function gbufferDefines(): Readonly<Record<string, string>> {
  const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return {
    DH_ATLAS_HEIGHT_RANGE: f(ATLAS_HEIGHT_RANGE_PX),
    DH_GBUFFER_HEIGHT_RANGE: f(GBUFFER_HEIGHT_RANGE_PX),
    DH_EMISSIVE_RANGE: f(EMISSIVE_RANGE),
    DH_EMISSIVE_BOOST_MAX: f(EMISSIVE_BOOST_MAX),
    DH_MASK_WATER: `${GBUFFER_MASK.water}u`,
    DH_MASK_OUTLINE: `${GBUFFER_MASK.outline}u`,
    DH_MAT_METAL: `${MATERIAL.metal}u`,
    DH_MAT_WET: `${MATERIAL.wet}u`,
    DH_MAT_ICE: `${MATERIAL.ice}u`,
    DH_MAT_WIND: `${MATERIAL.wind}u`,
    DH_MAT_CANOPY: `${MATERIAL.canopy}u`,
    DH_GLOSS_METAL: f(GLOSS.metal),
    DH_GLOSS_ICE: f(GLOSS.ice),
    DH_GLOSS_WET: f(GLOSS.wet),
    DH_WIND_FREQUENCY: f(WIND_FREQUENCY),
  };
}
