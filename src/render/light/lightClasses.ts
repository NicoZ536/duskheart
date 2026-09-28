/**
 * What every atlas texel is to the sun (M5-02, M5-05): a map of the atlas (one byte per texel) that the shadow pass
 * reads beside the albedo – bit 0: the texel belongs to a sprite that casts the sun's silhouette (`schatten:
 * 'silhouette'` or an occluder footprint), bit 1: it belongs to a glass part, whose glossy panes (material `nass`)
 * tint the light they let through (the stained-glass window throws its colours into the room).
 *
 * The walls, doors, gates, windows and roofs of the build grid do not cast as sprites: the grid casts them as blocks
 * (`sunCasters.ts`, `buildingOccluders.ts`), so a house's shadow does not change when its roof fades and its front
 * wall is cut for the view inside. Their windows' panes are sampled from the atlas there – hence the glass bit.
 *
 * Built once per atlas from the manifest (whole frame rectangles; the albedo decides per pixel what is opaque and
 * what is pane). Glass parts are the build parts of material `glas` (src/content/buildParts.ts).
 */
import { BUILD_PARTS, buildPartSecondSpriteId, buildPartSpriteId, type PartKind } from '../../content/buildParts';
import type { AtlasManifest, AtlasSprite } from '../assets/atlas';

/** Bits of a texel's light class. */
export const LIGHT_CLASS = { caster: 1, glass: 2 } as const;

/** Kinds of build parts the grid casts (their sprites do not). */
export const GRID_CAST_KINDS: readonly PartKind[] = ['wand', 'tuer', 'tor', 'fenster', 'dach'];

/** Sprite ids of the glass build parts (windows and roofs of material `glas`). */
export function glassSpriteIds(): ReadonlySet<string> {
  return new Set(BUILD_PARTS.filter((p) => p.material === 'glas').map((p) => buildPartSpriteId(p.id, p.art)));
}

/** Sprite ids of the build parts the grid casts (walls, doors, gates with their side view, windows, roofs). */
export function gridCastSpriteIds(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const p of BUILD_PARTS) {
    if (!GRID_CAST_KINDS.includes(p.art)) continue;
    out.add(buildPartSpriteId(p.id, p.art));
    const second = buildPartSecondSpriteId(p.id, p.art);
    if (second !== null) out.add(second);
  }
  return out;
}

/** Whether a sprite casts the sun's silhouette shadow (build parts of the grid excepted: see `gridCastSpriteIds`). */
export function castsSunShadow(sprite: AtlasSprite, grid: ReadonlySet<string> = gridCastSpriteIds()): boolean {
  if (grid.has(sprite.id)) return false;
  return sprite.sunShadow === true || (sprite.occluder !== undefined && sprite.occluder.kind !== 'none');
}

/** Light class of every texel of `manifest`'s atlas, row-major from the top (the atlas's texel rows). */
export function lightClassPixels(manifest: AtlasManifest, glass: ReadonlySet<string> = glassSpriteIds(), grid: ReadonlySet<string> = gridCastSpriteIds()): Uint8Array {
  const w = manifest.width;
  const out = new Uint8Array(w * manifest.height);
  for (const sprite of Object.values(manifest.sprites)) {
    const bits = (castsSunShadow(sprite, grid) ? LIGHT_CLASS.caster : 0) | (glass.has(sprite.id) ? LIGHT_CLASS.glass : 0);
    if (bits === 0) continue;
    // Identical frames of different sprites share a rectangle: their classes add up.
    for (const f of sprite.frames) {
      for (let y = f.y; y < f.y + f.h; y++) {
        const row = y * w;
        for (let x = f.x; x < f.x + f.w; x++) out[row + x] = (out[row + x] ?? 0) | bits;
      }
    }
  }
  return out;
}
