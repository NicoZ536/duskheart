/**
 * Hunting goods of the Grünhain foes (M6-22; MASTERPROMPT §14 "Jagen & Zerlegen … Spezialteile"; docs/SPIEL.md §14
 * "Jagdgüter": the special parts of each creature, the final list with its strand). The Grünhain's animals give the common
 * goods – meat, hide, bones, fat and sinew of boar, badger, wolf, squirrel and frog (src/content/creatures/gruenhain.ts);
 * the Dornling's thorns hold the remains of its prey (bones, hide, feathers). Only the wasp swarm gives something of its
 * own:
 * - **Wasp sting**: the poison stings of a slain swarm, still full of venom – an arrow poison besides the fly agaric
 *   (`rezept_pfeil_gift_wespe`, src/content/recipes/jagd_gruenhain.ts).
 * - Trade value [trade points, 1 = one piece of wood]: a swarm is fought, not gathered – a little above the fly agaric.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Hunting goods of the Grünhain foes. */
export const JAGD_GRUENHAIN = defineItemGroup('jagd_gruenhain', [
  baseItem({
    id: 'wespenstachel',
    name: { de: 'Wespenstachel', en: 'Wasp Stings' },
    beschreibung: {
      de: 'Die Giftstacheln eines erschlagenen Wespenschwarms, noch voller Gift. An Pfeilspitzen gestrichen, vergiften sie, was sie treffen.',
      en: 'The poison stings of a slain wasp swarm, still full of venom. Smeared on arrowheads, they poison whatever they hit.',
    },
    kategorie: 'rohstoff',
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.federn },
  }),
]);
