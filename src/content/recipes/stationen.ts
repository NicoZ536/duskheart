/**
 * Recipes of the stations T0 and T1 (MASTERPROMPT §15.2; docs/SPIEL.md §8 "Stationen T0 (M4-05) … T1 (M4-06)";
 * the station records: src/content/stations.ts, the items: src/content/items/stationen.ts).
 *
 * The order of the first days (§23.1): Werkbank I (a basic) builds the sawbuck, the mason's bench, the drying
 * rack, the charcoal kiln and the clay oven from what the island gives; bricks, plaster and a fired crucible
 * make the smelting furnace; its copper bars upgrade Werkbank I in place to Werkbank II (docs/SPIEL.md §8
 * "Aufwertung Werkbank I → II ist ein Rezept an der Station"), which builds the bronze anvil and the spinning
 * wheel; the mason's bench cuts the grindstone.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the station items. */
export const STATIONEN_REZEPTE = defineRecipeGroup('stationen', [
  // ---- T0 (M4-05) ----
  recipe({ item: 'saegebock', zutaten: { holz: 8, zweig: 4, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'steinmetzbank', zutaten: { stein: 12, holz: 6, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'trockengestell', zutaten: { zweig: 12, holz: 4, faserseil: 4 }, station: 'werkbank', dauer: 'gross' }),
  // A woodpile under earth and leaves: the kiln is dug and stacked, the bench cuts its vents.
  recipe({ item: 'koehlermeiler', zutaten: { holz: 12, erde: 12, laub: 10 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'lehmofen', zutaten: { lehm: 16, stein: 8, holz: 4 }, station: 'werkbank', dauer: 'gross' }),
  // ---- T1 (M4-06) ----
  // A brick shaft mortared with plaster around a fired crucible on stone blocks.
  recipe({ item: 'schmelzofen', zutaten: { ziegel: 16, lehmputz: 6, keramik_topf: 1, steinblock: 4 }, station: 'werkbank', dauer: 'gross' }),
  // Werkbank I → II in place: planing bench of planks and beams, a tool wall with copper fittings.
  recipe({ item: 'werkbank_2', zutaten: { brett: 8, balken: 2, kupferbarren: 2, faserseil: 4 }, station: 'werkbank', dauer: 'gross' }, { aufwerten: true }),
  recipe({ item: 'amboss_bronze', zutaten: { bronzebarren: 6, steinblock: 2, balken: 1 }, station: 'werkbank_2', dauer: 'gross' }),
  recipe({ item: 'schleifstein', zutaten: { steinblock: 2, balken: 1, brett: 2 }, station: 'steinmetzbank', dauer: 'gross' }),
  recipe({ item: 'spinnrad', zutaten: { brett: 6, balken: 1, faserseil: 2, nagel_bronze: 4 }, station: 'werkbank_2', dauer: 'gross' }),
]);
