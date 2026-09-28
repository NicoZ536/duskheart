/**
 * Start of the E2E specs that judge game logic, UI and data – not a render effect (MASTERPROMPT §31.3, §6.3; ADR
 * „M5-Integration: Frame-Pfad und E2E“).
 *
 * Under headless Chromium every WebGL command runs on SwiftShader, a CPU rasteriser: the full M5 pipeline – occluder
 * mask and jump-flood distance field, sun and moon silhouettes, water, GPU particles, fog, bloom, corruption, puddles,
 * the grass interaction texture – takes 0.3–0.9 s per frame there, the M4 pipeline took 0.08–0.16 s; and its shader
 * programs are compiled at their first draw, which delays the page start by seconds. Specs whose checks count frames or
 * wait for simulation ticks (a pause that holds while the tab is hidden, a menu that closes within two frames, 60 s of
 * walking across 20 chunk borders) would measure the rasteriser instead of the game. They therefore open the page with
 * `logicUrl`:
 * - at the lowest quality level, set in the URL like a player's choice (`quality=low`, §6.3): the first-start benchmark
 *   of M5-26 does not run (on SwiftShader it would choose this level anyway, after a few slow frames);
 * - with the passes of M5 that add picture, not information, held off from the first frame (`passesOff=…`,
 *   `PassRegistry.holdOff`): the simulation, the gameplay light map (§12.1, computed by the simulation), HUD, menus, the
 *   world UI and the debug state read none of them. Terrain, sprites, point lights, composition, tone mapping, outline,
 *   debug overlay and world UI keep running. A name that is no registered pass is reported as a console error, which
 *   every logic spec fails on – a renamed pass cannot silently bring the full pipeline back.
 *
 * Effect specs (render-*, water, light, cloud shadows, light map comparison, the quality strand's specs) keep the full
 * pipeline and set the level they judge themselves.
 */

/** Quality level of the logic specs (§6.3 "Niedrig"). */
export const LOGIC_QUALITY = 'low';

/** Passes of M5 that add picture only (`PASS_ORDER` names, src/render/passes/registry.ts): held off in a logic spec. */
export const IMAGE_ONLY_PASSES = [
  'oberflaeche-interaktion',
  'occluder',
  'shadow',
  'pfuetzen',
  'corruption',
  'water',
  'heat-shimmer',
  'particles',
  'lightning',
  'atmosphere',
  'distortion',
  'bloom',
] as const;

/**
 * URL of the game page for a logic spec: the debug API, the logic quality level, the image-only passes held off and
 * `query` (e.g. `spieler=1`).
 */
export function logicUrl(query = ''): string {
  return `/?debug=1&quality=${LOGIC_QUALITY}&passesOff=${IMAGE_ONLY_PASSES.join(',')}${query === '' ? '' : `&${query}`}`;
}
