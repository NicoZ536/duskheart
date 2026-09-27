/**
 * How the things of the base sound when they are handled (MASTERPROMPT §16.2 materials, §27 "Bauen"): the sound
 * material of a build part or a station body picks its placing and dismantling presets (`sfx_bau_setzen_<material>`,
 * `sfx_bau_abbauen_<material>`, src/audio/baseSounds.ts). Content names it (a station's `sounds.koerper`,
 * src/content/stations.ts), the audio maps it; kept apart from the preset data so content can use it without loading
 * every preset.
 */

/** Sound materials: timber, straw, stone, clay, glass and metal (the bronze anvil). */
export const SOUND_MATERIALS = ['holz', 'stroh', 'stein', 'lehm', 'glas', 'metall'] as const;
/** One sound material. */
export type SoundMaterial = (typeof SOUND_MATERIALS)[number];
