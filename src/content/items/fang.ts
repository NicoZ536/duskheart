/**
 * Items of fishing (docs/SPIEL.md §29 "Feld & Fang", MASTERPROMPT §14 "Angeln: Angel (T0 Stock + Faser + Knochenhaken
 * …), Köder … Reusen (passiv)"; M7-24): the eight raw fish (src/content/fishing/), the stick rod, its bone hook, the fish
 * trap and the earthworm bait.
 *
 * - **Raw fish** (`id` = the fish): raw food of low value like raw meat (§18 "roh (geringer Wert)"), spoiling within two
 *   days (`BALANCE.fishing.rawShelfDays`); the kitchen of M7-25 … M7-27 fries, smokes and boils them. Source: fishing
 *   (`angeln:<fish>`) and the fish traps of the fish that swim into them.
 * - **Stick rod** `angel_holz` (tool kind `angel`, T0): a twig, fibre line and a bone hook (§14 "T0 Stock + Faser +
 *   Knochenhaken"). E on open water casts it; holding E reels the line in (src/game/fishing).
 * - **Bone hook** `knochenhaken`: an intermediate, carved from a bone.
 * - **Fish trap** `reuse`: a woven basket set into water (`fishing.placeTrap`); it catches a fish now and then at 06:00.
 * - **Earthworm** `regenwurm` (block `koeder`): turned up by the hoe (§20 "regenwurm aus graben:erde"); the next cast takes
 *   one from the bags – fish bite sooner, trout, perch and eel prefer it.
 * Trade values [trade points, 1 = one piece of wood]: a fish about raw meat, the gear its ingredients plus a fifth.
 */
import { BALANCE } from '../balance';
import type { ItemInput } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

const SHELF = BALANCE.fishing.rawShelfDays;
/** Handling sound of fish (wet scales): the raw meat preset. */
const FISCH = ITEM_SFX.fleisch;

/** One raw fish: names, a sentence about it, satiation and thirst [points of 100], trade value. */
function rawFish(id: string, name: { de: string; en: string }, text: { de: string; en: string }, saettigung: number, tauschwert: number): ItemInput {
  return baseItem({
    id,
    name,
    beschreibung: text,
    kategorie: 'nahrung',
    frische: SHELF,
    essbar: { saettigung, durst: 1 },
    tauschwert,
    quellen: [`angeln:${id}`],
    sounds: { aufheben: FISCH },
  });
}

/** Mining power and durability of the stick rod (T0, §D "T0 60 Nutzungen": one use per caught fish). */
const T0_POWER = BALANCE.tools.miningPowerByTier[0] as number;
const T0_DURABILITY = BALANCE.items.durabilityByTier[0] as number;

