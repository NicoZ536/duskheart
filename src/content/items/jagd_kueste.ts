/**
 * Hunting goods of the Salt Coast (M6-23, M6-24; MASTERPROMPT §14 "Jagen & Zerlegen … Spezialteile"; docs/SPIEL.md §14
 * "Jagdgüter": the special parts of each creature, the final list with its strand). The coast's catch is mostly the common
 * goods – fowl and feathers of the gull, fat, hide, bones and sinew of the seal (src/content/creatures/salzkueste.ts);
 * only crab and lobster give something of their own:
 * - **Raw crab meat**: the white meat of claws and shell. Raw food like venison (§18 "roh (geringer Wert)"): it fills a
 *   little, frightens a little (§12.3 "rohe Nahrung +5"), quenches a sip of thirst (sea water in the shell) and spoils
 *   within two days (`BALANCE.creatures.hunting.meatShelfDays`); the kitchen of M7 cooks it.
 * - Trade value [trade points, 1 = one piece of wood]: a crab is caught with a box trap or two blows – a little below
 *   venison.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

const H = BALANCE.creatures.hunting;

/** Hunting goods of the coast. */
export const JAGD_KUESTE = defineItemGroup('jagd_kueste', [
  baseItem({
    id: 'krebsfleisch_roh',
    name: { de: 'Rohes Krebsfleisch', en: 'Raw Crab Meat' },
    beschreibung: {
      de: 'Weißes, süßliches Fleisch aus Scheren und Panzer von Krabbe und Scherenkrebs. Roh zäh und wenig nahrhaft; gegart eine Kostbarkeit der Küste. Verdirbt schnell.',
      en: 'White, sweet meat from the claws and shell of crab and lobster. Raw it is tough and gives little; cooked it is a delicacy of the coast. Spoils quickly.',
    },
    kategorie: 'nahrung',
    frische: H.meatShelfDays,
    essbar: { saettigung: 4, durst: 1 },
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.fleisch },
  }),
]);
