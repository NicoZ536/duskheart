/**
 * The statistics of docs/SPIEL.md §29, their sources from the events up to M6 and of the strands of wave 1, and the
 * milestones of the pacing measurement (MASTERPROMPT §23.1 "Pacing-Ziel … Leuchtfeuer 1 nach ~3 h", §23.3 "Statistiken",
 * §D "Pacing … gemessen per Debug-Statistik"; docs/SPIEL.md §23; M7-47, M7-64, M7-72 – strand G).
 *
 * - Counted by the `stats` system itself (no source): `spielzeit` (ticks of play, sleep at its real pace) and `distanz`
 *   (tiles walked).
 * - Sources of wave 1 (docs/M7-STRAENGE.md "Übergaben an Welle 2", M7-72): `geerntet` from the harvested crop (D), `gefangen`
 *   from caught fish, emptied fish traps and the net (D, A), `orte_entdeckt` (B), `bosse_besiegt` and
 *   `leuchtfeuer_entzuendet` (F). `gekocht` counts the experience of a cooked dish (`gericht_gekocht`, the kitchen stations of
 *   strand E give it). The vault (`gewoelbe_abgeschlossen`, `raetsel_geloest`) adds its sources in its own file when its
 *   events exist (strand C).
 * - The killer filter `@spieler` counts a creature only when the player killed it (src/game/triggers/compile.ts).
 */
import type { MilestoneInput, StatInput, StatSourceInput } from './schema';

