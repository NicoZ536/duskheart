/**
 * Shading constants of the world terrain (M2-28, `shaders/world/terrain.frag`): how the height field
 * of a chunk shades the flat tilesets. Shadows move a pixel's palette index down its own ramp
 * (MASTERPROMPT §4.3 "Schatten Richtung Blau/Violett" – the ramps are hue-shifted), so shaded ground
 * stays in the palette and in the biome's colours; the Bayer dither between steps is anchored to the
 * world (docs/ART.md §2.2 "Dither-Übergänge macht der Shader").
 */
import { PALETTE_RAMPS } from '../../generated/palette';
import { TILE_PX } from '../tilemap/chunk';
import { WAND_PX_JE_STUFE } from '../../world/autotile';

/** Palette indices (1…64) in ramp order; `darkerIndices()[i − 1]` is index i one step darker in its ramp (the darkest stays). */
export function darkerIndices(ramps: readonly { readonly size: number }[] = PALETTE_RAMPS): number[] {
  return rampShift(ramps, -1);
}

/** `lighterIndices()[i − 1]` is index i one step lighter in its ramp (the lightest stays). */
export function lighterIndices(ramps: readonly { readonly size: number }[] = PALETTE_RAMPS): number[] {
  return rampShift(ramps, 1);
}

function rampShift(ramps: readonly { readonly size: number }[], by: number): number[] {
  const out: number[] = [];
  let start = 1;
  for (const r of ramps) {
    for (let step = 0; step < r.size; step++) out.push(start + Math.min(r.size - 1, Math.max(0, step + by)));
    start += r.size;
  }
  return out;
}

export const TERRAIN_SHADING = {
  /** Height of one level in px (§4.4 "16 px sichtbare Wand je Stufe"). */
  levelPx: WAND_PX_JE_STUFE,
  /** Ambient occlusion at the foot of a wall: reach into the tile below [px] and depth [ramp steps]. */
  aoFootPx: 7,
  aoMaxSteps: 2,
  /** Occlusion beside higher ground (plateau sides, rock, the back of a plateau): reach [px] and share of the full depth. */
  aoSidePx: 6,
  aoSideStrength: 0.85,
  /** Contact shadow of a sheer wall's lowest row [px from its foot, one ramp step at the foot]. */
  wallFootPx: 4,
  /** Water: depth (0…3) up to which the shallow bank shows as painted; below, one step darker per depth unit, at most two. */
  waterShallowDepth: 1,
  waterMaxSteps: 2,
  /** Width of the dithered seam between two shade steps: 1 = the whole step dithered, 3 = its middle third. */
  shadeSharpness: 3,
  /**
   * Rock tops in caves: ramp steps below the floor – every ramp sinks to (almost) its darkest colour,
   * so solid rock reads as a dark mass with its lit lip (the rim frames), not as floor in shadow.
   */
  rockTopSteps: 4,
  /** Biome borders: reach of the dithered crossfade into a tile [px] and the share of the neighbour's row at the edge. */
  biomeBlendPx: 6,
  biomeBlendEdge: 0.5,
  /** Cell of the crossfade's dither [px]: 2×2 cells keep colour clusters of at least two pixels. */
  biomeBlendCell: 2,
  /** Offset of the crossfade's Bayer pattern against the shade pattern [px] (the two dithers do not line up). */
  biomeBlendOffset: [2, 1] as const,
  /** Waterfalls: fall speed [px/s] and foam at the lip [px] and at the foot [px, lighter ramp steps]. */
  waterfallSpeed: 24,
  foamLipPx: 3,
  foamFootPx: 6,
  foamFootSteps: 2,
  /** Normal of sheer walls and of ramps/stairs (screen space, +y up): facing the viewer and south. */
  wallNormal: [0, -0.6] as const,
  slopeNormal: [0, -0.35] as const,
} as const;

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the terrain program (the G-buffer constants come with the renderer's global defines). */
export function terrainDefines(): Readonly<Record<string, string>> {
  const s = TERRAIN_SHADING;
  return {
    DH_TILE_SIZE: glslFloat(TILE_PX),
    DH_DARKER_INDICES: darkerIndices().join(', '),
    DH_LIGHTER_INDICES: lighterIndices().join(', '),
    DH_WATERFALL_SPEED: glslFloat(s.waterfallSpeed),
    DH_BIOME_BLEND_PX: glslFloat(s.biomeBlendPx),
    DH_BIOME_BLEND_EDGE: glslFloat(s.biomeBlendEdge),
    DH_BIOME_BLEND_CELL: glslFloat(s.biomeBlendCell),
    DH_BIOME_BLEND_OFFSET: `vec2(${glslFloat(s.biomeBlendOffset[0])}, ${glslFloat(s.biomeBlendOffset[1])})`,
    DH_FOAM_LIP_PX: glslFloat(s.foamLipPx),
    DH_FOAM_FOOT_PX: glslFloat(s.foamFootPx),
    DH_FOAM_FOOT_STEPS: glslFloat(s.foamFootSteps),
    DH_LEVEL_PX: glslFloat(s.levelPx),
    DH_AO_FOOT_PX: glslFloat(s.aoFootPx),
    DH_AO_MAX_STEPS: glslFloat(s.aoMaxSteps),
    DH_AO_SIDE_PX: glslFloat(s.aoSidePx),
    DH_AO_SIDE_STRENGTH: glslFloat(s.aoSideStrength),
    DH_WALL_FOOT_PX: glslFloat(s.wallFootPx),
    DH_WATER_SHALLOW_DEPTH: glslFloat(s.waterShallowDepth),
    DH_WATER_MAX_STEPS: glslFloat(s.waterMaxSteps),
    DH_ROCK_TOP_STEPS: glslFloat(s.rockTopSteps),
    DH_SHADE_SHARPNESS: glslFloat(s.shadeSharpness),
    DH_WALL_NORMAL: `vec2(${glslFloat(s.wallNormal[0])}, ${glslFloat(s.wallNormal[1])})`,
    DH_SLOPE_NORMAL: `vec2(${glslFloat(s.slopeNormal[0])}, ${glslFloat(s.slopeNormal[1])})`,
  };
}
