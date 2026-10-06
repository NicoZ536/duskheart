/**
 * Station items of tiers T0 and T1 (MASTERPROMPT §15.2; docs/SPIEL.md §8 "Stationen T0 (M4-05) … T1 (M4-06)"):
 * the placeable pieces the stations of src/content/stations.ts are made of. The campfire and Werkbank I are
 * basics (src/content/items/grundlagen.ts); these follow them. How each station works (stage, slots, fuel,
 * repair) is its station record; its recipe is in src/content/recipes/stationen.ts. Placed, a station is
 * drawn with `obj_<id>`, in the bags with `icon_<id>`.
 *
 * Trade values [trade points, 1 = one log]: the ingredients of the recipe plus about a fifth for the work;
 * Werkbank II includes the Werkbank I it is built on.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the stone-age stations (§13.2 T0). */
const T0 = 0;
/** Tier of the bronze-age stations (§13.2 T1). */
const T1 = 1;

/** Station items T0–T1 (without campfire and Werkbank I). */
export const STATIONEN = defineItemGroup('stationen', [
  // ---- T0 (M4-05) ----
  baseItem({
    id: 'saegebock',
    name: { de: 'Sägebock', en: 'Sawbuck' },
    beschreibung: {
      de: 'Zwei gekreuzte Holzböcke mit eingespanntem Stamm. Aufgestellt sägt man an ihm Bretter, Balken und Schindeln.',
      en: 'Two crossed trestles with a clamped trunk. Set up, planks, beams and shingles are sawn at it.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 24,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'steinmetzbank',
    name: { de: 'Steinmetzbank', en: 'Mason’s Bench' },
    beschreibung: {
      de: 'Ein schwerer Werktisch mit Steinplatte. Aufgestellt behaut man an ihm Steine zu Blöcken.',
      en: 'A heavy work table with a stone top. Set up, stones are dressed into blocks at it.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 31,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'trockengestell',
    name: { de: 'Trockengestell', en: 'Drying Rack' },
    beschreibung: {
      de: 'Ein luftiges Gestell aus Zweigen. Trocknet Fasern zu Stroh und Lehm zu Rohziegeln – ganz ohne Brennstoff, es braucht nur Zeit.',
      en: 'An airy frame of twigs. Dries fibres into straw and clay into raw bricks – no fuel needed, only time.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 38,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'koehlermeiler',
    name: { de: 'Köhlermeiler', en: 'Charcoal Kiln' },
    beschreibung: {
      de: 'Ein mit Erde und Laub abgedeckter Holzstoß. Schwelt langsam und verwandelt Holz in Holzkohle; ein Scheit Glut hält eine ganze Ladung am Schwelen.',
      en: 'A woodpile covered with earth and leaves. Smoulders slowly and turns wood into charcoal; one log of embers keeps a whole load smouldering.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 41,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'lehmofen',
    name: { de: 'Lehmofen', en: 'Clay Oven' },
    beschreibung: {
      de: 'Eine Kuppel aus Lehm über einem Steinsockel. Brennt Ziegel und Keramik und schmilzt Sand zu Glas.',
      en: 'A dome of clay on a stone base. Fires bricks and pottery and melts sand into glass.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 53,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  // ---- T1 (M4-06) ----
  baseItem({
    id: 'werkbank_2',
    name: { de: 'Werkbank II', en: 'Workbench II' },
    beschreibung: {
      de: 'Die Werkbank mit Hobelbank und Werkzeugwand. Arbeitet ein Viertel schneller, gibt besseren Stücken den Vorzug und bessert auch Bronze aus.',
      en: 'The workbench with a planing bench and a tool wall. Works a quarter faster, favours better pieces and also mends bronze.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 94,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'schmelzofen',
    name: { de: 'Schmelzofen', en: 'Smelting Furnace' },
    beschreibung: {
      de: 'Ein gemauerter Ziegelschacht mit Tiegel. Schmilzt Kupfer- und Zinnerz zu Barren und legiert sie zu Bronze – nur mit Holzkohle oder heißerem Brennstoff.',
      en: 'A brick shaft with a crucible. Smelts copper and tin ore into bars and alloys them into bronze – only with charcoal or a hotter fuel.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 146,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'amboss_bronze',
    name: { de: 'Bronzeamboss', en: 'Bronze Anvil' },
    beschreibung: {
      de: 'Ein bronzener Amboss auf einem Steinblock. An ihm entstehen Bronzewerkzeuge und Nägel; er bessert Werkzeuge, Waffen und Rüstung aus.',
      en: 'A bronze anvil on a stone block. Bronze tools and nails are made at it; it mends tools, weapons and armour.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 102,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'schleifstein',
    name: { de: 'Schleifstein', en: 'Grindstone' },
    beschreibung: {
      de: 'Ein runder Stein in einem Holzgestell, mit einer Kurbel gedreht. Schärft stumpfe Werkzeuge und Waffen.',
      en: 'A round stone in a wooden frame, turned with a crank. Sharpens blunt tools and weapons.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 18,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'spinnrad',
    name: { de: 'Spinnrad', en: 'Spinning Wheel' },
    beschreibung: {
      de: 'Ein genageltes Rad mit Spindel. Spinnt Fasern zu Garn.',
      en: 'A nailed wheel with a spindle. Spins fibres into yarn.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 30,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  // ---- Strand F (M7-36): the station the first beacon teaches (unlock `lf1_lumen_werkbank`) ----
  baseItem({
    id: 'lumen_werkbank',
    name: { de: 'Lumen-Werkbank', en: 'Lumen Workbench' },
    beschreibung: {
      de: 'Eine Werkbank mit eingelegtem Lumenglas und einer Harzrinne. Das Wissen des ersten Leuchtfeuers: An ihr bindet man Lumen in Laternen und Wegsteine.',
      en: 'A workbench with inlaid Lumen glass and a resin channel. The knowledge of the first beacon: at it, Lumen is bound into lanterns and way stones.',
    },
    kategorie: 'platzierbar',
    stufe: T1,
    tauschwert: 96,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  // ---- Strand D (M7-20): the compost box (docs/SPIEL.md §20 "Kompostkiste") ----
  baseItem({
    id: 'kompostkiste',
    name: { de: 'Kompostkiste', en: 'Compost Box' },
    beschreibung: {
      de: 'Eine Kiste aus Brettern mit Lattenwänden. Laub, Fasern und Gartenabfälle verrotten darin in einem Tag zu Kompost für die Felder.',
      en: 'A box of planks with slatted sides. Leaves, fibres and garden waste rot in it into compost for the fields within a day.',
    },
    kategorie: 'platzierbar',
    stufe: T0,
    tauschwert: 9,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
]);
