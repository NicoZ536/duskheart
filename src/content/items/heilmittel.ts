/**
 * Early medicine (MASTERPROMPT §11.3 "Knochenbruch (−40 % Tempo bis zur Schiene)", §18 "Schiene"; M4-35): the splint
 * of twigs and fibre rope, made at the workbench (src/content/recipes/basis.ts) before the herb table exists – a
 * fall of three levels breaks a bone from day 1 (§11.4), so its cure cannot wait for M7-28, which counts it to the
 * herb table's series. Used from the bags (`player.useItem`), it sets the bone (`CURES`, src/content/items/
 * grundlagen.ts) and is used up – an end in itself (`endprodukt`).
 *
 * Tier T0; trade value: the ingredients plus about a fifth for the work (like grundlagen.ts).
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** The early medicine. */
export const HEILMITTEL = defineItemGroup('heilmittel', [
  baseItem({
    id: 'schiene',
    name: { de: 'Schiene', en: 'Splint' },
    beschreibung: {
      de: 'Zwei gerade Zweige, mit Faserseil fest um das Glied gebunden. Angelegt richtet sie einen Knochenbruch: das Hinken hört auf.',
      en: 'Two straight twigs bound tightly around the limb with fibre rope. Applied, it sets a broken bone: the limp stops.',
    },
    kategorie: 'medizin',
    stufe: 0,
    endprodukt: true,
    tauschwert: 7,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: ITEM_SFX.holz },
  }),
]);
