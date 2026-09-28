/**
 * The buffers of the render debugger (MASTERPROMPT §6.3 "Render-Debugger (Debug-Modus): jeden Puffer einzeln anzeigen –
 * Albedo, Normalen, Höhe, Emissiv, SDF, Sonnenschatten, Licht, GI, Nässe, Nebel, Gameplay-Lichtkarte", M5-27): which
 * view shows which of them, the further views of the M5 strands, and the texts of the debugger's caption
 * (`debug.puffer.<view>`: name, `.legende`: how to read the colours) – DE and EN in src/i18n.
 */

/** The eleven buffers §6.3 requires, as view names (`__dh.call('renderDebug', name)`), in the order of §6.3. */
export const REQUIRED_DEBUG_VIEWS = [
  'albedo', // Albedo: G0, the palette colour of every pixel
  'normal', // Normalen: G1.xy
  'height', // Höhe: G1.b, height above the ground
  'emissive', // Emissiv: G2.r, the glowing pixels in their colour
  'sdf', // SDF: the occluder distance field (light strand, M5-01)
  'sun', // Sonnenschatten: the silhouettes of sun or moon (M5-02)
  'light', // Licht: the point and spot light of the light pass (M5-05)
  'gi', // GI: the radiance cascades' slot – empty until M13 (render/debug/giSlot.ts)
  'wet', // Nässe: G2.b, wetness (M5-20)
  'fog', // Nebel: the fog density of the atmosphere pass (M5-10)
  'lightmap', // Gameplay-Lichtkarte: the light map against the rendered light (M3-21, M5-28)
] as const;
export type RequiredDebugView = (typeof REQUIRED_DEBUG_VIEWS)[number];

/**
 * Every view the renderer and its strands register (the required ones and the extras: material bits, gloss, masks,
 * the lit HDR image, glints, cloud shadows, distortion, waves, snow, puddles, grass interaction, light map of the
 * sources). Each has a caption in DE and EN.
 */
export const DEBUG_VIEW_NAMES = [
  ...REQUIRED_DEBUG_VIEWS,
  'material',
  'gloss',
  'water',
  'outline',
  'hdr',
  'specular',
  'wolken',
  'distortion',
  'wellen',
  'schnee',
  'pfuetze',
  'interaktion',
  'lightmap-quellen',
] as const;
export type DebugViewName = (typeof DEBUG_VIEW_NAMES)[number];

export function isKnownDebugView(name: string): name is DebugViewName {
  return (DEBUG_VIEW_NAMES as readonly string[]).includes(name);
}

/** i18n key of a view's name in the caption. */
export function debugViewLabelKey(name: DebugViewName): string {
  return `debug.puffer.${name}`;
}

/** i18n key of the line under the name: how to read the view. */
export function debugViewLegendKey(name: DebugViewName): string {
  return `debug.puffer.${name}.legende`;
}
