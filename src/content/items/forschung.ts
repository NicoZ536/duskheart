/**
 * Items of research and maps (MASTERPROMPT §15.1 "Baupläne (Dungeons, Händlerin, Tafeln), … Forschungspult (Relikte studieren)",
 * §15.2 "Kartentisch · Forschungspult", §25 "Karte"; docs/SPIEL.md §19 "Forschungspult", "Kartentisch", §29 `bauplan_<ziel>`,
 * `ortskarte_<ortstyp>`; M7-16, M7-18; strand C):
 *
 * - **Schematics** (`bauplan_<ziel>`, `bauplan` block): used, they grant an unlock (`unlocks`, rows `bp_<ziel>`,
 *   src/content/dungeons/freischaltungen.ts) – the map table, the councillors' amulet, the mechanics' ring. They come from
 *   studying a relic at the research desk, the ring's also from a vault's richest chests.
 * - **What they unlock:** the councillors' amulet (+10 maximum stamina, fear resistance) and the mechanics' ring (+10 maximum
 *   health) – jewellery of the Builders (§13.1 "Schmuck"), stronger than the hunting trophies, below what later beacons teach.
 * - **Place maps** (`ortskarte_<ortstyp>`, `ortskarte` block): drawn at the map table; used, they reveal the nearest
 *   undiscovered place of their type (`PlacesApi.reveal`, source `kartentisch`).
 * Trade values [trade points, 1 = one piece of wood]: a schematic is worth its relic; a map its cloth and charcoal and the
 * knowledge.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

const T1 = 1;

/** A schematic granting the unlock `bp_<ziel>`. */
function bauplan(ziel: string, de: string, en: string, beschreibung: { de: string; en: string }) {
  return baseItem({
    id: `bauplan_${ziel}`,
    name: { de: `Bauplan: ${de}`, en: `Schematic: ${en}` },
    beschreibung,
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'selten',
    // Used up by `player.useItem` (src/game/research/): the unlock stays – an end in itself.
    endprodukt: true,
    tauschwert: 60,
    bauplan: { freischaltung: `bp_${ziel}` },
    sounds: { aufheben: ITEM_SFX.pflanze, benutzen: 'sfx_forschung_bauplan' },
  });
}

/** A map of the nearest undiscovered place of `ortstyp`. */
function ortskarte(ortstyp: string, de: string, en: string) {
  return baseItem({
    id: `ortskarte_${ortstyp}`,
    name: { de: `Karte: ${de}`, en: `Map: ${en}` },
    beschreibung: {
      de: `Eine am Kartentisch gezeichnete Karte. Benutzt, trägt sie den nächsten unentdeckten Ort dieser Art in deine Karte ein: ${de}.`,
      en: `A map drawn at the map table. Used, it marks the nearest undiscovered place of its kind on your map: ${en}.`,
    },
    kategorie: 'rohstoff',
    stufe: T1,
    raritaet: 'ungewoehnlich',
    endprodukt: true,
    tauschwert: 12,
    ortskarte: { ortstyp },
    sounds: { aufheben: ITEM_SFX.pflanze, benutzen: 'sfx_forschung_karte' },
  });
}

export const FORSCHUNG_ITEMS = defineItemGroup('forschung', [
  bauplan('kartentisch', 'Kartentisch', 'Map Table', {
    de: 'Die Zeichnung eines Tisches mit eingelassenem Kompass. Benutzt, kannst du einen Kartentisch bauen und an ihm Karten zu Orten zeichnen.',
    en: 'The drawing of a table with an inlaid compass. Used, it lets you build a map table and draw maps to places at it.',
  }),
  bauplan('erbauer_amulett', 'Ratsamulett', 'Councillor’s Amulet', {
    de: 'Wie die Räte der Erbauer ihr Amulett gossen: Bronze um eine Lumen-Perle. Benutzt, kannst du es am Bronzeamboss fertigen.',
    en: 'How the Builders’ councillors cast their amulet: bronze around a Lumen pearl. Used, it lets you make it at the bronze anvil.',
  }),
  bauplan('erbauer_ring', 'Mechanikerring', 'Mechanic’s Ring', {
    de: 'Der Ring der Mechaniker, Zahn um Zahn gezeichnet. Benutzt, kannst du ihn am Bronzeamboss fertigen.',
    en: 'The mechanics’ ring, drawn tooth by tooth. Used, it lets you make it at the bronze anvil.',
  }),
  baseItem({
    id: 'erbauer_amulett',
    name: { de: 'Ratsamulett', en: 'Councillor’s Amulet' },
    beschreibung: {
      de: 'Ein Amulett der Erbauer-Räte mit einer Lumen-Perle. Ihr Glimmen stärkt den Atem und beruhigt in der Dunkelheit.',
      en: 'An amulet of the Builders’ councillors with a Lumen pearl. Its glimmer strengthens the breath and calms in the dark.',
    },
    kategorie: 'schmuck',
    stufe: T1,
    raritaet: 'selten',
    ausruestung: 'schmuck',
    werte: { maxAusdauer: 10, furchtresistenz: 0.1 },
    tauschwert: 70,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  baseItem({
    id: 'erbauer_ring',
    name: { de: 'Mechanikerring', en: 'Mechanic’s Ring' },
    beschreibung: {
      de: 'Ein Ring aus ineinandergreifenden Bronzezähnen, der sich nie verklemmt. Wer ihn trägt, hält mehr aus.',
      en: 'A ring of interlocking bronze teeth that never jams. Whoever wears it endures more.',
    },
    kategorie: 'schmuck',
    stufe: T1,
    raritaet: 'selten',
    ausruestung: 'schmuck',
    werte: { maxLeben: 10 },
    tauschwert: 60,
    sounds: { aufheben: ITEM_SFX.erz },
  }),
  ortskarte('gewoelbe', 'Erbauer-Gewölbe', 'Builder Vault'),
  ortskarte('aussichtsturm', 'Aussichtsturm', 'Lookout Tower'),
  ortskarte('schrein', 'Schrein', 'Shrine'),
  ortskarte('friedhof', 'Friedhof der Erbauer', 'Builder Graveyard'),
]);
