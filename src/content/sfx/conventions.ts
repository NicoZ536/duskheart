/**
 * Id conventions of the SFX presets (docs/SPIEL.md §5 `sfx_<bereich>_<name>`) that code derives at
 * runtime instead of writing the id out: the footstep of a ground material. Kept apart from the preset
 * data so tools can use it without loading every preset.
 */
import { FOOTSTEP_MATERIALS, type FootstepMaterial } from '../terrain';

/** Folder of the preset definitions (their ids there are definitions, not uses). */
export const SFX_SOURCE_DIR = 'src/content/sfx';

/** Footstep sound of a ground material (`FOOTSTEP_MATERIALS` of the terrain content; wooden floors `holz`, wading `wasser`). */
export function footstepSfxId(material: FootstepMaterial | 'holz' | 'wasser'): string {
  return `sfx_schritt_${material}`;
}

/**
 * Presets whose ids are derived at runtime instead of written out anywhere – the footsteps of every
 * terrain footstep material (src/audio/eventMap.ts). The validator counts them as used.
 */
export function sfxConventionIds(): string[] {
  return FOOTSTEP_MATERIALS.map((m) => footstepSfxId(m));
}
