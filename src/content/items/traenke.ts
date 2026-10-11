/**
 * Potions and medicine 3–8 of the herb table (MASTERPROMPT §18 "≥ 22 Tränke und Medizin (Heiltrank, Gegengift, Fiebertee,
 * Wundsalbe, Schiene, Wärmetrank, Kühltrank …)", §11.3 "Vergiftung … Ein Gegengift hilft", "Fieber … heilt mit Medizin und
 * Ruhe"; docs/SPIEL.md §21 "Tränke & Medizin", §29; M7-28; strand E). With the bandage and the splint (M3, M4-35) they are the
 * eight remedies of Alchemie I; their recipes are at the herb table (src/content/recipes/traenke.ts).
 *
 * Block `trank` (src/content/schema/itemBlocks.ts): conditions it gives (group `trank`, src/content/conditions_m7.ts), conditions
 * it cures, instant effects (health, stamina, fear). Potions and teas are drunk like food (`action.eat`, `essbar` with a little
 * thirst; 1 s for a potion, 1,5 s for medicine); the salve has no `essbar` – it is applied from the bags like the bandage
 * (`player.useItem`, the herb table's item use in src/game/meals). None of them spoils.
 * Trade values [trade points, 1 = one log]: the ingredients plus about a fifth for the work.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** The herb table's potions and medicine. */
export const TRAENKE = defineItemGroup('traenke', [
  baseItem({
    id: 'heiltrank',
    name: { de: 'Heiltrank', en: 'Healing Potion' },
    beschreibung: {
      de: 'Ein leuchtend grüner Sud aus Heilkräutern und Leuchtpilz. Gibt sofort 30 Leben zurück und heilt eine halbe Minute lang weiter.',
      en: 'A glowing green brew of healing herbs and glowcap. Restores 30 health at once and keeps healing for half a minute.',
    },
    kategorie: 'trank',
    essbar: { saettigung: 0, durst: 4 },
    trank: { gibt: [{ id: 'heilend', sekunden: 30 }], heilt: [], sofort: { leben: 30 } },
    tauschwert: 9,
    sounds: { aufheben: ITEM_SFX.trank },
  }),
  baseItem({
    id: 'gegengift',
    name: { de: 'Gegengift', en: 'Antidote' },
    beschreibung: {
      de: 'Ein schwarzer Trank aus Holzkohle und Wegerich. Bindet das Gift im Blut und im Magen: heilt Vergiftung und Lebensmittelvergiftung.',
      en: 'A black draught of charcoal and plantain. Binds the poison in blood and belly: cures poisoning and food poisoning.',
    },
    kategorie: 'trank',
    essbar: { saettigung: 0, durst: 4 },
    trank: { gibt: [], heilt: ['vergiftung', 'lebensmittelvergiftung'] },
    tauschwert: 6,
    sounds: { aufheben: ITEM_SFX.trank },
  }),
  baseItem({
    id: 'fiebertee',
    name: { de: 'Fiebertee', en: 'Fever Tea' },
    beschreibung: {
      de: 'Ein bitterer Tee aus Schafgarbe und Kamille. Senkt das Fieber auf der Stelle – danach hilft Ruhe.',
      en: 'A bitter tea of yarrow and chamomile. Breaks the fever at once – rest does the rest.',
    },
    kategorie: 'medizin',
    essbar: { saettigung: 0, durst: 15 },
    trank: { gibt: [], heilt: ['fieber'] },
    tauschwert: 4,
    sounds: { aufheben: ITEM_SFX.trank },
  }),
  baseItem({
    id: 'wundsalbe',
    name: { de: 'Wundsalbe', en: 'Wound Salve' },
    beschreibung: {
      de: 'Eine zähe Salbe aus Wegerich und Harz, auf die Wunde gestrichen. Stillt Blutungen und lässt Wunden zwei Minuten lang schneller heilen.',
      en: 'A thick salve of plantain and resin, spread on the wound. Stops bleeding and makes wounds heal faster for two minutes.',
    },
    kategorie: 'medizin',
    trank: { gibt: [{ id: 'wundversorgt', sekunden: 120 }], heilt: ['blutung'] },
    // Applied from the bags like the bandage (src/game/meals/system.ts `itemUse`): no ingredient of anything.
    endprodukt: true,
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.trank, benutzen: 'sfx_heilen_salbe' },
  }),
  baseItem({
    id: 'waermetrank',
    name: { de: 'Wärmetrank', en: 'Warming Draught' },
    beschreibung: {
      de: 'Ein scharfer Trank aus Knoblauch und roten Blüten. Wärmt fünf Minuten lang wie ein zusätzlicher Pelz – gegen Frost und kalte Nächte.',
      en: 'A sharp draught of garlic and red blossoms. Warms like an extra fur for five minutes – against frost and cold nights.',
    },
    kategorie: 'trank',
    essbar: { saettigung: 0, durst: 6 },
    trank: { gibt: [{ id: 'gewaermt', sekunden: 300 }], heilt: [] },
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.trank },
  }),
  baseItem({
    id: 'kuehltrank',
    name: { de: 'Kühltrank', en: 'Cooling Draught' },
    beschreibung: {
      de: 'Ein klarer, kühler Trank aus blauen Blüten und Salatblättern. Kühlt fünf Minuten lang – gegen Hitze und Sonnenglut.',
      en: 'A clear, cool draught of blue blossoms and lettuce leaves. Cools you for five minutes – against heat and blazing sun.',
    },
    kategorie: 'trank',
    essbar: { saettigung: 0, durst: 10 },
    trank: { gibt: [{ id: 'gekuehlt', sekunden: 300 }], heilt: [] },
    tauschwert: 5,
    sounds: { aufheben: ITEM_SFX.trank },
  }),
]);
