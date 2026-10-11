/**
 * Recipes of water (MASTERPROMPT §18 "Abkochen macht sauber, Regensammler, … Trinkschlauch, … geschmolzener Schnee";
 * docs/SPIEL.md §21 "Wasser"; M7-30; items in src/content/items/wasser.ts):
 * - **Boiling**: a bucket of water boiled at a camp fire or in the cauldron becomes a bucket of boiled water – the same bucket
 *   (`behaelt` its durability), five clean sips.
 * - **Melting snow**: four handfuls of snow in an empty bucket at the fire – boiled water as well.
 * - **Water skin**: leather sewn at the tailor's table, sealed with resin.
 * - **Rain collector**: a barrel of planks with a funnel – at the workbench.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of water. */
export const WASSER_REZEPTE = defineRecipeGroup('wasser', [
  recipe({ item: 'wasser_abgekocht', zutaten: { holzeimer_wasser: 1 }, station: 'lagerfeuer', dauer: 'werkzeug' }, { name: { de: 'Wasser abkochen', en: 'Boil Water' }, behaelt: 'haltbarkeit' }),
  recipe({ item: 'wasser_abgekocht', suffix: 'kessel', zutaten: { holzeimer_wasser: 1 }, station: 'kessel', dauer: 'werkzeug' }, { name: { de: 'Wasser abkochen', en: 'Boil Water' }, behaelt: 'haltbarkeit' }),
  recipe({ item: 'wasser_abgekocht', suffix: 'schnee', zutaten: { holzeimer: 1, schnee: 4 }, station: 'lagerfeuer', dauer: 'werkzeug' }, { name: { de: 'Schnee schmelzen', en: 'Melt Snow' }, behaelt: 'haltbarkeit' }),
  recipe({ item: 'trinkschlauch', zutaten: { leder: 2, faserseil: 1, harz: 1 }, station: 'schneidertisch', dauer: 'werkzeug' }),
  recipe({ item: 'regensammler', zutaten: { brett: 5, faserseil: 2, harz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
