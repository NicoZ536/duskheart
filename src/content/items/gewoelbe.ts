/**
 * Items of the Builder vaults (MASTERPROMPT §21 "Belohnungen: einzigartige Baupläne, Relikte (Forschungspult), Truhen nach Stufe,
 * Erbauer-Tafeln, Glutsplitter (+5 max. Ausdauer; 12 in der Welt)", §20.1 "Dungeon-Spezial"; docs/SPIEL.md §19, §29; M7-10,
 * M7-15, M7-16; strand C):
 *
 * - `gewoelbeschluessel` – a vault key from a key pedestal; it knows its vault (`daten.gewoelbe` = the slot) and opens one
 *   locked door there (src/game/vaults/); elsewhere it is a cold piece of bronze.
 * - `glutsplitter` – an ember shard on a pedestal deep in a vault (12 in the world); used, it passes into the player for good:
 *   +5 maximum stamina (`splitter` block, src/game/shards/, strand F).
 * - Relics (`relikt_<name>`, found in tier-3 and end chests) – studied at the research desk they become a schematic
 *   (src/content/recipes/forschung.ts): the Builders' compass, their council seal, a geared wheel of their machines.
 * - `essenz_wurzelhueter` – the essence the Root Warden leaves; the rune altar binds essences (M8-45).
 * Trade values [trade points, 1 = one piece of wood]: a relic is a find for one vault, a shard is priceless.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** The vault's source of declared items (key and shard lie on pedestals, not in loot tables). */
const FROM_VAULT = 'gewoelbe:gruenhain';
const T1 = 1;

export const GEWOELBE_ITEMS = defineItemGroup('gewoelbe', [
  baseItem({
    id: 'gewoelbeschluessel',
    name: { de: 'Gewölbeschlüssel', en: 'Vault Key' },
    beschreibung: {
      de: 'Ein schwerer Bronzeschlüssel mit dem Zeichen eines Gewölbes. Er öffnet ein verschlossenes Tor in genau diesem Gewölbe.',
      en: 'A heavy bronze key bearing the mark of a vault. It opens one locked gate in that very vault.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'ungewoehnlich',
    // Used at a locked gate of its vault (E, src/game/vaults/) – an end in itself, no recipe asks for it.
    endprodukt: true,
    tauschwert: 0,
    quellen: [FROM_VAULT],
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'glutsplitter',
    name: { de: 'Glutsplitter', en: 'Ember Shard' },
    beschreibung: {
      de: 'Ein Splitter, in dem eine winzige Glut wohnt. Benutzt, geht er in dich über: dauerhaft 5 Ausdauer mehr. Zwölf liegen in den Gewölben der Welt.',
      en: 'A shard where a tiny ember dwells. Used, it passes into you: 5 more maximum stamina for good. Twelve lie in the vaults of the world.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'legendaer',
    // Used up for good by `player.useItem` (src/game/shards/) – like the heart shard an end in itself.
    endprodukt: true,
    tauschwert: 120,
    quellen: [FROM_VAULT],
    splitter: { art: 'glut' },
    sounds: { aufheben: ITEM_SFX.lumen, benutzen: 'sfx_gewoelbe_glutsplitter' },
  }),
  baseItem({
    id: 'relikt_kompass',
    name: { de: 'Erbauer-Kompass', en: 'Builder Compass' },
    beschreibung: {
      de: 'Ein Kompass ohne Norden: seine Nadel zeigt auf die Orte der Erbauer. Am Forschungspult studiert, verrät er, wie man ihre Karten zeichnet.',
      en: 'A compass without north: its needle points to the places of the Builders. Studied at the research desk, it reveals how their maps were drawn.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'selten',
    tauschwert: 60,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'relikt_siegel',
    name: { de: 'Ratssiegel', en: 'Council Seal' },
    beschreibung: {
      de: 'Das Siegel des Rates der Erbauer, in Bronze gegossen, mit einer Lumen-Perle im Herzen. Am Forschungspult studiert, zeigt es, wie das Amulett der Räte gefertigt wurde.',
      en: 'The seal of the Builders’ council, cast in bronze with a Lumen pearl at its heart. Studied at the research desk, it shows how the councillors’ amulet was made.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'selten',
    tauschwert: 60,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'relikt_zahnrad',
    name: { de: 'Erbauer-Zahnrad', en: 'Builder Cogwheel' },
    beschreibung: {
      de: 'Ein Zahnrad aus einer Maschine, die niemand mehr kennt, ohne einen Hauch Rost. Am Forschungspult studiert, verrät es den Ring der Mechaniker.',
      en: 'A cogwheel from a machine nobody remembers, without a trace of rust. Studied at the research desk, it reveals the mechanics’ ring.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'selten',
    tauschwert: 60,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'essenz_wurzelhueter',
    name: { de: 'Essenz des Wurzelhüters', en: 'Root Warden Essence' },
    beschreibung: {
      de: 'Ein Tropfen grünes Licht, der sich wie Saft bewegt. Was den Wurzelhüter belebte, wartet auf einen Runenaltar.',
      en: 'A drop of green light that moves like sap. Whatever animated the Root Warden waits for a rune altar.',
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'episch',
    tauschwert: 70,
    sounds: { aufheben: ITEM_SFX.lumen },
  }),
]);
