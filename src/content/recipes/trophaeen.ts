/**
 * Recipes of the Grünhain hunting trophies (M6-30d; src/content/items/trophaeen.ts): the first jewellery, strung at the
 * workbench – the fangs and tusks are drilled, the sinew twisted into a cord (§15.1: craft time class `werkzeug`, 3 s, like a
 * trap). The parts come from carving (src/content/creatures/gruenhainBeute.ts): a wolf gives a fang half the time (one or
 * two), so a necklace is about two packs; a boar gives a tusk six times in ten (one or two), so an amulet is about two boars.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the hunting trophies. */
export const TROPHAEEN_REZEPTE = defineRecipeGroup('trophaeen', [
  recipe({ item: 'wolfszahnkette', zutaten: { wolfszahn: 3, sehnen: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'haueramulett', zutaten: { keilerhauer: 2, sehnen: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
