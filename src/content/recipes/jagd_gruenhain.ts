/**
 * Recipes of the Grünhain hunting goods (M6-22; src/content/items/jagd_gruenhain.ts): the wasp stings are an arrow poison
 * like the fly agaric – one sting poisons four flint arrows at the workbench (the same yield as `rezept_pfeil_gift`).
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the Grünhain hunting goods. */
export const JAGD_GRUENHAIN_REZEPTE = defineRecipeGroup('jagd_gruenhain', [
  recipe({ item: 'pfeil_gift', suffix: 'wespe', anzahl: 4, zutaten: { pfeil_feuerstein: 4, wespenstachel: 1 }, station: 'werkbank', dauer: 'handgriff' }),
]);
