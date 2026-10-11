/**
 * Dishes and drinks 1–22 (MASTERPROMPT §18 "Zubereitung … Spieß am Feuer, Kessel, Backen, Räuchern, Trocknen, Gären/Brauen",
 * "Mahlzeit-Effekte … Eintopf +20 max. Leben (10 min) · Fischsuppe +15 max. Ausdauer · Beerenkuchen −20 Furcht · Pilzragout
 * Nachtsicht (6 min)"; docs/SPIEL.md §21, §29 "Gerichte & Getränke (22)"; M7-27; strand E). Category `gericht` (§C "Gerichte
 * & Getränke"); their recipes are in src/content/recipes/gerichte.ts.
 *
 * - **Nutrition** (`essbar`): satiety and thirst [points of 100] per piece – several times the raw food they are made of
 *   (§18 "roh (geringer Wert)"); soups and teas quench thirst, salty food takes some (`mahlzeit.salz`, the boredom, the
 *   kitchen's +10 % and comfort act on it: src/game/meals).
 * - **Meal effects** (`mahlzeit`): conditions of group `mahlzeit` with their seconds (at most two at once), comfort food
 *   (`wohlfuehl`, fear −10 … −25; every dish comforts by at least 10), salt [thirst points taken].
 * - **Shelf life** (`frische`, `BALANCE.meals.shelfLifeDays`): roast food 3 days, soups and salad 2, bread 5, cakes 4, teas 3,
 *   jerky 30, smoked fish 25; wine and beer keep.
 * Trade values [trade points, 1 = one log]: the ingredients plus about a fifth for the work.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from './define';

const SHELF = BALANCE.meals.shelfLifeDays;
/** A meal condition with its duration [s] (src/content/conditions_m7.ts). */
const zustand = (id: string, sekunden: number): { id: string; sekunden: number } => ({ id, sekunden });
/** A dish: category `gericht`, tier T0, the bowl's handling sound. */
const gericht = (spec: Omit<ItemSpec, 'kategorie' | 'sounds'> & { readonly sounds?: ItemSpec['sounds'] }): ReturnType<typeof baseItem> =>
  baseItem({ kategorie: 'gericht', sounds: { aufheben: ITEM_SFX.gericht }, ...spec });