/** Fish, rod, hook, trap and bait. */
export const FANG = defineItemGroup('fang', [
  rawFish(
    'forelle',
    { de: 'Forelle', en: 'Trout' },
    { de: 'Eine gefleckte Forelle aus klarem, fließendem Wasser. Beißt am Tag, springt am Haken.', en: 'A speckled trout from clear running water. Bites by day, leaps on the hook.' },
    4,
    4,
  ),
  rawFish(
    'barsch',
    { de: 'Barsch', en: 'Perch' },
    { de: 'Ein gestreifter Barsch mit stacheliger Rückenflosse – der häufigste Fang in Seen und Flüssen.', en: 'A striped perch with a spiny back fin – the most common catch in lakes and rivers.' },
    3,
    3,
  ),
  rawFish(
    'karpfen',
    { de: 'Karpfen', en: 'Carp' },
    { de: 'Ein schwerer, goldbrauner Karpfen aus stillem Wasser. Beißt in der Dämmerung und nachts.', en: 'A heavy golden-brown carp from still water. Bites at dusk and at night.' },
    5,
    4,
  ),
  rawFish(
    'hecht',
    { de: 'Hecht', en: 'Pike' },
    { de: 'Ein langer Raubfisch mit spitzem Maul. Zieht hart – auch unter dem Eis.', en: 'A long predator with a pointed snout. Pulls hard – under the ice too.' },
    6,
    6,
  ),
  rawFish(
    'aal',
    { de: 'Aal', en: 'Eel' },
    { de: 'Ein glatter, schlangengleicher Aal. Kommt nachts aus dem Schlamm, am liebsten nach Regen.', en: 'A smooth, snakelike eel. Comes out of the mud at night, best after rain.' },
    5,
    5,
  ),
  rawFish(
    'quappe',
    { de: 'Quappe', en: 'Burbot' },
    { de: 'Ein Fisch der kalten Jahreszeit, der nachts nahe dem Grund jagt – auch durch ein Eisloch.', en: 'A fish of the cold season that hunts near the bottom at night – through an ice hole too.' },
    4,
    4,
  ),
  rawFish(
    'hering',
    { de: 'Hering', en: 'Herring' },
    { de: 'Ein silbriger Schwarmfisch der Salzküste. Leicht zu fangen, rasch verdorben.', en: 'A silvery shoaling fish of the Salt Coast. Easy to catch, quick to spoil.' },
    3,
    3,
  ),
  rawFish(
    'makrele',
    { de: 'Makrele', en: 'Mackerel' },
    { de: 'Eine blau gestreifte Makrele aus dem Meer, schnell und kampfstark. Nur im Sommer und Herbst.', en: 'A blue-striped mackerel from the sea, fast and a fighter. Only in summer and autumn.' },
    4,
    5,
  ),
  baseItem({
    id: 'angel_holz',
    name: { de: 'Stockangel', en: 'Stick Rod' },
    beschreibung: {
      de: 'Ein biegsamer Zweig mit Faserschnur, Pose und Knochenhaken. E auf offenes Wasser wirft aus; E halten holt ein – die Schnur nicht reißen, den Fisch nicht entkommen lassen.',
      en: 'A springy twig with fibre line, float and bone hook. E on open water casts; hold E to reel in – do not snap the line, do not let the fish get away.',
    },
    kategorie: 'werkzeug',
    haltbarkeit: T0_DURABILITY,
    // A rod mines nothing; tool data names its kind (the schema's lowest power stands for "none needed").
    werkzeug: { art: 'angel', abbaukraft: T0_POWER },
    tauschwert: 8,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: 'sfx_angeln_wurf' },
  }),
  baseItem({
    id: 'knochenhaken',
    name: { de: 'Knochenhaken', en: 'Bone Hook' },
    beschreibung: {
      de: 'Ein aus Knochen geschnitzter Haken mit Widerhaken. Das Herzstück einer Angel.',
      en: 'A barbed hook carved from bone. The heart of a fishing rod.',
    },
    kategorie: 'rohstoff',
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'reuse',
    name: { de: 'Reuse', en: 'Fish Trap' },
    beschreibung: {
      de: 'Ein geflochtener Korb mit trichterförmigem Eingang. Ins Wasser gesetzt fängt er von selbst – jeden Morgen kann ein Fisch darin sein. E nimmt den Fang heraus.',
      en: 'A woven basket with a funnel-shaped mouth. Set into water, it catches on its own – every morning a fish may be inside. E takes the catch out.',
    },
    kategorie: 'platzierbar',
    // Set into water by the fishing system (like the traps of M6): no recipe or part takes it.
    endprodukt: true,
    tauschwert: 12,
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'regenwurm',
    name: { de: 'Regenwurm', en: 'Earthworm' },
    beschreibung: {
      de: 'Ein dicker Wurm aus frisch gehackter Erde. Als Köder in den Taschen: Fische beißen schneller, Forelle, Barsch und Aal am liebsten.',
      en: 'A fat worm from freshly hoed soil. As bait in your bags: fish bite sooner, trout, perch and eel like it best.',
    },
    kategorie: 'rohstoff',
    koeder: { biss: 1.5, fische: ['forelle', 'barsch', 'aal'] },
    // Taken by the next cast (block `koeder`): no recipe or part takes it.
    endprodukt: true,
    tauschwert: 1,
    quellen: ['graben:erde'],
    sounds: { aufheben: ITEM_SFX.erde },
  }),
]);
