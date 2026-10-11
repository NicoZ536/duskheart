/**
 * Recipes of the M7 talismans (src/content/items/schmuck_m7.ts; M7-62): strung at the workbench like the wolf fang necklace
 * (§15.1 craft time class `werkzeug`, 3 s) – the bone carved, the feathers bound, the shells pierced, each on a sinew cord.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the talismans. */
export const SCHMUCK_M7_REZEPTE = defineRecipeGroup('schmuck_m7', [
  recipe({ item: 'knochentalisman', zutaten: { knochen: 2, sehnen: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'federtalisman', zutaten: { federn: 3, sehnen: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'muscheltalisman', zutaten: { muschel: 3, sehnen: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
