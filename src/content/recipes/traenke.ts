/**
 * Recipes of the herb table (MASTERPROMPT §15.2 "Kräutertisch (Alchemie I–II)", §18; docs/SPIEL.md §21 "Tränke & Medizin"; M7-28;
 * items in src/content/items/traenke.ts): the herb table itself is a recipe of the kitchen (src/content/recipes/kueche.ts).
 * Potions and teas are brewed with water at hand (open fresh water or a filled rain collector, like the cauldron); the salve
 * is stirred from plantain and resin. Bandage and splint stay where they are made (the hand, the workbench).
 */
import { defineRecipeGroup, recipe } from './define';

/** Water at hand (open fresh water or a rain collector in reach). */
const WASSER = { umgebung: 'wasser' } as const;

/** Recipes of the potions and medicine. */
export const TRAENKE_REZEPTE = defineRecipeGroup('traenke', [
  recipe({ item: 'heiltrank', zutaten: { leuchtpilz: 1 }, gruppen: { kraeuter: 3 }, station: 'kraeutertisch', dauer: 'werkzeug' }, WASSER),
  recipe({ item: 'gegengift', zutaten: { holzkohle: 1, wegerich: 2 }, station: 'kraeutertisch', dauer: 'werkzeug' }, WASSER),
  recipe({ item: 'fiebertee', zutaten: { schafgarbe: 2, kamille: 1 }, station: 'kraeutertisch', dauer: 'werkzeug' }, WASSER),
  recipe({ item: 'wundsalbe', zutaten: { wegerich: 2, harz: 1 }, station: 'kraeutertisch', dauer: 'werkzeug' }),
  recipe({ item: 'waermetrank', zutaten: { knoblauch: 2, blume_rot: 1 }, station: 'kraeutertisch', dauer: 'werkzeug' }, WASSER),
  recipe({ item: 'kuehltrank', zutaten: { blume_blau: 2, salat: 1 }, station: 'kraeutertisch', dauer: 'werkzeug' }, WASSER),
]);
