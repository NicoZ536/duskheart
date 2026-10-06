/**
 * Recipes of the instruments, the net and the firefly jar (M7-31; docs/SPIEL.md §24, §29 – strand A). All T0, at the
 * workbench, from what the first days give:
 *
 * - **Holzflöte**: a branch of wood hollowed and bored, resin smooths the mouthpiece.
 * - **Laute**: a body of wood, four strings of sinew (a first hunt), resin to glue the neck.
 * - **Kescher**: a ring of twigs, a net knotted from fibres and rope, on a twig handle.
 * - **Glühwürmchenglas**: a glass under a lid of twigs tied with rope, three fireflies inside (its first glow).
 */
import { defineRecipeGroup, recipe } from './define';

export const INSTRUMENTE_REZEPTE = defineRecipeGroup('instrumente', [
  recipe({ item: 'floete', zutaten: { holz: 1, harz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'laute', zutaten: { holz: 3, sehnen: 4, harz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'netz', zutaten: { zweig: 3, fasern: 4, faserseil: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'gluehwuermchenglas', zutaten: { glas: 1, zweig: 1, faserseil: 1, gluehwuermchen: 3 }, station: 'werkbank', dauer: 'handgriff' }),
]);
