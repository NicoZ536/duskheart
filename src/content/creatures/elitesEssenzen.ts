/**
 * The essences of the elites (docs/SPIEL.md §26 "Essenz-Drops `essenz_graufang`, `essenz_alter_hauer` (Verwendung M8-45,
 * geplant)"; M7-17, strand I): what Graufang and the Old Tusker always leave (their loot tables, src/content/creatures/
 * elites.ts; source `drop:<elite>`). The rune altar of M8-45 binds them (tools/validator/verwendungen-geplant.ts). Trade
 * value like the Root Warden's essence – a fight with an elite, a week's rest before the next.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from '../items/define';

/** Tier of the elites (their loot's tier). */
const T1 = 1;

/** The two essences. */
export const ELITE_ESSENZEN = defineItemGroup('elite_essenzen', [
  baseItem({
    id: 'essenz_graufang',
    name: { de: 'Essenz des Graufangs', en: 'Greyfang Essence' },
    beschreibung: {
      de: 'Ein silbriger Nebel in einem Splitter Bernstein, der sich nachts regt wie ein Wolf im Schlaf. Was den Leitwolf antrieb, wartet auf einen Runenaltar.',
      en: 'A silvery mist in a shard of amber that stirs at night like a sleeping wolf. Whatever drove the lead wolf waits for a rune altar.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'episch',
    tauschwert: 70,
    sounds: { aufheben: ITEM_SFX.lumen },
  }),
  baseItem({
    id: 'essenz_alter_hauer',
    name: { de: 'Essenz des Alten Hauers', en: 'Old Tusker Essence' },
    beschreibung: {
      de: 'Ein schwerer, erdbrauner Tropfen, warm wie aufgewühlter Waldboden. Was den alten Keiler zäh machte, wartet auf einen Runenaltar.',
      en: 'A heavy, earth-brown drop, warm as churned forest soil. Whatever made the old boar so tough waits for a rune altar.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'episch',
    tauschwert: 70,
    sounds: { aufheben: ITEM_SFX.lumen },
  }),
]);
