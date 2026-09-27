/**
 * Recipes of the bronze tools T1 (MASTERPROMPT §13.2 "T1 Bronze", §14 "Werkzeuge"; M4-10 "Bronzewerkzeuge außer
 * der Spitzhacke"; the items: src/content/items/verarbeitung_bronzewerkzeuge.ts): hammered from bronze bars at
 * the bronze anvil, a log split into the haft; sickle and knife get a grip wrapped in yarn. The bronze pickaxe
 * needs the Kernholz of the Borkenvater (§13.2, src/content/gating.ts) and follows with M7-34.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the bronze tools. */
export const BRONZE_REZEPTE = defineRecipeGroup('bronze', [
  recipe({ item: 'bronzeaxt', zutaten: { bronzebarren: 3, holz: 2 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzeschaufel', zutaten: { bronzebarren: 3, holz: 2 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzehacke', zutaten: { bronzebarren: 2, holz: 2 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzesichel', zutaten: { bronzebarren: 2, holz: 1, garn: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzehammer', zutaten: { bronzebarren: 4, holz: 2 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
  recipe({ item: 'bronzemesser', zutaten: { bronzebarren: 1, holz: 1, garn: 1 }, station: 'amboss_bronze', dauer: 'werkzeug' }),
]);
