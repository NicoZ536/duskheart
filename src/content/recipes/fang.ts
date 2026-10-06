/**
 * Recipes of fishing (docs/SPIEL.md §20 "Angeln", §29; MASTERPROMPT §14 "Angel (T0 Stock + Faser + Knochenhaken …)", "Reusen";
 * M7-24; items in src/content/items/fang.ts): the bone hook carved from a bone (two per bone), the stick rod from a twig,
 * fibre line and a hook – both in the hand like the stone tools –, and the fish trap woven from twigs and rope at the
 * workbench.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of fishing. */
export const FANG_REZEPTE = defineRecipeGroup('fang', [
  recipe({ item: 'knochenhaken', anzahl: 2, zutaten: { knochen: 1 }, station: null, dauer: 'werkzeug' }),
  recipe({ item: 'angel_holz', zutaten: { zweig: 2, fasern: 3, knochenhaken: 1 }, station: null, dauer: 'werkzeug' }),
  recipe({ item: 'reuse', zutaten: { zweig: 8, faserseil: 2 }, station: 'werkbank', dauer: 'gross' }),
]);
