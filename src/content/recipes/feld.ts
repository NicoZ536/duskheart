/**
 * Recipes of the field (docs/SPIEL.md §20, §29 "Feld & Fang"; MASTERPROMPT §17, §14 "Gießkanne"; M7-19 … M7-23; items in
 * src/content/items/feld.ts and src/content/bauteileFeld.ts, the station in src/content/stations.ts):
 * - the watering can at the workbench (wooden staves, rope and resin like the bucket);
 * - compost in the compost box: six pieces of garden waste (group `kompostgut`) rot into two of compost in a day
 *   (§20 "Kompostkiste … Eingang Gruppe kompostgut → kompost");
 * - bone meal: two bones crushed with a stone in the hand;
 * - herb brew: yarrow and plantain steeped at a fire;
 * - flax broken into fibres in the hand (three per stalk bundle – more than a fibre grass gives);
 * - sheaves of wheat, barley or rye dried into a straw bundle on the drying rack (two sheaves, where the fibre grass needs
 *   six fibres: the long stalks are the old thatch and bedding straw; the mill and the kitchen use the grain, M7-25);
 * - chamomile steeped at a fire into the herb brew (the gardener's chamomile tea against mildew, §20 "Mehltau …
 *   `kraeuterbruehe` heilt"; the kitchen's chamomile tea for people follows with M7-27);
 * - the compost box, the garden beds and the scarecrow at the workbench.
 */
import { defineRecipeGroup, recipe } from './define';

/** Recipes of the field. */
export const FELD_REZEPTE = defineRecipeGroup('feld', [
  recipe({ item: 'giesskanne', zutaten: { holz: 3, faserseil: 2, harz: 1 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'kompost', anzahl: 2, gruppen: { kompostgut: 6 }, station: 'kompostkiste', dauer: 'kompostieren' }),
  recipe({ item: 'knochenmehl', zutaten: { knochen: 2 }, station: null, dauer: 'werkzeug' }),
  recipe({ item: 'kraeuterbruehe', zutaten: { schafgarbe: 2, wegerich: 1 }, station: 'lagerfeuer', dauer: 'werkzeug' }, { umgebung: 'wasser' }),
  recipe({ item: 'fasern', suffix: 'flachs', anzahl: 3, zutaten: { flachs: 1 }, station: null, dauer: 'handgriff' }),
  recipe({ item: 'strohbuendel', suffix: 'weizen', zutaten: { weizen: 2 }, station: 'trockengestell', dauer: 'trocknen' }),
  recipe({ item: 'strohbuendel', suffix: 'gerste', zutaten: { gerste: 2 }, station: 'trockengestell', dauer: 'trocknen' }),
  recipe({ item: 'strohbuendel', suffix: 'roggen', zutaten: { roggen: 2 }, station: 'trockengestell', dauer: 'trocknen' }),
  recipe({ item: 'kraeuterbruehe', suffix: 'kamille', zutaten: { kamille: 2 }, station: 'lagerfeuer', dauer: 'werkzeug' }, { umgebung: 'wasser' }),
  recipe({ item: 'kompostkiste', zutaten: { holz: 6, zweig: 4 }, station: 'werkbank', dauer: 'gross' }),
  recipe({ item: 'beet_holz', zutaten: { holz: 3, erde: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'beet_stein', zutaten: { stein: 6, erde: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
  recipe({ item: 'vogelscheuche', zutaten: { zweig: 4, strohbuendel: 2, fasern: 2 }, station: 'werkbank', dauer: 'werkzeug' }),
]);