/** The 16 statistics of docs/SPIEL.md §29. */
export const STATS_G: readonly StatInput[] = [
  { id: 'spielzeit', name: { de: 'Spielzeit', en: 'Time played' }, einheit: 'ticks', geschluesselt: false },
  { id: 'tage', name: { de: 'Erlebte Tage', en: 'Days seen' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'naechte_ueberlebt', name: { de: 'Überlebte Nächte', en: 'Nights survived' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'tode', name: { de: 'Tode', en: 'Deaths' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'kills', name: { de: 'Besiegte Kreaturen', en: 'Creatures defeated' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'hergestellt', name: { de: 'Hergestellt', en: 'Crafted' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'gesammelt', name: { de: 'Pflanzen gesammelt', en: 'Plants gathered' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'geerntet', name: { de: 'Ernten', en: 'Harvests' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'gefangen', name: { de: 'Gefangen', en: 'Caught' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'gekocht', name: { de: 'Gekocht', en: 'Cooked' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'orte_entdeckt', name: { de: 'Orte entdeckt', en: 'Places discovered' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'gewoelbe_abgeschlossen', name: { de: 'Gewölbe bezwungen', en: 'Vaults conquered' }, einheit: 'anzahl', geschluesselt: false },
  { id: 'raetsel_geloest', name: { de: 'Rätsel gelöst', en: 'Puzzles solved' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'bosse_besiegt', name: { de: 'Bosse besiegt', en: 'Bosses defeated' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'leuchtfeuer_entzuendet', name: { de: 'Leuchtfeuer entzündet', en: 'Beacons lit' }, einheit: 'anzahl', geschluesselt: true },
  { id: 'distanz', name: { de: 'Zurückgelegte Strecke', en: 'Distance walked' }, einheit: 'kacheln', geschluesselt: false },
];

/** Event → statistic (M3–M6 events and the sources of wave 1). */
export const STAT_SOURCES_G: readonly StatSourceInput[] = [
  { id: 'tage_morgen', statistik: 'tage', ereignis: 'dailyTick' },
  // Every morning the player lives to see gives the experience `nacht_ueberstanden` (§23.2, src/game/skills/system.ts).
  { id: 'naechte_morgen', statistik: 'naechte_ueberlebt', ereignis: 'xpGained', wo: { source: 'nacht_ueberstanden' } },
  { id: 'tode_spieler', statistik: 'tode', ereignis: 'playerDied' },
  { id: 'kills_kreatur', statistik: 'kills', ereignis: 'creatureDied', wo: { by: '@spieler' }, schluessel: 'creature' },
  { id: 'hergestellt_item', statistik: 'hergestellt', ereignis: 'craftCompleted', schluessel: 'item', wert: 'count' },
  // What a processing station makes (the furnace's bars, the kiln's bricks) is made too – the bronze of the quest `bronzezeit`
  // and the milestone `m_bronze` comes out of the furnace (M7-64).
  { id: 'hergestellt_station', statistik: 'hergestellt', ereignis: 'stationProduced', schluessel: 'item', wert: 'count' },
  { id: 'gesammelt_pflanze', statistik: 'gesammelt', ereignis: 'harvested', wo: { xp: 'pflanze_gesammelt' }, schluessel: 'target' },
  { id: 'gesammelt_kraut', statistik: 'gesammelt', ereignis: 'harvested', wo: { xp: 'kraut_gesammelt' }, schluessel: 'target' },
  // A dish cooked at a kitchen station gives the experience `gericht_gekocht` (the station's `erfahrung`, src/game/crafting).
  { id: 'gekocht_gericht', statistik: 'gekocht', ereignis: 'xpGained', wo: { source: 'gericht_gekocht' } },
  // Wave 1 (M7-72): field and fishing (D), the net (A), places (B), bosses and beacons (F).
  { id: 'geerntet_frucht', statistik: 'geerntet', ereignis: 'cropHarvested', schluessel: 'crop' },
  { id: 'gefangen_angel', statistik: 'gefangen', ereignis: 'fishCaught', schluessel: 'fish' },
  // The fish trap counts when it is emptied (its catch is unknown per fish there; D: "die Reuse zählt beim Leeren").
  { id: 'gefangen_reuse', statistik: 'gefangen', ereignis: 'fishTrapEmptied', wert: 'anzahl' },
  { id: 'gefangen_netz_gluehwuermchen', statistik: 'gefangen', ereignis: 'netSwung', wo: { fang: 'gluehwuermchen' }, schluessel: 'fang' },
  { id: 'gefangen_netz_grille', statistik: 'gefangen', ereignis: 'netSwung', wo: { fang: 'grille' }, schluessel: 'fang' },
  { id: 'orte_entdeckt_typ', statistik: 'orte_entdeckt', ereignis: 'placeDiscovered', schluessel: 'ortstyp' },
  { id: 'bosse_besiegt_boss', statistik: 'bosse_besiegt', ereignis: 'bossDefeated', schluessel: 'boss' },
  { id: 'leuchtfeuer_biom', statistik: 'leuchtfeuer_entzuendet', ereignis: 'beaconLit', schluessel: 'biome' },
];

/** The first tick of each step of the way to the first beacon (pacing, docs/BALANCE.md; §23.1 "Leuchtfeuer 1 nach ~3 h"). */
export const MILESTONES_G: readonly MilestoneInput[] = [
  { id: 'm_steinaxt', name: { de: 'Erste Steinaxt', en: 'First stone axe' }, ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'steinaxt', mindestens: 1 } },
  { id: 'm_lagerfeuer', name: { de: 'Erstes Lagerfeuer', en: 'First camp fire' }, ausloeser: { art: 'ereignis', ereignis: 'lightIgnited', wo: { kind: 'lagerfeuer' } } },
  { id: 'm_erste_nacht', name: { de: 'Erste Nacht überlebt', en: 'First night survived' }, ausloeser: { art: 'statistik', statistik: 'naechte_ueberlebt', mindestens: 1 } },
  { id: 'm_werkbank', name: { de: 'Erste Werkbank', en: 'First workbench' }, ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'werkbank', mindestens: 1 } },
  { id: 'm_bronze', name: { de: 'Erste Bronze', en: 'First bronze' }, ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzebarren', mindestens: 1 } },
  { id: 'm_erster_ort', name: { de: 'Erster Ort entdeckt', en: 'First place discovered' }, ausloeser: { art: 'statistik', statistik: 'orte_entdeckt', mindestens: 1 } },
  { id: 'm_staette', name: { de: 'Stätte des Grünhains gefunden', en: 'Greengrove site found' }, ausloeser: { art: 'ort', ortstyp: 'leuchtfeuer' } },
  { id: 'm_erste_ernte', name: { de: 'Erste Ernte', en: 'First harvest' }, ausloeser: { art: 'statistik', statistik: 'geerntet', mindestens: 1 } },
  { id: 'm_erster_fisch', name: { de: 'Erster Fisch', en: 'First fish' }, ausloeser: { art: 'statistik', statistik: 'gefangen', mindestens: 1 } },
  { id: 'm_borkenvater', name: { de: 'Borkenvater besiegt', en: 'Barkfather defeated' }, ausloeser: { art: 'ereignis', ereignis: 'bossDefeated', wo: { boss: 'borkenvater' } } },
  {
    id: 'm_lf1',
    name: { de: 'Leuchtfeuer 1 entzündet', en: 'Beacon 1 lit' },
    ausloeser: { art: 'ereignis', ereignis: 'beaconLit', wo: { beacon: 1 } },
    // §23.1 "Pacing-Ziel (Normal, durchschnittlicher Spieler): Leuchtfeuer 1 nach ~3 h".
    zielStunden: 3,
  },
];
