/**
 * Items of water (MASTERPROMPT §18 "Wasser: Flüsse und Seen ungefiltert …, Abkochen macht sauber, Regensammler, …
 * Trinkschlauch (5 Schlucke), … geschmolzener Schnee"; docs/SPIEL.md §21 "Wasser", §29; M7-30; strand E).
 *
 * - **Boiled water** `wasser_abgekocht`: a bucket of water boiled at a camp fire or in the cauldron (or snow melted in it) –
 *   the same wooden bucket (`behaelt` its durability), now holding five clean sips (`ladungen`, `BALANCE.water.boiled.sips`).
 *   Drunk from the bags (`player.useItem`, src/game/water): no fever; the last sip leaves the empty bucket. A rain collector tops
 *   it up with clean water.
 * - **Water skin** `trinkschlauch`: a leather skin of five sips (§18 "Trinkschlauch (5 Schlucke)", block `ladungen`), filled at
 *   fresh water (E with the skin in the hand; river and lake water stays unfiltered – each sip may bring a fever like drinking
 *   at the bank) or at a rain collector (clean); drunk from the bags (`player.useItem`). Every filling wears it by one use.
 * - **Rain collector** `regensammler` (furniture with a build part, layer `objekt`): a barrel with a funnel that catches the rain of
 *   the climate log (src/game/water) – clean water to drink at it (E), to fill a skin, a bucket or the boiled bucket.
 * - **Snow** `schnee`: dug from snow with any shovel (`graben:schnee` – the item that declares the source is what digging the
 *   terrain yields, src/game/gathering/rules.ts); four handfuls melt in a bucket at the fire into boiled water.
 * Trade values [trade points, 1 = one log]: the ingredients plus about a fifth for the work.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';
import { moebelGruppe, type MoebelSpec } from './moebel';

/** Tier of water (§13.2 T0). */
const T0 = 0;
/** Durability of the bucket and the skin [uses] (§D: T0 60). */
const DURABILITY = BALANCE.items.durabilityByTier[T0] as number;
/** Tool data of vessels: kind `eimer`, the schema's lowest mining power (they mine nothing). */
const VESSEL = { art: 'eimer', abbaukraft: 1 } as const;

/** Boiled water, the water skin and snow. */
export const WASSER = defineItemGroup('wasser', [
  baseItem({
    id: 'wasser_abgekocht',
    name: { de: 'Abgekochtes Wasser', en: 'Boiled Water' },
    beschreibung: {
      de: 'Ein Holzeimer voll abgekochtem Wasser: fünf saubere Schlucke ohne Fieber. Leer getrunken bleibt der Eimer.',
      en: 'A wooden bucket full of boiled water: five clean sips without fever. Drunk empty, the bucket remains.',
    },
    kategorie: 'werkzeug',
    stufe: T0,
    haltbarkeit: DURABILITY,
    werkzeug: VESSEL,
    ladungen: { max: BALANCE.water.boiled.sips, inhalt: 'wasser', fuellen: ['regensammler'] },
    tauschwert: 19,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: 'sfx_aktion_trinken' },
  }),
  baseItem({
    id: 'trinkschlauch',
    name: { de: 'Trinkschlauch', en: 'Water Skin' },
    beschreibung: {
      de: 'Ein vernähter Lederschlauch für fünf Schlucke. An Fluss, See oder Quelle zu füllen – Fluss- und Seewasser bleibt ungefiltert – oder sauber am Regensammler.',
      en: 'A stitched leather skin for five sips. Fill it at a river, lake or spring – river and lake water stays unfiltered – or clean at a rain collector.',
    },
    kategorie: 'werkzeug',
    stufe: T0,
    haltbarkeit: DURABILITY,
    werkzeug: VESSEL,
    ladungen: { max: BALANCE.water.skin.sips, inhalt: 'wasser', fuellen: ['wasser', 'regensammler'] },
    tauschwert: 16,
    sounds: { aufheben: ITEM_SFX.schlauch, benutzen: 'sfx_aktion_trinken' },
  }),
  baseItem({
    id: 'schnee',
    name: { de: 'Schnee', en: 'Snow' },
    beschreibung: {
      de: 'Eine Handvoll festgetretener Schnee, mit der Schaufel gestochen. Vier Handvoll schmelzen im Eimer am Feuer zu sauberem Wasser.',
      en: 'A handful of packed snow, cut with a shovel. Four handfuls melt in a bucket at the fire into clean water.',
    },
    kategorie: 'rohstoff',
    stufe: T0,
    quellen: ['graben:schnee'],
    tauschwert: 0,
    sounds: { aufheben: ITEM_SFX.erde },
  }),
]);

/** The rain collector (furniture with a build part). */
const SAMMLER_SPECS: readonly MoebelSpec[] = [
  {
    id: 'regensammler',
    stufe: T0,
    name: { de: 'Regensammler', en: 'Rain Collector' },
    beschreibung: {
      de: 'Ein Fass mit breitem Trichter aus Brettern, das den Regen auffängt – unter freiem Himmel, nicht unter einem Dach. Sein Wasser ist sauber: trinken, Schlauch oder Eimer füllen.',
      en: 'A barrel with a wide plank funnel that catches the rain – under the open sky, not under a roof. Its water is clean: drink, fill a skin or a bucket.',
    },
    tauschwert: 17,
    aufheben: ITEM_SFX.holz,
    platz: { art: 'moebel', material: 'holz', kategorie: 'trog' },
  },
];

const SAMMLER = moebelGruppe('wasser_sammler', SAMMLER_SPECS);

/** The rain collector item. */
export const WASSER_SAMMLER_ITEMS = SAMMLER.items;
/** Its build part. */
export const WASSER_BAUTEILE = SAMMLER.teile;
/** Id of the rain collector (item and build part). */
export const RAIN_COLLECTOR = 'regensammler';
