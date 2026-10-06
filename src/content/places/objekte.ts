/**
 * World objects of the places (docs/SPIEL.md §18 "Ortsobjekte", §29 "Objekte `ort_<name>`"; M7-08, M7-09; strand B): the built
 * and natural pieces the place layouts stamp – chests, ruins, the look-out tower, the shrine, the ancient tree, the hermit's
 * hut, the bridge pillars, the graveyard's stones, the meteorite. Kind `ort` (src/content/worldObjects.ts): nothing harvests
 * them (src/game/gathering/rules.ts has no rule for the kind), they block by their footprint and stand exactly on their tiles
 * (no jitter, src/render/world/objects.ts). The sprite carries the id (`assets-src/sprites/orte/**`).
 *
 * Chests (`ort_truhe_1…3` by tier, `ort_truhe_offen` once opened): the places system swaps the object when the chest opens
 * (a chunk change). Footprints: anchored at the object's tile, extending east and north (WORLD.md §3).
 */
import type { z } from 'zod';
import type { LocalizedText } from '../schema/common';
import type { worldObjectSchema } from '../worldObjects';

type PlaceObjectInput = z.input<typeof worldObjectSchema>;

/** The biomes the M7 places stand in (their layouts: Grünhain and Salzküste, the tower, graveyard and bridge ruin also where their slots mostly lie). */
const PLACE_BIOMES = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain'] as const;

/** A place object: not harvestable (hand, hardness 0, one hit point nobody takes), never regrows. */
function ort(id: string, name: LocalizedText, w: 1 | 2, h: 1 | 2, blocking: boolean): PlaceObjectInput {
  return { id: `ort_${id}`, name, kind: 'ort', biomes: [...PLACE_BIOMES], hp: 1, hardness: 0, tool: 'hand', regrowDays: null, footprint: { w, h }, blocking };
}

export const PLACE_OBJECTS: readonly PlaceObjectInput[] = [
  // Chests of the places (§21 "Truhen nach Stufe"): a farmer's wooden chest, an iron-bound one, a Builder casket.
  ort('truhe_1', { de: 'Alte Holztruhe', en: 'Old Wooden Chest' }, 1, 1, true),
  ort('truhe_2', { de: 'Beschlagene Truhe', en: 'Iron-Bound Chest' }, 1, 1, true),
  ort('truhe_3', { de: 'Erbauer-Truhe', en: 'Builder Casket' }, 1, 1, true),
  ort('truhe_offen', { de: 'Offene Truhe', en: 'Open Chest' }, 1, 1, true),
  // Ruins of the Builders: broken pillars of a beacon site, rubble, a bridge pillar.
  ort('saeule', { de: 'Erbauer-Säule', en: 'Builder Pillar' }, 1, 1, true),
  ort('geroell', { de: 'Geröll', en: 'Rubble' }, 1, 1, false),
  ort('brueckenpfeiler', { de: 'Brückenpfeiler', en: 'Bridge Pillar' }, 1, 1, true),
  // Look-out tower (§21 "Aussichtstürme (decken große Kartenbereiche auf)").
  ort('aussichtsturm', { de: 'Aussichtsturm', en: 'Lookout Tower' }, 2, 2, true),
  // Abandoned farmstead (§21 "verlassene Gehöfte (Beute, Geschichten)"): walls, a broken cart, a well, hay, a fence, the note.
  ort('mauer', { de: 'Mauerrest', en: 'Ruined Wall' }, 2, 1, true),
  ort('mauer_kurz', { de: 'Mauerstumpf', en: 'Wall Stump' }, 1, 1, true),
  ort('karren', { de: 'Zerbrochener Karren', en: 'Broken Cart' }, 2, 1, true),
  ort('brunnen', { de: 'Alter Brunnen', en: 'Old Well' }, 1, 1, true),
  ort('heuballen', { de: 'Fauliger Heuballen', en: 'Rotting Hay Bale' }, 1, 1, true),
  ort('zaun', { de: 'Morscher Zaun', en: 'Rotten Fence' }, 1, 1, true),
  ort('notizpfahl', { de: 'Pfahl mit Notiz', en: 'Post with a Note' }, 1, 1, true),
  // Shrine (§21 "Schreine (zeitweiliger Segen)").
  ort('schrein', { de: 'Schrein der Erbauer', en: 'Builder Shrine' }, 2, 1, true),
  // Natural wonder (§21 "Naturwunder (Uraltbaum …)"): the ancient tree and its roots.
  ort('uraltbaum', { de: 'Uraltbaum', en: 'Ancient Tree' }, 2, 2, true),
  ort('wurzel', { de: 'Uralte Wurzel', en: 'Ancient Root' }, 1, 1, false),
  // Dig site (§21 "Buddelstellen"): loose earth marked with a cross of stones.
  ort('buddelmarke', { de: 'Lockere Erde', en: 'Loose Earth' }, 1, 1, false),
  // Hermit's hut (§21 "Eremitenhütte").
  ort('huette', { de: 'Eremitenhütte', en: "Hermit's Hut" }, 2, 2, true),
  ort('feuerstelle', { de: 'Kalte Feuerstelle', en: 'Cold Fire Pit' }, 1, 1, false),
  // Builder graveyard (§21 "Friedhöfe der Erbauer").
  ort('grabstein', { de: 'Grabstein', en: 'Gravestone' }, 1, 1, true),
  ort('obelisk', { de: 'Grabobelisk', en: 'Grave Obelisk' }, 1, 1, true),
  // The iron fence in two pieces: a run along the screen (east–west) and one into it (north–south, the same rails seen end-on).
  ort('eisenzaun', { de: 'Rostiger Eisenzaun', en: 'Rusted Iron Fence' }, 1, 1, true),
  ort('eisenzaun_senkrecht', { de: 'Rostiger Eisenzaun', en: 'Rusted Iron Fence' }, 1, 1, true),
  // Meteorite crater (§21 "Meteoritenkrater"): the star stone in its middle (its ore lies around as `erz_sternenerz`).
  ort('meteorit', { de: 'Meteorit', en: 'Meteorite' }, 2, 2, true),
];
