/**
 * Processing products of tiers T0 and T1 (MASTERPROMPT §15.1, §15.2, §15.4; docs/SPIEL.md §8
 * "Verarbeitungsprodukte T0–T1"; M4-10): what the stations make from the raw materials of the first island –
 * charcoal, boards, beams, shingles, stone blocks, straw, bricks, pottery, glass, clay plaster, the bars of
 * copper, tin and bronze (§13.2 "T1 Bronze": copper and tin), yarn and bronze nails. Their recipes are in
 * src/content/recipes/verarbeitung.ts, the stations in src/content/stations.ts.
 *
 * - Charcoal burns 120 s (§15.4, `BALANCE.stations.burnSeconds`) – the weakest fuel the smelting furnace
 *   accepts (`BALANCE.stations.fuel`).
 * - Bars stack by 50 (§13.1 "Barren 50"), everything else is a raw material (100).
 * - Trade values [trade points, 1 = one log]: the ingredients of the recipe per piece plus about a fifth for
 *   the work and the fuel.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the stone-age products (§13.2 T0). */
const T0 = 0;
/** Tier of the metal products (§13.2 T1 Bronze). */
const T1 = 1;

/** Processing products T0–T1. */
export const VERARBEITUNG = defineItemGroup('verarbeitung', [
  baseItem({
    id: 'holzkohle',
    name: { de: 'Holzkohle', en: 'Charcoal' },
    beschreibung: {
      de: 'Im Köhlermeiler oder in der Glut des Lagerfeuers verkohltes Holz. Brennt heiß und lange – heiß genug für den Schmelzofen.',
      en: 'Wood charred in the charcoal kiln or in the embers of a campfire. Burns hot and long – hot enough for the smelting furnace.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    brennwert: BALANCE.stations.burnSeconds.holzkohle,
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'brett',
    name: { de: 'Brett', en: 'Plank' },
    beschreibung: {
      de: 'Am Sägebock aus Holz oder Treibholz gesägt. Für Werkbank, Spinnrad, Schindeln und Holzbauten.',
      en: 'Sawn from logs or driftwood at the sawbuck. For the workbench, the spinning wheel, shingles and wooden buildings.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'balken',
    name: { de: 'Balken', en: 'Beam' },
    beschreibung: {
      de: 'Ein vierkantig gesägter Stamm vom Sägebock. Trägt Werkbank, Amboss und Dächer.',
      en: 'A trunk sawn square at the sawbuck. Carries workbenches, anvils and roofs.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'dachschindel',
    name: { de: 'Dachschindel', en: 'Shingle' },
    beschreibung: {
      de: 'Dünn gespaltene Holzplättchen vom Sägebock. Überlappend gelegt halten sie Regen vom Dach fern.',
      en: 'Thinly split wooden tiles from the sawbuck. Laid overlapping, they keep the rain off a roof.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'steinblock',
    name: { de: 'Steinblock', en: 'Stone Block' },
    beschreibung: {
      de: 'An der Steinmetzbank rechtwinklig behauener Stein. Fundament von Öfen, Amboss und Schleifstein.',
      en: 'Stone dressed square at the mason’s bench. The footing of furnaces, the anvil and the grindstone.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'strohbuendel',
    name: { de: 'Strohbündel', en: 'Straw Bundle' },
    beschreibung: {
      de: 'Auf dem Trockengestell getrocknete Fasern, zu einem Bündel geschnürt. Magert Lehmputz ab und deckt Dächer.',
      en: 'Fibres dried on the drying rack and tied into a bundle. Tempers clay plaster and thatches roofs.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 7,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'ziegel_roh',
    name: { de: 'Rohziegel', en: 'Raw Brick' },
    beschreibung: {
      de: 'Aus Lehm und Sand geformt und auf dem Trockengestell getrocknet. Im Lehmofen gebrannt wird er zum Ziegel.',
      en: 'Shaped from clay and sand and dried on the drying rack. Fired in the clay oven, it becomes a brick.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'ziegel',
    name: { de: 'Ziegel', en: 'Brick' },
    beschreibung: {
      de: 'Im Lehmofen hart gebrannter Rohziegel. Hält die Hitze des Schmelzofens aus.',
      en: 'A raw brick fired hard in the clay oven. Withstands the heat of the smelting furnace.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'keramik_topf',
    name: { de: 'Keramiktopf', en: 'Clay Pot' },
    beschreibung: {
      de: 'Ein im Lehmofen gebrannter Topf. Als Schmelztiegel das Herz des Schmelzofens.',
      en: 'A pot fired in the clay oven. As a crucible, the heart of the smelting furnace.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 8,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'glas',
    name: { de: 'Glas', en: 'Glass' },
    beschreibung: {
      de: 'Im Lehmofen geschmolzener Sand, grünlich und voller Bläschen. Für Fenster und Glasdächer.',
      en: 'Sand melted in the clay oven, greenish and full of bubbles. For windows and glass roofs.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.stein },
  }),
  baseItem({
    id: 'lehmputz',
    name: { de: 'Lehmputz', en: 'Clay Plaster' },
    beschreibung: {
      de: 'Lehm, mit Sand und Stroh angemacht. Verfugt die Ziegel des Schmelzofens und füllt Fachwerk.',
      en: 'Clay mixed with sand and straw. Mortars the bricks of the smelting furnace and fills half-timbering.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
  baseItem({
    id: 'kupferbarren',
    name: { de: 'Kupferbarren', en: 'Copper Bar' },
    beschreibung: {
      de: 'Im Schmelzofen aus Kupfererz geschmolzen. Mit Zinn legiert wird daraus Bronze.',
      en: 'Smelted from copper ore in the smelting furnace. Alloyed with tin, it becomes bronze.',
    },
    kategorie: 'barren',
    stufe: T1,
    tauschwert: 11,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'zinnbarren',
    name: { de: 'Zinnbarren', en: 'Tin Bar' },
    beschreibung: {
      de: 'Im Schmelzofen aus Zinnerz geschmolzen. Weich und silbrig – ein Teil Zinn härtet drei Teile Kupfer zu Bronze.',
      en: 'Smelted from tin ore in the smelting furnace. Soft and silvery – one part tin hardens three parts copper into bronze.',
    },
    kategorie: 'barren',
    stufe: T1,
    tauschwert: 11,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'bronzebarren',
    name: { de: 'Bronzebarren', en: 'Bronze Bar' },
    beschreibung: {
      de: 'Kupfer und Zinn, im Schmelzofen legiert. Am Bronzeamboss werden daraus Werkzeuge, Nägel und Beschläge.',
      en: 'Copper and tin alloyed in the smelting furnace. At the bronze anvil it becomes tools, nails and fittings.',
    },
    kategorie: 'barren',
    stufe: T1,
    tauschwert: 12,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'garn',
    name: { de: 'Garn', en: 'Yarn' },
    beschreibung: {
      de: 'Am Spinnrad aus Fasern gesponnen. Umwickelt Griffe und wird später zu Stoff gewebt.',
      en: 'Spun from fibres at the spinning wheel. Wraps grips and will later be woven into cloth.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.pflanze },
  }),
  baseItem({
    id: 'nagel_bronze',
    name: { de: 'Bronzenagel', en: 'Bronze Nail' },
    beschreibung: {
      de: 'Am Bronzeamboss geschmiedet. Hält Bretter fester als jedes Seil.',
      en: 'Forged at the bronze anvil. Holds planks tighter than any rope.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
]);
