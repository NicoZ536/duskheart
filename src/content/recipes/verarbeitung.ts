/**
 * Recipes of the processing products T0–T1 (MASTERPROMPT §15.1, §15.2, §15.4; docs/SPIEL.md §8
 * "Verarbeitungsprodukte T0–T1"; M4-10; the items: src/content/items/verarbeitung.ts).
 *
 * - At hand stations the player's queue makes them (sawbuck: planks, beams, shingles; mason's bench: stone
 *   blocks; spinning wheel: yarn; bronze anvil: nails; workbench: clay plaster, a bundle of torches, a bucket
 *   of planks; campfire: a little charcoal in the embers).
 * - Processing stations run batches from their input and fuel slots on their own (§15.1): the drying rack
 *   dries straw and raw bricks without fuel, the charcoal kiln chars any timber (`bauholz`: log or
 *   driftwood), the clay oven fires bricks, pots and glass, the smelting furnace smelts copper and tin and
 *   alloys bronze – three parts copper to one part tin (§13.2 "T1 Bronze").
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the processing products and the station variants of basics. */
export const VERARBEITUNG_REZEPTE = defineRecipeGroup('verarbeitung', [
  // Charcoal: a kiln load, or a little from the embers of a lit campfire.
  recipe({ item: 'holzkohle', anzahl: 3, gruppen: { bauholz: 4 }, station: 'koehlermeiler', dauer: 'koehlern' }),
  recipe({ item: 'holzkohle', zutaten: { holz: 3 }, station: 'lagerfeuer', dauer: 'gross', suffix: 'lagerfeuer' }),
  // Sawbuck.
  recipe({ item: 'brett', anzahl: 2, gruppen: { bauholz: 1 }, station: 'saegebock', dauer: 'werkzeug' }),
  recipe({ item: 'balken', gruppen: { bauholz: 2 }, station: 'saegebock', dauer: 'werkzeug' }),
  recipe({ item: 'dachschindel', anzahl: 4, zutaten: { brett: 1 }, station: 'saegebock', dauer: 'handgriff' }),
  // Mason's bench.
  recipe({ item: 'steinblock', zutaten: { stein: 4 }, station: 'steinmetzbank', dauer: 'werkzeug' }),
  // Drying rack (no fuel).
  recipe({ item: 'strohbuendel', zutaten: { fasern: 6 }, station: 'trockengestell', dauer: 'trocknen' }),
  recipe({ item: 'ziegel_roh', anzahl: 2, zutaten: { lehm: 2, sand: 1 }, station: 'trockengestell', dauer: 'trocknen' }),
  // Clay oven.
  recipe({ item: 'ziegel', anzahl: 2, zutaten: { ziegel_roh: 2 }, station: 'lehmofen', dauer: 'brennen' }),
  recipe({ item: 'keramik_topf', zutaten: { lehm: 3 }, station: 'lehmofen', dauer: 'brennen' }),
  recipe({ item: 'glas', zutaten: { sand: 3 }, station: 'lehmofen', dauer: 'brennen' }),
  // Workbench.
  recipe({ item: 'lehmputz', anzahl: 3, zutaten: { lehm: 2, sand: 1, strohbuendel: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'fackel', anzahl: 4, zutaten: { zweig: 4, harz: 2, fasern: 6 }, station: 'werkbank', dauer: 'werkzeug', suffix: 'werkbank' }),
  recipe({ item: 'holzeimer', zutaten: { brett: 4, faserseil: 1, harz: 1 }, station: 'werkbank', dauer: 'werkzeug', suffix: 'werkbank' }),
  // Smelting furnace (charcoal or hotter).
  recipe({ item: 'kupferbarren', zutaten: { kupfererz: 2 }, station: 'schmelzofen', dauer: 'schmelzen' }),
  recipe({ item: 'zinnbarren', zutaten: { zinnerz: 2 }, station: 'schmelzofen', dauer: 'schmelzen' }),
  recipe({ item: 'bronzebarren', anzahl: 4, zutaten: { kupferbarren: 3, zinnbarren: 1 }, station: 'schmelzofen', dauer: 'schmelzen' }),
  // Spinning wheel and bronze anvil.
  recipe({ item: 'garn', anzahl: 2, zutaten: { fasern: 4 }, station: 'spinnrad', dauer: 'werkzeug' }),
  recipe({ item: 'nagel_bronze', anzahl: 8, zutaten: { bronzebarren: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
]);
