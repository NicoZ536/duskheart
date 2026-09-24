/**
 * Tools of tier T0 (M3-15; docs/SPIEL.md §6 "Werkzeuge T0"; MASTERPROMPT §13.2, §14 "Werkzeuge", §D):
 * stone axe, pickaxe, shovel, hoe, sickle, hammer and knife – a head of stone or flint lashed to a twig
 * haft with fibre rope – and the wooden bucket, empty and filled with water.
 *
 * - Mining power from `BALANCE.tools.miningPowerByTier` (§13.2: T0 1 – enough for rock, copper and tin),
 *   durability from `BALANCE.items.durabilityByTier` (§D: T0 60 uses). Every hit is one use
 *   (`BALANCE.harvest.toolWearPerHit`); a broken tool stays in the bags and is unusable (§13.1).
 * - What each kind does: the axe fells trees and clears stumps, the pickaxe breaks rock, ore nodes and
 *   veins, the shovel digs ground, the hoe tills fields, the sickle cuts reeds and thorny bushes
 *   (src/game/gathering). The hammer builds and repairs, the knife cuts up game (their systems follow with
 *   building and hunting); the bucket carries water: it is filled at a river, lake or spring (recipe
 *   `rezept_holzeimer_wasser`) and poured out again (`player.useItem`, src/game/tools).
 * - All of them are made without a station (src/content/recipes/grundlagen.ts).
 * - Trade values [trade points]: the ingredients of the recipe plus about a fifth for the work.
 */
import { BALANCE } from '../balance';
import type { ItemInput, ItemToolKind } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the stone tools. */
const TIER = 0;
/** Mining power of a T0 tool (§13.2). */
const POWER = BALANCE.tools.miningPowerByTier[TIER] as number;
/** Durability of a T0 tool [uses] (§D). */
const DURABILITY = BALANCE.items.durabilityByTier[TIER] as number;

/** Handling sound of tools: a wooden haft with a stone head bumping (preset of the audio kernel). */
const TOOL_HANDLING_SFX = ITEM_SFX.werkzeug;
/** Swing of a tool at work. */
const TOOL_SWING_SFX = 'sfx_werkzeug_schwung';
/** Water poured out of a bucket. */
const POUR_SFX = 'sfx_wasser_platsch';

/** One stone tool of kind `art`. */
function stoneTool(id: string, art: ItemToolKind, name: ItemInput['name'], beschreibung: ItemInput['beschreibung'], tauschwert: number): ItemInput {
  return baseItem({
    id,
    name,
    beschreibung,
    kategorie: 'werkzeug',
    stufe: TIER,
    haltbarkeit: DURABILITY,
    werkzeug: { art, abbaukraft: POWER },
    tauschwert,
    sounds: { aufheben: TOOL_HANDLING_SFX, benutzen: TOOL_SWING_SFX },
  });
}

