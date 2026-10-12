/**
 * Further statistics of the chronicle (M7-106; MASTERPROMPT §23.3 "Statistiken"; docs/SPIEL.md §23 "Statistiken", ADR-0263:
 * a source only for a canonical §29 id – these ids are added to §29 with this file). The proposals of the strands (docs/
 * M7-STRAENGE.md "Übergaben an Welle 2": the kitchen's `verdorben` and `gegessen`, the places, world events, bosses, travel,
 * shards and unlocks of wave 1), each from an event that exists, counted by the observer `stats` like the 16 of `kern.ts`:
 *
 * - **Kitchen** (strand E): `gegessen` – every piece eaten (`mealEaten`, the eat hook's event for every piece, by item);
 *   `verdorben` – what spoiled to `verdorbenes` in the bags and containers (`foodSpoiled`, its `count`, by item).
 * - **Places** (strand B): `orte_gereinigt` – a place whose last guard fell (`placeCleansed`, by place type; the glossary's
 *   "gereinigt"); `ortstruhen_geoeffnet` – a chest of a place opened (`placeChestOpened`, by place type); `tuerme_bestiegen`
 *   (`towerClimbed`); `segen_empfangen` – a shrine's blessing (`shrineBlessed`, by condition); `buddelfunde` – a dig site's cache
 *   brought up (`placeDugUp`).
 * - **World** (strand B): `weltereignisse_erlebt` – a world event began in the player's world (`worldEventStarted`, by event);
 *   `blitzbraende` – lightning that set something alight (`lightningStruck` with `entzuendet`); `meteore` – a meteor's impact
 *   (`meteorImpact`); `kartenmarker` – an own marker set on the map (`mapMarked`).
 * - **Bosses** (strand F): `boss_kampfzeit` – the length of every won boss fight (`bossDefeated`, its `dauerTicks`, by boss;
 *   unit ticks, shown as play time); `boss_niederlagen` – a boss fight lost by dying (`bossReset` with `grund: 'tod'`, by boss).
 * - **Travel, shards, unlocks** (strand F): `schnellreisen` – every fast travel (`travelled`, by the kind of the destination);
 *   `reise_lumen` – the Lumen it cost (`travelled`, its `kosten`); `splitter_benutzt` – a heart or ember shard used (`shardUsed`,
 *   by kind); `freischaltungen` – every unlock granted (`unlockGranted`).
 */
import type { StatInput, StatSourceInput } from './schema';

/** The statistics of M7-106 (in the order the chronicle lists them, after the 16 of §29 core). */
export const STATS_M7_106: readonly StatInput[] = [
  { id: 'gegessen', name: { de: 'Gegessen', en: 'Eaten' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'verdorben', name: { de: 'Verdorbene Vorräte', en: 'Food spoiled' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'orte_gereinigt', name: { de: 'Orte gereinigt', en: 'Places cleansed' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'ortstruhen_geoeffnet', name: { de: 'Truhen an Orten geöffnet', en: 'Place chests opened' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'tuerme_bestiegen', name: { de: 'Türme bestiegen', en: 'Towers climbed' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'segen_empfangen', name: { de: 'Segen empfangen', en: 'Blessings received' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'buddelfunde', name: { de: 'Buddelfunde', en: 'Dig finds' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'weltereignisse_erlebt', name: { de: 'Weltereignisse erlebt', en: 'World events witnessed' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'blitzbraende', name: { de: 'Brände durch Blitze', en: 'Fires from lightning' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'meteore', name: { de: 'Meteoriteneinschläge', en: 'Meteor impacts' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'kartenmarker', name: { de: 'Kartenmarker gesetzt', en: 'Map markers placed' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'boss_kampfzeit', name: { de: 'Zeit im Bosskampf', en: 'Time in boss fights' }, einheit: 'ticks', geschluesselt: true },
  { id: 'boss_niederlagen', name: { de: 'Niederlagen gegen Bosse', en: 'Defeats by bosses' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'schnellreisen', name: { de: 'Schnellreisen', en: 'Fast travels' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'reise_lumen', name: { de: 'Lumen für Reisen', en: 'Lumen spent travelling' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'splitter_benutzt', name: { de: 'Splitter benutzt', en: 'Shards used' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'freischaltungen', name: { de: 'Freischaltungen', en: 'Unlocks' }, einheit: 'anzahl', geschluesselt: false },
];

/** Event → statistic of M7-106 (one source each; the payload fields as the events carry them). */
export const STAT_SOURCES_M7_106: readonly StatSourceInput[] = [
  { id: 'gegessen_stueck', statistik: 'gegessen', ereignis: 'mealEaten', schluessel: 'item' },
  { id: 'verdorben_vorrat', statistik: 'verdorben', ereignis: 'foodSpoiled', schluessel: 'item', wert: 'count' },
  { id: 'orte_gereinigt_typ', statistik: 'orte_gereinigt', ereignis: 'placeCleansed', schluessel: 'ortstyp' },
  { id: 'ortstruhen_typ', statistik: 'ortstruhen_geoeffnet', ereignis: 'placeChestOpened', schluessel: 'ortstyp' },
  { id: 'tuerme_turm', statistik: 'tuerme_bestiegen', ereignis: 'towerClimbed' },
  { id: 'segen_schrein', statistik: 'segen_empfangen', ereignis: 'shrineBlessed', schluessel: 'zustand' },
  { id: 'buddelfunde_stelle', statistik: 'buddelfunde', ereignis: 'placeDugUp' },
  { id: 'weltereignisse_beginn', statistik: 'weltereignisse_erlebt', ereignis: 'worldEventStarted', schluessel: 'event' },
  { id: 'blitzbraende_zuendung', statistik: 'blitzbraende', ereignis: 'lightningStruck', wo: { entzuendet: true } },
  { id: 'meteore_einschlag', statistik: 'meteore', ereignis: 'meteorImpact' },
  { id: 'kartenmarker_eigen', statistik: 'kartenmarker', ereignis: 'mapMarked' },
  { id: 'boss_kampfzeit_sieg', statistik: 'boss_kampfzeit', ereignis: 'bossDefeated', schluessel: 'boss', wert: 'dauerTicks' },
  { id: 'boss_niederlagen_tod', statistik: 'boss_niederlagen', ereignis: 'bossReset', wo: { grund: 'tod' }, schluessel: 'boss' },
  { id: 'schnellreisen_ziel', statistik: 'schnellreisen', ereignis: 'travelled', schluessel: 'kind' },
  { id: 'reise_lumen_kosten', statistik: 'reise_lumen', ereignis: 'travelled', wert: 'kosten' },
  { id: 'splitter_art', statistik: 'splitter_benutzt', ereignis: 'shardUsed', schluessel: 'art' },
  { id: 'freischaltungen_quelle', statistik: 'freischaltungen', ereignis: 'unlockGranted' },
];