/** The 22 dishes and drinks of M7. */
export const GERICHTE = defineItemGroup('gerichte', [
  // ---- The spit at the camp fire ----
  gericht({
    id: 'gebratenes_fleisch',
    name: { de: 'Gebratenes Fleisch', en: 'Roast Meat' },
    beschreibung: {
      de: 'Wildfleisch oder Geflügel, am Spieß über dem Lagerfeuer gebraten. Macht richtig satt und schmeckt nach Rauch.',
      en: 'Venison or fowl, roasted on a spit over the camp fire. Truly filling, with a taste of smoke.',
    },
    essbar: { saettigung: 30, durst: -2 },
    frische: SHELF.gebraten,
    tauschwert: 6,
  }),
  gericht({
    id: 'gebratener_fisch',
    name: { de: 'Gebratener Fisch', en: 'Grilled Fish' },
    beschreibung: {
      de: 'Ein ganzer Fisch, auf einem Zweig über der Glut gegart. Zart, sättigend und ganz ohne Gefahr.',
      en: 'A whole fish cooked on a twig over the embers. Tender, filling and perfectly safe.',
    },
    essbar: { saettigung: 24, durst: 0 },
    frische: SHELF.gebraten,
    tauschwert: 6,
  }),
  gericht({
    id: 'pilzspiess',
    name: { de: 'Pilzspieß', en: 'Mushroom Skewer' },
    beschreibung: {
      de: 'Steinpilze und Pfifferlinge auf einem Zweig, über dem Feuer geröstet. Ein schnelles Mahl aus dem Wald.',
      en: 'Porcini and chanterelles on a twig, roasted over the fire. A quick meal from the woods.',
    },
    essbar: { saettigung: 18, durst: 0 },
    frische: SHELF.gebraten,
    tauschwert: 11,
  }),
  gericht({
    id: 'geroesteter_mais',
    name: { de: 'Gerösteter Mais', en: 'Roasted Corn' },
    beschreibung: {
      de: 'Ein Maiskolben, in der Glut geröstet, bis die Körner aufplatzen. Süß und warm.',
      en: 'A corn cob roasted in the embers until the kernels burst. Sweet and warm.',
    },
    essbar: { saettigung: 16, durst: 0 },
    frische: SHELF.gebraten,
    tauschwert: 4,
  }),
  // ---- The oven ----
  gericht({
    id: 'bratkartoffeln',
    name: { de: 'Bratkartoffeln', en: 'Fried Potatoes' },
    beschreibung: {
      de: 'Kartoffelscheiben mit Zwiebeln, im Backofen knusprig gebraten. Deftig und salzig – danach hat man Durst.',
      en: 'Potato slices with onions, roasted crisp in the oven. Hearty and salty – thirsty work afterwards.',
    },
    essbar: { saettigung: 28, durst: -2 },
    mahlzeit: { zustaende: [], salz: 4 },
    frische: SHELF.gebraten,
    tauschwert: 10,
  }),
  gericht({
    id: 'brot',
    name: { de: 'Brot', en: 'Bread' },
    beschreibung: {
      de: 'Ein Laib aus gemahlenem Getreide, im Backofen gebacken. Hält fünf Tage und macht lange satt.',
      en: 'A loaf of ground grain baked in the oven. Keeps five days and fills you for long.',
    },
    essbar: { saettigung: 22, durst: -2 },
    mahlzeit: { zustaende: [], salz: 2 },
    frische: SHELF.brot,
    tauschwert: 4,
  }),
  gericht({
    id: 'beerenkuchen',
    name: { de: 'Beerenkuchen', en: 'Berry Pie' },
    beschreibung: {
      de: 'Ein süßer Kuchen voller Beeren. Wer ihn isst, vergisst für einen Moment die Dunkelheit: senkt die Furcht um 20.',
      en: 'A sweet pie full of berries. Eating it, you forget the dark for a moment: lowers fear by 20.',
    },
    essbar: { saettigung: 26, durst: 2 },
    mahlzeit: { zustaende: [], wohlfuehl: 20 },
    frische: SHELF.kuchen,
    tauschwert: 19,
  }),
  gericht({
    id: 'apfelkuchen',
    name: { de: 'Apfelkuchen', en: 'Apple Pie' },
    beschreibung: {
      de: 'Ein Kuchen aus Mehl und Äpfeln, der nach einem Herbstabend am Feuer duftet. Senkt die Furcht um 15.',
      en: 'A pie of flour and apples that smells of an autumn evening by the fire. Lowers fear by 15.',
    },
    essbar: { saettigung: 28, durst: 2 },
    mahlzeit: { zustaende: [], wohlfuehl: 15 },
    frische: SHELF.kuchen,
    tauschwert: 17,
  }),
  // ---- The cauldron ----
  gericht({
    id: 'eintopf',
    name: { de: 'Eintopf', en: 'Stew' },
    beschreibung: {
      de: 'Fleisch oder Fisch mit Gemüse, lange im Kessel geschmort. Stärkt: 20 Leben mehr für zehn Minuten.',
      en: 'Meat or fish with vegetables, slowly stewed in the cauldron. Fortifies: 20 more maximum health for ten minutes.',
    },
    essbar: { saettigung: 38, durst: 12 },
    mahlzeit: { zustaende: [zustand('gestaerkt', 600)] },
    frische: SHELF.suppe,
    tauschwert: 14,
  }),
  gericht({
    id: 'fischsuppe',
    name: { de: 'Fischsuppe', en: 'Fish Soup' },
    beschreibung: {
      de: 'Eine klare Suppe aus Fisch und Gemüse. Gibt Ausdauer für lange Wege: 15 mehr für zehn Minuten.',
      en: 'A clear soup of fish and vegetables. Gives stamina for long roads: 15 more for ten minutes.',
    },
    essbar: { saettigung: 30, durst: 16 },
    mahlzeit: { zustaende: [zustand('ausdauernd', 600)], salz: 2 },
    frische: SHELF.suppe,
    tauschwert: 11,
  }),
  gericht({
    id: 'gemuesesuppe',
    name: { de: 'Gemüsesuppe', en: 'Vegetable Soup' },
    beschreibung: {
      de: 'Drei Handvoll Gemüse aus dem Garten, weich gekocht. Erquickt: Ausdauer kehrt fünf Minuten lang schneller zurück.',
      en: 'Three handfuls of garden vegetables, boiled soft. Refreshes: stamina returns faster for five minutes.',
    },
    essbar: { saettigung: 26, durst: 18 },
    mahlzeit: { zustaende: [zustand('erquickt', 300)] },
    frische: SHELF.suppe,
    tauschwert: 11,
  }),
  gericht({
    id: 'erbsensuppe',
    name: { de: 'Erbsensuppe', en: 'Pea Soup' },
    beschreibung: {
      de: 'Ein dicker, salziger Brei aus Erbsen und Zwiebeln. Füllt den Magen und wärmt die Seele.',
      en: 'A thick, salty porridge of peas and onions. Fills the belly and warms the soul.',
    },
    essbar: { saettigung: 32, durst: 10 },
    mahlzeit: { zustaende: [], wohlfuehl: 12, salz: 3 },
    frische: SHELF.suppe,
    tauschwert: 11,
  }),
  gericht({
    id: 'kuerbissuppe',
    name: { de: 'Kürbissuppe', en: 'Pumpkin Soup' },
    beschreibung: {
      de: 'Eine sämige orange Suppe aus Kürbis und Zwiebeln. Ein Trost in dunklen Herbstnächten: senkt die Furcht um 15.',
      en: 'A creamy orange soup of pumpkin and onions. A comfort on dark autumn nights: lowers fear by 15.',
    },
    essbar: { saettigung: 28, durst: 14 },
    mahlzeit: { zustaende: [], wohlfuehl: 15 },
    frische: SHELF.suppe,
    tauschwert: 14,
  }),
  gericht({
    id: 'tomatensuppe',
    name: { de: 'Tomatensuppe', en: 'Tomato Soup' },
    beschreibung: {
      de: 'Reife Tomaten mit Knoblauch, im Kessel eingekocht. Frisch und sauer – erquickt fünf Minuten lang.',
      en: 'Ripe tomatoes with garlic, simmered in the cauldron. Fresh and tangy – refreshes for five minutes.',
    },
    essbar: { saettigung: 24, durst: 18 },
    mahlzeit: { zustaende: [zustand('erquickt', 300)] },
    frische: SHELF.suppe,
    tauschwert: 14,
  }),
  gericht({
    id: 'pilzragout',
    name: { de: 'Pilzragout', en: 'Mushroom Ragout' },
    beschreibung: {
      de: 'Ein dunkles Ragout aus Waldpilzen und Zwiebeln. Schärft die Augen für die Nacht: sechs Minuten Nachtsicht.',
      en: 'A dark ragout of forest mushrooms and onions. Sharpens your eyes for the night: six minutes of night vision.',
    },
    essbar: { saettigung: 30, durst: 6 },
    mahlzeit: { zustaende: [zustand('nachtsicht', 360)] },
    frische: SHELF.suppe,
    tauschwert: 13,
  }),
  // ---- Made in the hand ----
  gericht({
    id: 'gemischter_salat',
    name: { de: 'Gemischter Salat', en: 'Mixed Salad' },
    beschreibung: {
      de: 'Salatblätter mit Gemüse und einem Stück Obst – roh, aber angerichtet. Erquickt vier Minuten lang.',
      en: 'Lettuce leaves with vegetables and a piece of fruit – raw, but prepared. Refreshes for four minutes.',
    },
    essbar: { saettigung: 16, durst: 12 },
    mahlzeit: { zustaende: [zustand('erquickt', 240)] },
    frische: SHELF.salat,
    tauschwert: 9,
  }),
  // ---- Drying rack and smokehouse ----
  gericht({
    id: 'trockenfleisch',
    name: { de: 'Trockenfleisch', en: 'Jerky' },
    beschreibung: {
      de: 'Gesalzene Fleischstreifen, im Wind getrocknet. Hält einen Monat und passt in jede Tasche – aber das Salz macht Durst.',
      en: 'Salted strips of meat, dried in the wind. Keeps a month and fits any pocket – but the salt makes you thirsty.',
    },
    essbar: { saettigung: 18, durst: -2 },
    mahlzeit: { zustaende: [], salz: 6 },
    frische: SHELF.trockenfleisch,
    tauschwert: 7,
  }),
  gericht({
    id: 'raeucherfisch',
    name: { de: 'Räucherfisch', en: 'Smoked Fish' },
    beschreibung: {
      de: 'Gesalzener Fisch, im kalten Rauch der Räucherkammer haltbar gemacht. Hält fast einen Monat – salzig und würzig.',
      en: 'Salted fish, preserved in the cold smoke of the smokehouse. Keeps almost a month – salty and savoury.',
    },
    essbar: { saettigung: 20, durst: -2 },
    mahlzeit: { zustaende: [], salz: 6 },
    frische: SHELF.raeucherfisch,
    tauschwert: 7,
  }),
  // ---- Teas from the cauldron ----
  gericht({
    id: 'kamillentee',
    name: { de: 'Kamillentee', en: 'Chamomile Tea' },
    beschreibung: {
      de: 'Ein heißer Becher aus Kamillenblüten. Löscht den Durst und beruhigt: senkt die Furcht um 12.',
      en: 'A hot cup of chamomile flowers. Quenches thirst and calms you: lowers fear by 12.',
    },
    essbar: { saettigung: 0, durst: 28 },
    mahlzeit: { zustaende: [], wohlfuehl: 12 },
    frische: SHELF.tee,
    tauschwert: 2,
  }),
  gericht({
    id: 'schafgarbentee',
    name: { de: 'Schafgarbentee', en: 'Yarrow Tea' },
    beschreibung: {
      de: 'Ein bitterer Tee aus Schafgarbe. Löscht den Durst und erquickt fünf Minuten lang.',
      en: 'A bitter tea of yarrow. Quenches thirst and refreshes for five minutes.',
    },
    essbar: { saettigung: 0, durst: 28 },
    mahlzeit: { zustaende: [zustand('erquickt', 300)] },
    frische: SHELF.tee,
    tauschwert: 2,
  }),
  // ---- The fermenting barrel ----
  gericht({
    id: 'beerenwein',
    name: { de: 'Beerenwein', en: 'Berry Wine' },
    beschreibung: {
      de: 'Ein dunkler, süßer Wein aus vergorenen Beeren. Ein Becher macht beschwipst: weniger Schaden, aber unsichere Hände.',
      en: 'A dark, sweet wine of fermented berries. A cup makes you tipsy: less damage taken, but unsteady hands.',
    },
    essbar: { saettigung: 4, durst: 16 },
    mahlzeit: { zustaende: [zustand('beschwipst', 180)] },
    tauschwert: 7,
  }),
  gericht({
    id: 'bier',
    name: { de: 'Bier', en: 'Beer' },
    beschreibung: {
      de: 'Ein trübes Bier aus Gerste, zwei Tage im Gärfass gereift. Löscht den Durst und macht beschwipst.',
      en: 'A cloudy barley beer, ripened two days in the fermenting barrel. Quenches thirst and makes you tipsy.',
    },
    essbar: { saettigung: 6, durst: 20 },
    mahlzeit: { zustaende: [zustand('beschwipst', 180)] },
    tauschwert: 6,
  }),
]);
