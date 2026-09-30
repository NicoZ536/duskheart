/**
 * Armour T0–T1, its materials and the stations of the armoury (MASTERPROMPT §13.1 "Rüstungssets mit Set-Boni", §11.2
 * Isolation, §11.4 "Rüstungsgewicht: leicht 0 %, mittel −5 %, schwer −10 % Tempo", §15.1 "Gerbrahmen", §15.2 "Webstuhl ·
 * Schneidertisch", §D "Rüstungswert je Set: T0 6 · T1 12"; docs/SPIEL.md §14; M6-12, M6-31).
 *
 * - **Sets** (four pieces each: head, chest, legs, feet; bonuses in src/content/ruestungssets.ts):
 *   - `faser` (T0, light): woven fibre from the loom, cut and bound at the tailor's table – armour 6 as §D asks of T0,
 *     warm like clothes (isolation 1–2 per piece, §11.2).
 *   - `leder` (T1, medium): leather from the tanning frame, sewn with yarn – armour 10 and the warmest pieces; with its
 *     full set bonus (+2) it reaches the 12 of T1 and stays lighter than bronze.
 *   - `bronze` (T1, heavy): hammered at the bronze anvil over a lining of woven fibre – armour 12 (§D T1), no warmth,
 *     −10 % walking tempo (§11.4).
 * - **Leather** (`leder`) is the product of the tanning frame (`gerbrahmen`, a processing station: a hide from hunting and
 *   carving plus bark tannin, left to cure; src/content/recipes/ruestung.ts). **Woven fibre** (`fasergewebe`) is woven at
 *   the loom from fibres.
 * - **Leather backpack** (`lederrucksack`, §13.1 "Rucksack-Slot +8"): the first backpack.
 * - **Stations** `webstuhl`, `schneidertisch` (hand stations) and `gerbrahmen` (processing, no fuel) – their records in
 *   src/content/stations.ts.
 * - Durability [uses] per tier (§D); every hit taken wears each worn piece by one use.
 * - Trade values [trade points, 1 = one log]: the recipe's ingredients plus about a fifth for the work.
 */
import { BALANCE } from '../balance';
import type { ArmorWeightClass, ItemInput } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from './define';

/** Tiers (§13.2). */
const T0 = 0;
const T1 = 1;

/** Handling sounds of armour by material (presets in src/content/sfx/ruestkammer.ts). */
export const RUESTUNG_SFX = {
  faser: ITEM_SFX.pflanze,
  leder: ITEM_SFX.leder,
  bronze: ITEM_SFX.metall,
} as const;

/** One armour piece of tier `stufe` in slot `ausruestung` with weight `gewicht` and stats `werte`. */
function teil(
  spec: Omit<ItemSpec, 'kategorie' | 'haltbarkeit' | 'ruestungsgewicht' | 'ausruestung' | 'stufe'> & {
    readonly stufe: number;
    readonly ausruestung: 'kopf' | 'brust' | 'beine' | 'fuesse';
    readonly gewicht: ArmorWeightClass;
  },
): ItemInput {
  const { gewicht, ...rest } = spec;
  return baseItem({ ...rest, kategorie: 'ruestung', ruestungsgewicht: gewicht, haltbarkeit: BALANCE.items.durabilityByTier[spec.stufe] as number });
}

