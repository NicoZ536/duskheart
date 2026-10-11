/**
 * Recipes of the 22 dishes and drinks (MASTERPROMPT §18 "Zubereitung: … Spieß am Feuer, Kessel (Rezepte aus konkreten Zutaten
 * oder Kategorien wie Gemüse/Fleisch/Fisch), Backen, Räuchern, Trocknen, … Gären/Brauen"; docs/SPIEL.md §21; M7-25, M7-27;
 * items in src/content/items/gerichte.ts, the categories in src/content/recipes/gruppen.ts):
 * - **Spit at the camp fire** (`lagerfeuer`): roast meat (any meat), grilled fish (any fish), mushroom skewer, roasted corn.
 * - **Cauldron** (`kessel`, over a fire beside it, with water at hand – open fresh water or a filled rain collector): stew from
 *   any raw meat or fish and two vegetables, fish soup, vegetable soup, pea, pumpkin and tomato soup, mushroom ragout, the two
 *   teas. The cook picks the members of a category in the queue: the bags give them in the category's order.
 * - **Bread oven** (`backofen`, fired): fried potatoes, bread (two loaves from two flour), berry and apple pie.
 * - **Drying rack** and **smokehouse**: salted strips of meat dry into jerky, salted fish smokes for weeks.
 * - **Fermenting barrel** (`gaerfass`, two days): berry wine, beer.
 * - **In the hand**: the mixed salad.
 */
import { defineRecipeGroup, recipe } from './define';

/** Water at hand for the cauldron's soups and teas (open fresh water or a rain collector in reach). */
const WASSER = { umgebung: 'wasser' } as const;

/** Recipes of the dishes and drinks. */
export const GERICHTE_REZEPTE = defineRecipeGroup('gerichte', [
  // The spit at the camp fire.
  recipe({ item: 'gebratenes_fleisch', gruppen: { fleisch: 1 }, station: 'lagerfeuer', dauer: 'werkzeug' }),
  recipe({ item: 'gebratener_fisch', gruppen: { fisch: 1 }, station: 'lagerfeuer', dauer: 'werkzeug' }),
  recipe({ item: 'pilzspiess', zutaten: { zweig: 1 }, gruppen: { pilze: 3 }, station: 'lagerfeuer', dauer: 'werkzeug' }),
  recipe({ item: 'geroesteter_mais', zutaten: { mais: 1 }, station: 'lagerfeuer', dauer: 'werkzeug' }),
  // The cauldron.
  recipe({ item: 'eintopf', gruppen: { fleisch_roh: 1, gemuese: 2 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'fischsuppe', gruppen: { fisch: 1, gemuese: 1 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'gemuesesuppe', gruppen: { gemuese: 3 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'erbsensuppe', zutaten: { erbse: 3, zwiebel: 1 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'kuerbissuppe', zutaten: { kuerbis: 1, zwiebel: 1 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'tomatensuppe', zutaten: { tomate: 3, knoblauch: 1 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'pilzragout', zutaten: { zwiebel: 1 }, gruppen: { pilze: 3 }, station: 'kessel', dauer: 'gross' }, WASSER),
  recipe({ item: 'kamillentee', zutaten: { kamille: 2 }, station: 'kessel', dauer: 'werkzeug' }, WASSER),
  recipe({ item: 'schafgarbentee', zutaten: { schafgarbe: 2 }, station: 'kessel', dauer: 'werkzeug' }, WASSER),
  // The bread oven.
  recipe({ item: 'bratkartoffeln', zutaten: { kartoffel: 2, zwiebel: 1 }, station: 'backofen', dauer: 'backen' }),
  recipe({ item: 'brot', anzahl: 2, zutaten: { mehl: 2 }, station: 'backofen', dauer: 'backen' }),
  recipe({ item: 'beerenkuchen', zutaten: { mehl: 2 }, gruppen: { beeren: 4 }, station: 'backofen', dauer: 'backen' }),
  recipe({ item: 'apfelkuchen', zutaten: { mehl: 2, apfel: 2 }, station: 'backofen', dauer: 'backen' }),
  // Drying rack and smokehouse: salt preserves (§18 "Einlegen (Salz/Essig)" follows in M8-48).
  recipe({ item: 'trockenfleisch', anzahl: 2, zutaten: { salz: 1 }, gruppen: { fleisch: 2 }, station: 'trockengestell', dauer: 'trocknen' }),
  recipe({ item: 'raeucherfisch', anzahl: 2, zutaten: { salz: 1 }, gruppen: { fisch: 2 }, station: 'raeucherkammer', dauer: 'raeuchern' }),
  // The fermenting barrel.
  recipe({ item: 'beerenwein', anzahl: 2, gruppen: { beeren: 6 }, station: 'gaerfass', dauer: 'gaeren' }),
  recipe({ item: 'bier', anzahl: 2, zutaten: { gerste: 4 }, station: 'gaerfass', dauer: 'gaeren' }),
  // In the hand: lettuce, any vegetable and any fruit.
  recipe({ item: 'gemischter_salat', zutaten: { salat: 1 }, gruppen: { gemuese: 1, obst: 1 }, station: null, dauer: 'handgriff' }),
]);