/** Tools T0. */
export const WERKZEUGE = defineItemGroup('werkzeuge', [
  stoneTool(
    'steinaxt',
    'axt',
    { de: 'Steinaxt', en: 'Stone Axe' },
    {
      de: 'Ein keilförmiger Stein, mit Faserseil an einen Zweig gebunden. Fällt Bäume und rodet ihre Stümpfe – ein Grünhain-Baum braucht fünf Hiebe.',
      en: 'A wedge of stone lashed to a twig with fibre rope. Fells trees and clears their stumps – a Greenwood tree takes five blows.',
    },
    10,
  ),
  stoneTool(
    'steinspitzhacke',
    'spitzhacke',
    { de: 'Steinspitzhacke', en: 'Stone Pickaxe' },
    {
      de: 'Ein spitzer Steinbogen am Stiel. Bricht Felsen, Kupfer- und Zinnerz und schlägt Stollen in das Gestein der Wurzelhöhlen.',
      en: 'A pointed arc of stone on a haft. Breaks rocks, copper and tin ore and cuts tunnels into the rock of the Root Caves.',
    },
    11,
  ),
  stoneTool(
    'steinschaufel',
    'schaufel',
    { de: 'Steinschaufel', en: 'Stone Shovel' },
    {
      de: 'Ein flaches Steinblatt am Stiel. Gräbt Erde, Lehm und Sand, legt Pfade, Gruben und Wassergräben an und findet vergrabene Dinge.',
      en: 'A flat blade of stone on a haft. Digs soil, clay and sand, lays paths, pits and water ditches and finds buried things.',
    },
    10,
  ),
  stoneTool(
    'steinhacke',
    'hacke',
    { de: 'Steinhacke', en: 'Stone Hoe' },
    {
      de: 'Eine quer gebundene Klinge aus Stein und Feuerstein. Lockert den Boden zu Feldern, in die später gesät wird.',
      en: 'A blade of stone and flint bound crosswise. Loosens the ground into fields to be sown later.',
    },
    12,
  ),
  stoneTool(
    'steinsichel',
    'sichel',
    { de: 'Steinsichel', en: 'Stone Sickle' },
    {
      de: 'Ein gebogener Feuersteinsplitter am kurzen Griff. Schneidet Schilf und dornige Sträucher, an die keine Hand heranreicht.',
      en: 'A curved flint shard on a short grip. Cuts reeds and thorny shrubs no bare hand can reach into.',
    },
    13,
  ),
  stoneTool(
    'steinhammer',
    'hammer',
    { de: 'Steinhammer', en: 'Stone Hammer' },
    {
      de: 'Ein schwerer Steinbrocken am Stiel. Das Werkzeug zum Bauen und Ausbessern von Bauteilen.',
      en: 'A heavy lump of stone on a haft. The tool for building and mending structures.',
    },
    11,
  ),
  stoneTool(
    'steinmesser',
    'messer',
    { de: 'Steinmesser', en: 'Stone Knife' },
    {
      de: 'Eine scharfe Feuersteinklinge mit umwickeltem Griff. Zum Zerlegen von Wild – Fleisch, Fell, Knochen und Sehnen.',
      en: 'A sharp flint blade with a wrapped grip. For cutting up game – meat, hide, bone and sinew.',
    },
    10,
  ),
  baseItem({
    id: 'holzeimer',
    name: { de: 'Holzeimer', en: 'Wooden Bucket' },
    beschreibung: {
      de: 'Holzdauben, mit Faserseil gebunden und mit Harz abgedichtet. An Fluss, See oder Quelle mit Wasser zu füllen.',
      en: 'Wooden staves bound with fibre rope and sealed with resin. Fill it with water at a river, lake or spring.',
    },
    kategorie: 'werkzeug',
    stufe: TIER,
    haltbarkeit: DURABILITY,
    // A bucket mines nothing; tool data names its kind (the schema's lowest power stands for "none needed").
    werkzeug: { art: 'eimer', abbaukraft: POWER },
    tauschwert: 18,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'holzeimer_wasser',
    name: { de: 'Holzeimer mit Wasser', en: 'Bucket of Water' },
    beschreibung: {
      de: 'Ein voller Eimer Wasser. Ausgegossen löscht er Flammen am eigenen Leib und durchnässt dabei; jedes Ausgießen nutzt den Eimer ein wenig ab.',
      en: 'A full bucket of water. Poured out, it puts out flames on your own body and soaks you; every pour wears the bucket a little.',
    },
    kategorie: 'werkzeug',
    stufe: TIER,
    haltbarkeit: DURABILITY,
    werkzeug: { art: 'eimer', abbaukraft: POWER },
    tauschwert: 18,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: POUR_SFX },
  }),
]);

/** A bucket: the empty item, the one filled with water and the conditions pouring it over oneself ends. */
export interface BucketPair {
  readonly empty: string;
  readonly full: string;
  /** Condition ids (src/content/conditions.ts) the water puts out. */
  readonly loescht: readonly string[];
}

/** The buckets (filled by the recipe `rezept_<full>`, emptied by `player.useItem`): water puts out flames (§11.3 "Brennen"). */
export const BUCKETS: readonly BucketPair[] = [{ empty: 'holzeimer', full: 'holzeimer_wasser', loescht: ['brennen'] }];
