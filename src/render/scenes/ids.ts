/**
 * Ids of the render debug scenes (scenarios, E2E, bench) and the stress numbers of `sprites-5000` –
 * a module without imports, so Node-side tools and tests can read them without loading the scenes
 * (those import build artefacts through `import.meta.glob`).
 */
export const RENDER_SCENE_IDS = ['gruenhain', 'welt-ui', 'palette', 'testszene', 'palette-swap', 'ysort', 'anim-layers', 'gbuffer', 'sprites-5000', 'spielatlas', 'tilemap', 'tilemap-probe', 'normalmap-licht', 'post-grundlage', 'licht-probe'] as const;
export type RenderSceneId = (typeof RENDER_SCENE_IDS)[number];

export function isRenderSceneId(id: string): id is RenderSceneId {
  return (RENDER_SCENE_IDS as readonly string[]).includes(id);
}

/** Animated sprites of the scene `sprites-5000` (M1-24, §32 M1). */
export const STRESS_SPRITES = 5000;
/** Point lights of the scene `sprites-5000` (M1-24; the §6.3 quality level "Niedrig" draws exactly 32). */
export const STRESS_LIGHTS = 32;
