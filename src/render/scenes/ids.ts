/**
 * Ids of the render debug scenes (scenarios, E2E, bench) and the stress numbers of `sprites-5000` –
 * a module without imports, so Node-side tools and tests can read them without loading the scenes
 * (those import build artefacts through `import.meta.glob`).
 */
export const RENDER_SCENE_IDS = [
  'gruenhain',
  'welt-ui',
  'palette',
  'testszene',
  'palette-swap',
  'ysort',
  'anim-layers',
  'gbuffer',
  'sprites-5000',
  'spielatlas',
  'tilemap',
  'tilemap-probe',
  'normalmap-licht',
  'post-grundlage',
  'licht-probe',
  // The game view: the session's world under the camera of the controlled figure (M2-29, src/render/world/gameScene.ts).
  'spiel',
  // The generated world (M2-28, src/render/world/worldScene.ts `WORLD_SCENE_IDS`).
  'gruenhain-tag',
  'frostkamm-tag',
  'glutsand-tag',
  'ebene-1-roh',
  // The GPU particle showcase and its stress version with ≥ 20 000 particles (M5-11, src/render/particles/showcase.ts).
  'partikel',
  'partikel-20000',
  'partikel-gewitter',
  // The effect shaders of the sprites: outline, white flash, palette swap, dither fades (M5-24, src/render/surface/effectShowcase.ts).
  'shader-outline',
  'shader-weissblitz',
  'shader-palettentausch',
  'shader-dither',
  // The player's weapons turned freely towards eight aims in the low-res buffer (M6-01, src/render/game/combatShowcase.ts).
  'waffe-rotation',
] as const;
export type RenderSceneId = (typeof RENDER_SCENE_IDS)[number];

export function isRenderSceneId(id: string): id is RenderSceneId {
  return (RENDER_SCENE_IDS as readonly string[]).includes(id);
}

/** Animated sprites of the scene `sprites-5000` (M1-24, §32 M1). */
export const STRESS_SPRITES = 5000;
/** Point lights of the scene `sprites-5000` (M1-24; the §6.3 quality level "Niedrig" draws exactly 32). */
export const STRESS_LIGHTS = 32;
/** Particles alive at once in the scene `partikel-20000` at least (M5-11, §30 "20 000 Partikel"). */
export const STRESS_PARTICLES = 20000;
