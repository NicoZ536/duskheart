/**
 * Recipes of the build part items T0–T1 (MASTERPROMPT §16.2; docs/SPIEL.md §8 "Bauteile (M4-12)",
 * "Verarbeitungsprodukte T0–T1"; M4-12; the items: src/content/items/bauteile.ts, how they are placed:
 * src/content/buildParts.ts).
 *
 * The parts are assembled from the processing products of the sawbuck, the mason's bench, the drying rack and
 * the clay oven (src/content/recipes/verarbeitung.ts): planks, beams, shingles, stone blocks, straw bundles,
 * clay plaster, glass and bronze nails. Palisade, rammed clay, fences and the ladder need only what the land
 * gives (logs, twigs, clay, gravel, stone, rope). Parts of wood and straw are made at the workbench, stone
 * parts at the mason's bench, the T1 parts with glass, beams and bronze at the Werkbank II.
 *
 * Quantities follow the material a tile of the part holds: a plank wall three planks (a log and a half), a
 * floor or window frame two, a door four, the two-leaf gate eight; a straw roof tile two bundles on twigs, a
 * shingle tile four shingles and a nail. Dismantling gives back a share of exactly these ingredients
 * (§16.6 "100 % zurück in den ersten 30 s, danach 60 %", `BALANCE.building.refund`).
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the build part items. */
export const BAUTEIL_REZEPTE = defineRecipeGroup('bauteile', [
  // Walls.
  recipe({ item: 'wand_palisade', zutaten: { holz: 3, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'wand_holz', zutaten: { brett: 3 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'wand_fachwerk', zutaten: { balken: 1, lehmputz: 2 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'wand_stein', zutaten: { steinblock: 2, lehmputz: 1 }, station: 'steinmetzbank', dauer: 'werkzeug' }),
  // Floors.
  recipe({ item: 'boden_holz', zutaten: { brett: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'boden_stein', zutaten: { steinblock: 1 }, station: 'steinmetzbank', dauer: 'handgriff' }),
  recipe({ item: 'boden_lehm', zutaten: { lehm: 2, kies: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  // Roofs.
  recipe({ item: 'dach_stroh', zutaten: { strohbuendel: 2, zweig: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'dach_schindel', zutaten: { dachschindel: 4, nagel_bronze: 1 }, station: 'werkbank_2', dauer: 'handgriff' }),
  recipe({ item: 'dach_glas', zutaten: { glas: 2, balken: 1 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  // Doors, gate, trapdoor.
  recipe({ item: 'tuer_holz', zutaten: { brett: 4, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'tuer_verstaerkt', zutaten: { brett: 4, bronzebarren: 1, nagel_bronze: 4 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'tor_holz', zutaten: { brett: 8, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'falltuer_holz', zutaten: { brett: 3, faserseil: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  // Windows.
  recipe({ item: 'fenster_offen', zutaten: { brett: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'fenster_glas', zutaten: { glas: 1, brett: 2 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  // Stained glass: two panes cut into pieces, copper for the cames (and the green and blue of its glass), the red of
  // a poppy painted on and fired, planks for the frame.
  recipe({ item: 'fenster_buntglas', zutaten: { glas: 2, kupferbarren: 1, blume_rot: 1, brett: 2 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  // Pillars and fences.
  recipe({ item: 'saeule_holz', zutaten: { balken: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'saeule_stein', zutaten: { steinblock: 2 }, station: 'steinmetzbank', dauer: 'werkzeug' }),
  recipe({ item: 'zaun_holz', anzahl: 2, zutaten: { zweig: 4, holz: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'zaun_stein', anzahl: 2, zutaten: { stein: 6, lehm: 1 }, station: 'steinmetzbank', dauer: 'werkzeug' }),
  // Ways up a cliff and over the water.
  recipe({ item: 'leiter_holz', zutaten: { zweig: 6, faserseil: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'treppe_holz', zutaten: { brett: 4, balken: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'steg_holz', zutaten: { brett: 2, balken: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
