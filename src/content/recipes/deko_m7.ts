/**
 * Rezepte der M7-Deko (src/content/bauteileDeko.ts; M7-62): an der Werkbank aus dem, was Wald, Jagd und Strand geben – die
 * schlichten Stücke in einem Handgriff (§15.1 `handgriff`), was geschnitzt, geknüpft oder geklebt wird, mit `werkzeug`; das
 * Buddelschiff an der Werkbank II (Glas, Garn: T1). Holz kommt über die Gruppe `bauholz` (Stamm oder Treibholz – die
 * Treibholzskulptur, das Netz und das Strandgutregal nehmen am Strand, was angeschwemmt ist).
 */
import { defineRecipeGroup, recipe } from './define';

/** Rezepte der M7-Deko. */
export const DEKO_M7_REZEPTE = defineRecipeGroup('deko_m7', [
  recipe({ item: 'hirschgeweih_wand', zutaten: { hirschgeweih: 1, brett: 1, faserseil: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'moosstein', zutaten: { stein: 3, laub: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'farnkuebel', zutaten: { brett: 2, erde: 2, laub: 3 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'pilzstumpf', zutaten: { fliegenpilz: 2 }, gruppen: { bauholz: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'kraeuterbund', zutaten: { schafgarbe: 2, wegerich: 2, faserseil: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'blumenkranz', zutaten: { zweig: 3, blume_rot: 1, blume_gelb: 1, blume_blau: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'federgesteck', zutaten: { keramik_topf: 1, federn: 4 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'wurzelskulptur', zutaten: { harz: 1 }, gruppen: { bauholz: 3 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'rindenschale', zutaten: { rinde: 2, laub: 2, zweig: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'muschelschale', zutaten: { keramik_topf: 1, muschel: 4 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'treibholzskulptur', zutaten: { stein: 1, faserseil: 1 }, gruppen: { bauholz: 3 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'fischernetz_wand', zutaten: { faserseil: 3 }, gruppen: { bauholz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'steinanker', zutaten: { steinblock: 1, faserseil: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'buddelschiff', zutaten: { glas: 1, brett: 1, garn: 1 }, station: 'werkbank_2', dauer: 'werkzeug' }),
  recipe({ item: 'muschelbild', zutaten: { brett: 2, muschel: 3, harz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'kieselmosaik', zutaten: { kies: 4, sand: 2 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'muschelwindspiel', zutaten: { muschel: 4, faserseil: 1, zweig: 1 }, station: 'werkbank', dauer: 'handgriff' }),
  recipe({ item: 'strandgutregal', zutaten: { muschel: 2, faserseil: 1 }, gruppen: { bauholz: 2 }, station: 'werkbank', dauer: 'handgriff' }),
]);
