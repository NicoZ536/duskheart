/**
 * Recipes of the Salt Coast hunting goods (M6 gate; src/content/items/jagd_kueste.ts): the jellyfish's stinging threads are
 * an arrow poison like the fly agaric and the wasp stings – one bundle poisons four flint arrows at the workbench (the
 * same yield as `rezept_pfeil_gift` and `rezept_pfeil_gift_wespe`).
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the Salt Coast hunting goods. */
export const JAGD_KUESTE_REZEPTE = defineRecipeGroup('jagd_kueste', [
  recipe({ item: 'pfeil_gift', suffix: 'qualle', anzahl: 4, zutaten: { pfeil_feuerstein: 4, nesselfaden: 1 }, station: 'werkbank', dauer: 'handgriff' }),
]);
