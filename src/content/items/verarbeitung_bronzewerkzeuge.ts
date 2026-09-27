/**
 * Bronze tools – tier T1 (MASTERPROMPT §13.2 "T1 Bronze · Abbaukraft 2", §14 "Werkzeuge", §D; M4-10
 * "Bronzewerkzeuge außer der Spitzhacke"): axe, shovel, hoe, sickle, hammer and knife, hammered from bronze
 * bars at the bronze anvil (src/content/recipes/bronze.ts) and fitted with a wooden haft; sickle and knife
 * get a grip wrapped in yarn.
 *
 * - Mining power from `BALANCE.tools.miningPowerByTier` (§13.2: T1 2 – a Grünhain tree falls in three blows
 *   instead of five, §D), durability from `BALANCE.items.durabilityByTier` (§D: T1 150 uses).
 * - The bronze pickaxe is not here: §13.2 "Die Spitzhacke jeder Stufe ab T1 braucht den Schlüssel-Drop des
 *   Bosses dieser Stufe" – its recipe with the Kernholz of the Borkenvater follows in M7-34
 *   (src/content/gating.ts).
 * - Trade values [trade points]: the bars and the haft plus about a fifth for the smithing.
 */
import { BALANCE } from '../balance';
import type { ItemInput, ItemToolKind } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the bronze tools. */
const TIER = 1;
/** Mining power of a T1 tool (§13.2). */
const POWER = BALANCE.tools.miningPowerByTier[TIER] as number;
/** Durability of a T1 tool [uses] (§D). */
const DURABILITY = BALANCE.items.durabilityByTier[TIER] as number;
/** Swing of a tool at work (the sound of the stone tools; the metal ring comes with the bronze hit of the material). */
const TOOL_SWING_SFX = 'sfx_werkzeug_schwung';

/** One bronze tool of kind `art`. */
function bronzeTool(id: string, art: ItemToolKind, name: ItemInput['name'], beschreibung: ItemInput['beschreibung'], tauschwert: number): ItemInput {
  return baseItem({
    id,
    name,
    beschreibung,
    kategorie: 'werkzeug',
    stufe: TIER,
    haltbarkeit: DURABILITY,
    werkzeug: { art, abbaukraft: POWER },
    tauschwert,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: TOOL_SWING_SFX },
  });
}

/** Bronze tools T1. */
export const BRONZEWERKZEUGE = defineItemGroup('verarbeitung_bronzewerkzeuge', [
  bronzeTool(
    'bronzeaxt',
    'axt',
    { de: 'Bronzeaxt', en: 'Bronze Axe' },
    {
      de: 'Ein geschmiedetes Bronzeblatt an einem Holzstiel. Fällt einen Grünhain-Baum in drei Hieben und kommt durch härteres Holz.',
      en: 'A forged bronze blade on a wooden haft. Fells a Greenwood tree in three blows and cuts through harder wood.',
    },
    46,
  ),
  bronzeTool(
    'bronzeschaufel',
    'schaufel',
    { de: 'Bronzeschaufel', en: 'Bronze Shovel' },
    {
      de: 'Ein breites Bronzeblatt am Stiel. Gräbt schneller und sticht auch zähen Torf.',
      en: 'A broad bronze blade on a haft. Digs faster and cuts even tough peat.',
    },
    46,
  ),
  bronzeTool(
    'bronzehacke',
    'hacke',
    { de: 'Bronzehacke', en: 'Bronze Hoe' },
    {
      de: 'Eine bronzene Querklinge am Stiel. Lockert Felder mit weniger Schlägen.',
      en: 'A bronze crosswise blade on a haft. Loosens fields with fewer strokes.',
    },
    31,
  ),
  bronzeTool(
    'bronzesichel',
    'sichel',
    { de: 'Bronzesichel', en: 'Bronze Sickle' },
    {
      de: 'Eine gebogene Bronzeklinge mit garnumwickeltem Griff. Schneidet Schilf und Dornen sauber.',
      en: 'A curved bronze blade with a yarn-wrapped grip. Cuts reeds and thorns cleanly.',
    },
    34,
  ),
  bronzeTool(
    'bronzehammer',
    'hammer',
    { de: 'Bronzehammer', en: 'Bronze Hammer' },
    {
      de: 'Ein schwerer Bronzekopf am Stiel. Das Werkzeug zum Bauen und Ausbessern – kräftiger als der Steinhammer.',
      en: 'A heavy bronze head on a haft. The tool for building and mending – stronger than the stone hammer.',
    },
    60,
  ),
  bronzeTool(
    'bronzemesser',
    'messer',
    { de: 'Bronzemesser', en: 'Bronze Knife' },
    {
      de: 'Eine schlanke Bronzeklinge mit garnumwickeltem Griff. Zerlegt Wild sauberer als Feuerstein.',
      en: 'A slender bronze blade with a yarn-wrapped grip. Cuts up game more cleanly than flint.',
    },
    19,
  ),
]);
