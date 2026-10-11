/**
 * Items of the kitchen (MASTERPROMPT §15.2 "Kessel · Backofen · Räucherkammer · Mühle · Gärfass · … · Kräutertisch",
 * §16.7 "Vorratsfass (Nahrung, ×0,75)", §18; docs/SPIEL.md §21, §29 "Küche & Vorrat"; M7-25, M7-28, M7-29; strand E): the six
 * kitchen stations, the pantry barrel and the kitchen's in-between goods.
 *
 * - **Stations** (`platzierbar`, set up with `station.place`; how each works is its record in src/content/stations.ts): the
 *   cauldron (a hand station that cooks only over a burning fire next to it, `feuer`), the oven and the smokehouse (fired
 *   processing stations), the quern and the fermenting barrel (processing without fuel), the herb table (a hand station).
 *   Their recipes are in src/content/recipes/kueche.ts; placed they are drawn with `obj_<id>`.
 * - **Pantry barrel** `vorratsfass` (furniture, `kategorie: 'lager'`): a container of the storage system (§16.7) for food and
 *   drinks only, 20 slots (`BALANCE.storage.containers.vorratsfass`), in which food spoils at three quarters of the pace
 *   (`BALANCE.spoilage.containers.vorratsfass`).
 * - **Flour** `mehl`: ground grain from the quern, the oven's base.
 * - **Spoiled food** `verdorbenes`: what a perishable stack becomes at freshness 0 (src/game/spoilage) – compostable (group
 *   `kompostgut`), nothing else.
 * Trade values [trade points, 1 = one log]: the ingredients plus about a fifth for the work; spoiled food is worth nothing
 * but compost.
 */
import { moebelGruppe, type MoebelSpec } from './moebel';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the kitchen (§13.2 T0: clay, stone and wood – cooking comes before bronze). */
const T0 = 0;

/** The kitchen stations, flour and spoiled food. */
export const KUECHE = defineItemGroup('kueche', [
  baseItem({
    id: 'kessel',
    name: { de: 'Kessel', en: 'Cauldron' },
    beschreibung: {
      de: 'Ein großer gebrannter Tontopf an einem Dreibein aus Ästen. Neben ein brennendes Lagerfeuer, einen Kamin oder ein Herdfeuer gestellt, kocht man darin Suppen, Eintöpfe und Tees.',
      en: 'A large fired clay pot on a tripod of branches. Set beside a burning camp fire, fireplace or hearth, it cooks soups, stews and teas.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 24,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'backofen',
    name: { de: 'Backofen', en: 'Bread Oven' },
    beschreibung: {
      de: 'Eine Kuppel aus Ziegeln und Lehm mit einer Ofenklappe aus Stein. Mit Brennholz geheizt, backt sie Brot und Kuchen und brät Kartoffeln.',
      en: 'A dome of bricks and clay with a stone oven door. Heated with firewood, it bakes bread and cakes and roasts potatoes.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 48,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'raeucherkammer',
    name: { de: 'Räucherkammer', en: 'Smokehouse' },
    beschreibung: {
      de: 'Eine schmale Bretterkammer über einer gemauerten Glutgrube. Der kalte Rauch macht gesalzenen Fisch wochenlang haltbar.',
      en: 'A narrow plank chamber over a bricked ember pit. The cold smoke keeps salted fish for weeks.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 40,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'muehle',
    name: { de: 'Handmühle', en: 'Quern' },
    beschreibung: {
      de: 'Zwei behauene Mühlsteine mit einer Kurbel aus Holz. Mahlt Weizen, Gerste und Roggen zu Mehl, ganz ohne Brennstoff.',
      en: 'Two dressed millstones with a wooden crank. Grinds wheat, barley and rye into flour, no fuel needed.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 22,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'gaerfass',
    name: { de: 'Gärfass', en: 'Fermenting Barrel' },
    beschreibung: {
      de: 'Ein dichtes Fass aus Dauben mit Gärspund. Aus Gerste wird darin Bier, aus Beeren Wein – das dauert zwei Tage, braucht aber kein Feuer.',
      en: 'A tight barrel of staves with an airlock. Barley turns into beer in it, berries into wine – it takes two days but no fire.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 20,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'kraeutertisch',
    name: { de: 'Kräutertisch', en: 'Herb Table' },
    beschreibung: {
      de: 'Ein Brettertisch mit Mörser, Tontopf und Bündeln trocknender Kräuter. Hier mischt man Heiltränke, Salben und Tees gegen Gift und Fieber.',
      en: 'A plank table with mortar, clay pot and bundles of drying herbs. Here healing potions, salves and teas against poison and fever are mixed.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 22,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'mehl',
    name: { de: 'Mehl', en: 'Flour' },
    beschreibung: {
      de: 'Fein gemahlenes Getreide aus der Handmühle. Im Backofen wird daraus Brot und Kuchen.',
      en: 'Finely ground grain from the quern. The oven turns it into bread and cakes.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'verdorbenes',
    name: { de: 'Verdorbenes', en: 'Spoiled Food' },
    beschreibung: {
      de: 'Was von Essen bleibt, das zu lange lag: schimmlig, stinkend, ungenießbar. In der Kompostkiste wird es wieder zu guter Erde.',
      en: 'What is left of food that lay too long: mouldy, stinking, inedible. In the compost box it turns back into good soil.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 0,
    // Any perishable stack at freshness 0 turns into it where it lies (src/game/spoilage/system.ts).
    quellen: ['verderb'],
    sounds: { aufheben: ITEM_SFX.erde },
  }),
]);

/** The pantry barrel (furniture with a build part; a container of the storage system). */
const VORRAT_SPECS: readonly MoebelSpec[] = [
  {
    id: 'vorratsfass',
    stufe: T0,
    name: { de: 'Vorratsfass', en: 'Pantry Barrel' },
    beschreibung: {
      de: 'Ein dicht schließendes Fass für Vorräte – nur Nahrung, Gerichte und Getränke, zwanzig Plätze. Darin verdirbt Essen ein Viertel langsamer.',
      en: 'A tightly closing barrel for supplies – food, dishes and drinks only, twenty slots. Food inside spoils a quarter slower.',
    },
    tauschwert: 19,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'lager' },
  },
];

const VORRAT = moebelGruppe('kueche_vorrat', VORRAT_SPECS);

/** The pantry barrel item. */
export const KUECHE_VORRAT_ITEMS = VORRAT.items;
/** The pantry barrel's build part. */
export const KUECHE_BAUTEILE = VORRAT.teile;