/** Armour T0–T1, leather, woven fibre and the leather backpack. */
export const RUESTUNG = defineItemGroup('ruestung', [
  // ---- Materials ----
  baseItem({
    id: 'fasergewebe',
    name: { de: 'Fasergewebe', en: 'Woven Fibre' },
    beschreibung: {
      de: 'Ein dichtes Tuch aus gewebten Pflanzenfasern, am Webstuhl gewoben. Stoff für Fasergewand und das Futter unter Bronze.',
      en: 'A dense cloth of woven plant fibres, made at the loom. Cloth for fibre garb and the lining under bronze.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 7,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'leder',
    name: { de: 'Leder', en: 'Leather' },
    beschreibung: {
      de: 'Eine gegerbte Tierhaut: ein Fell, mit Rindengerbe am Gerbrahmen haltbar gemacht. Stoff für Lederrüstung und Rucksack.',
      en: 'A tanned hide: a pelt cured with bark tannin on the tanning frame. Material for leather armour and the backpack.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 7,
    sounds: { aufheben: RUESTUNG_SFX.leder },
  }),
  baseItem({
    id: 'lederrucksack',
    name: { de: 'Lederrucksack', en: 'Leather Backpack' },
    beschreibung: {
      de: 'Ein genähter Lederbeutel mit zwei Seilriemen. Im Rucksack-Platz getragen gibt er acht weitere Plätze.',
      en: 'A sewn leather bag with two rope straps. Worn in the backpack slot it gives eight more slots.',
    },
    kategorie: 'rucksack',
    stufe: T0,
    rucksack: { plaetze: BALANCE.items.bags.backpackSlots[0] as number },
    tauschwert: 43,
    sounds: { aufheben: RUESTUNG_SFX.leder },
  }),
  // ---- Set `faser` (T0, light) ----
  teil({
    id: 'faserkappe',
    name: { de: 'Faserkappe', en: 'Fibre Cap' },
    beschreibung: {
      de: 'Eine eng geflochtene Kappe aus Fasergewebe. Leicht und ein wenig warm. Teil des Fasergewands.',
      en: 'A tightly plaited cap of woven fibre. Light and a little warm. Part of the fibre garb.',
    },
    stufe: T0,
    ausruestung: 'kopf',
    gewicht: 'leicht',
    werte: { ruestung: 1, isolation: 1 },
    tauschwert: 22,
    sounds: { aufheben: RUESTUNG_SFX.faser },
  }),
  teil({
    id: 'faserhemd',
    name: { de: 'Faserhemd', en: 'Fibre Shirt' },
    beschreibung: {
      de: 'Ein doppelt gewebtes Hemd mit Faserseil-Gürtel. Fängt Kratzer und Bisse ab, ohne zu behindern. Teil des Fasergewands.',
      en: 'A double-woven shirt with a fibre-rope belt. Catches scratches and bites without hindering. Part of the fibre garb.',
    },
    stufe: T0,
    ausruestung: 'brust',
    gewicht: 'leicht',
    werte: { ruestung: 2, isolation: 2 },
    tauschwert: 38,
    sounds: { aufheben: RUESTUNG_SFX.faser },
  }),
  teil({
    id: 'faserhose',
    name: { de: 'Faserhose', en: 'Fibre Trousers' },
    beschreibung: {
      de: 'Eine Hose aus Fasergewebe, an den Knien gedoppelt. Teil des Fasergewands.',
      en: 'Trousers of woven fibre, doubled at the knees. Part of the fibre garb.',
    },
    stufe: T0,
    ausruestung: 'beine',
    gewicht: 'leicht',
    werte: { ruestung: 2, isolation: 2 },
    tauschwert: 30,
    sounds: { aufheben: RUESTUNG_SFX.faser },
  }),
  teil({
    id: 'faserschuhe',
    name: { de: 'Faserschuhe', en: 'Fibre Shoes' },
    beschreibung: {
      de: 'Gewickelte Schuhe aus Fasergewebe mit Rindensohle. Teil des Fasergewands.',
      en: 'Wrapped shoes of woven fibre with bark soles. Part of the fibre garb.',
    },
    stufe: T0,
    ausruestung: 'fuesse',
    gewicht: 'leicht',
    werte: { ruestung: 1, isolation: 1 },
    tauschwert: 24,
    sounds: { aufheben: RUESTUNG_SFX.faser },
  }),
  // ---- Set `leder` (T1, medium) ----
  teil({
    id: 'lederkappe',
    name: { de: 'Lederkappe', en: 'Leather Cap' },
    beschreibung: {
      de: 'Eine genähte Lederkappe mit Nackenschutz. Hält warm und dämpft Schläge. Teil der Lederrüstung.',
      en: 'A sewn leather cap with a neck guard. Keeps warm and softens blows. Part of the leather armour.',
    },
    stufe: T1,
    ausruestung: 'kopf',
    gewicht: 'mittel',
    werte: { ruestung: 2, isolation: 2 },
    tauschwert: 20,
    sounds: { aufheben: RUESTUNG_SFX.leder },
  }),
  teil({
    id: 'lederwams',
    name: { de: 'Lederwams', en: 'Leather Jerkin' },
    beschreibung: {
      de: 'Ein festes, mit Garn abgestepptes Lederwams mit Schulterstücken. Warm und zäh. Teil der Lederrüstung.',
      en: 'A sturdy leather jerkin quilted with yarn, with shoulder pieces. Warm and tough. Part of the leather armour.',
    },
    stufe: T1,
    ausruestung: 'brust',
    gewicht: 'mittel',
    werte: { ruestung: 4, isolation: 3 },
    tauschwert: 49,
    sounds: { aufheben: RUESTUNG_SFX.leder },
  }),
  teil({
    id: 'lederhose',
    name: { de: 'Lederhose', en: 'Leather Trousers' },
    beschreibung: {
      de: 'Eine Lederhose mit Kniebesatz. Teil der Lederrüstung.',
      en: 'Leather trousers with knee patches. Part of the leather armour.',
    },
    stufe: T1,
    ausruestung: 'beine',
    gewicht: 'mittel',
    werte: { ruestung: 3, isolation: 2 },
    tauschwert: 41,
    sounds: { aufheben: RUESTUNG_SFX.leder },
  }),
  teil({
    id: 'lederstiefel',
    name: { de: 'Lederstiefel', en: 'Leather Boots' },
    beschreibung: {
      de: 'Hohe, weiche Lederstiefel mit Umschlag. Teil der Lederrüstung.',
      en: 'Tall, soft leather boots with a turned-down cuff. Part of the leather armour.',
    },
    stufe: T1,
    ausruestung: 'fuesse',
    gewicht: 'mittel',
    werte: { ruestung: 1, isolation: 1 },
    tauschwert: 29,
    sounds: { aufheben: RUESTUNG_SFX.leder },
  }),
  // ---- Set `bronze` (T1, heavy) ----
  teil({
    id: 'bronzehelm',
    name: { de: 'Bronzehelm', en: 'Bronze Helmet' },
    beschreibung: {
      de: 'Ein getriebener Bronzehelm mit Nasenschutz über einem Futter aus Fasergewebe. Teil der Bronzerüstung.',
      en: 'A raised bronze helmet with a nose guard over a lining of woven fibre. Part of the bronze armour.',
    },
    stufe: T1,
    ausruestung: 'kopf',
    gewicht: 'schwer',
    werte: { ruestung: 3 },
    tauschwert: 52,
    sounds: { aufheben: RUESTUNG_SFX.bronze },
  }),
  teil({
    id: 'bronzebrustpanzer',
    name: { de: 'Bronzebrustpanzer', en: 'Bronze Cuirass' },
    beschreibung: {
      de: 'Ein am Amboss getriebener Brustpanzer mit Schulterplatten und Lederschurz. Schwer – er bremst den Schritt –, doch kaum ein Biss dringt durch. Teil der Bronzerüstung.',
      en: 'A cuirass raised on the anvil, with shoulder plates and a leather skirt. Heavy – it slows the step –, but hardly a bite gets through. Part of the bronze armour.',
    },
    stufe: T1,
    ausruestung: 'brust',
    gewicht: 'schwer',
    werte: { ruestung: 4 },
    tauschwert: 89,
    sounds: { aufheben: RUESTUNG_SFX.bronze },
  }),
  teil({
    id: 'bronzebeinschienen',
    name: { de: 'Bronzebeinschienen', en: 'Bronze Greaves' },
    beschreibung: {
      de: 'Gewölbte Bronzeschienen über Schenkel und Knie, auf Fasergewebe genäht. Teil der Bronzerüstung.',
      en: 'Curved bronze plates over thigh and knee, sewn onto woven fibre. Part of the bronze armour.',
    },
    stufe: T1,
    ausruestung: 'beine',
    gewicht: 'schwer',
    werte: { ruestung: 3 },
    tauschwert: 66,
    sounds: { aufheben: RUESTUNG_SFX.bronze },
  }),
  teil({
    id: 'bronzestiefel',
    name: { de: 'Bronzestiefel', en: 'Bronze Sabatons' },
    beschreibung: {
      de: 'Stiefel mit Bronzekappen und -schienen über dem Rist. Teil der Bronzerüstung.',
      en: 'Boots with bronze caps and plates over the instep. Part of the bronze armour.',
    },
    stufe: T1,
    ausruestung: 'fuesse',
    gewicht: 'schwer',
    werte: { ruestung: 2 },
    tauschwert: 52,
    sounds: { aufheben: RUESTUNG_SFX.bronze },
  }),
]);

/** Stations of the armoury (their records: src/content/stations.ts; recipes: src/content/recipes/ruestung.ts). */
export const RUESTUNG_STATIONEN = defineItemGroup('ruestung_stationen', [
  baseItem({
    id: 'webstuhl',
    name: { de: 'Webstuhl', en: 'Loom' },
    beschreibung: {
      de: 'Ein Rahmen aus Stämmen und Zweigen mit gespannten Kettfäden. Aufgestellt webt man an ihm Fasern zu Fasergewebe.',
      en: 'A frame of logs and twigs with taut warp threads. Set up, fibres are woven into woven fibre at it.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 36,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'schneidertisch',
    name: { de: 'Schneidertisch', en: 'Tailor’s Table' },
    beschreibung: {
      de: 'Ein Brettertisch mit Zuschneidebrett und Nadelkissen. Aufgestellt schneidet und näht man an ihm Fasergewand, Lederrüstung und den Rucksack.',
      en: 'A plank table with a cutting board and a pincushion. Set up, fibre garb, leather armour and the backpack are cut and sewn at it.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 17,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'gerbrahmen',
    name: { de: 'Gerbrahmen', en: 'Tanning Frame' },
    beschreibung: {
      de: 'Ein Rahmen aus Stämmen, in den ein Fell mit Rindengerbe gespannt wird. Macht aus Fell und Rinde mit der Zeit Leder – ganz ohne Brennstoff, auch wenn niemand dabei ist.',
      en: 'A frame of logs in which a pelt is stretched with bark tannin. Turns hide and bark into leather over time – no fuel needed, even while nobody is near.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 34,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
]);
