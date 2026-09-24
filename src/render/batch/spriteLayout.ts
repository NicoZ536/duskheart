/**
 * Sprite instance record (docs/RENDER.md §3 "Instanzattribute"): 44 bytes per sprite, interleaved in
 * one instance buffer. Positions are world pixels of the anchor after interpolation; snapping to
 * whole pixels happens in the vertex shader (§3.3 "Pixel-Snapping erst nach der Interpolation").
 *
 * | Byte | Attribute (location) | Type | Content |
 * |---|---|---|---|
 * | 0 | aPos (1) | f32×2 | anchor world x, y |
 * | 8 | aParams (2) | f32×4 | height base px, wind amplitude px, wind phase rad, rotation rad |
 * | 24 | aRect (3) | u16×4 → uvec4 | atlas frame x, y, w, h |
 * | 32 | aAnchor (4) | i16×2 → ivec2 | anchor in the frame (pixel edges, 0,0 = top-left corner) |
 * | 36 | aTint (5) | u8×4 normalised | overlay colour rgb + strength |
 * | 40 | aMisc (6) | u8×4 → uvec4 | palette row, flags, emissive boost, dither fade |
 *
 * The y-sort depth is a CPU-side key (`SpriteList.depth`), not uploaded.
 */

/** Draw layers in painter's order (MASTERPROMPT §6.1 pass 2). */
export const SPRITE_LAYERS = ['ground', 'water', 'objects', 'canopy'] as const;
export type SpriteLayer = (typeof SPRITE_LAYERS)[number];
export const LAYER_COUNT = SPRITE_LAYERS.length;

export const LAYER: Readonly<Record<SpriteLayer, number>> = { ground: 0, water: 1, objects: 2, canopy: 3 };

/** Instance flags (aMisc.y). */
export const SPRITE_FLAG = {
  mirror: 1,
  outline: 2,
  flash: 4,
  wind: 8,
  /** Canopy pixels (material `canopy`) dither out inside the fade circle around the player (§6.2). */
  canopyFade: 16,
} as const;

export const INSTANCE_STRIDE = 44;
export const INSTANCE_WORDS = INSTANCE_STRIDE / Uint32Array.BYTES_PER_ELEMENT;

/** Byte offsets of the attributes. */
export const OFFSET = {
  pos: 0,
  params: 8,
  rect: 24,
  anchor: 32,
  tint: 36,
  misc: 40,
} as const;

/** Attribute locations (`layout(location = …)` in sprite_gbuffer.vert). */
export const LOCATION = {
  corner: 0,
  pos: 1,
  params: 2,
  rect: 3,
  anchor: 4,
  tint: 5,
  misc: 6,
} as const;

/** Largest value of an 8-bit channel. */
export const BYTE_MAX = 255;
/** Palette rows addressable by an instance (aMisc.x is 8 bits). */
export const MAX_PALETTE_ROWS = BYTE_MAX + 1;

/** Bytes of the instance data for `n` sprites. */
export function instanceBytes(n: number): number {
  return Math.max(0, Math.floor(n)) * INSTANCE_STRIDE;
}

/** Capacity (instances) after growing by doubling from `current` until `needed` fits. */
export function grownCapacity(current: number, needed: number): number {
  let cap = Math.max(1, current);
  while (cap < needed) cap *= 2;
  return cap;
}

/** Draw calls for one atlas: one per non-empty layer. */
export function drawCallsFor(layerCounts: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < layerCounts.length; i++) if ((layerCounts[i] ?? 0) > 0) n++;
  return n;
}
