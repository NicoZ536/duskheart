/**
 * The unlock registry (MASTERPROMPT §23.1 "Leuchtfeuer-Wissen & Pacing": what each beacon teaches, "+ jeweils ein Glutkern für
 * das Herdfeuer"; docs/SPIEL.md §22 "Freischaltungen"; strand F, collection `unlocks`; M7-36): every row of the table, each
 * either playable (`umgesetzt: true`) or naming the task that builds it. A beacon grants its rows when it is lit
 * (src/game/beacons/), blueprints (C) and research grant theirs; recipes wait for theirs (`freischaltung`).
 *
 * | Beacon | Unlocks (+ ember core) |
 * |---|---|
 * | 1 Grünhain | Lumen workbench (station), Lumen lantern (light), waystones (build part) – M7-36 |
 * | 2 Nebelmoor | canoe (M8-35), Alchemy II (M8-49), rune altar (M8-45) |
 * | 3 Frostkamm | water wheel, wind wheel, Lumen network I (M11-14), lightning rod (M8-46) |
 * | 4 Glutsand | lens grinder, light watch, telescope (M10-23), sun lens (M11-14) |
 * | 5 Aschenschlund | ember generator, conveyor belts, grabber arms, sorters (M11-14) |
 * | 6 Scherbenhain | prism workbench, six-fold flame (M12-13), Lumen core (M11-14) |
 */
import type { UnlockInput } from './schema';

/** A playable row of beacon 1. */
const lf1 = (ziel: string, art: UnlockInput['art'], de: string, en: string, id: string = `lf1_${ziel}`): UnlockInput => ({ id, leuchtfeuer: 1, art, ziel, name: { de, en }, umgesetzt: true });
/** A row a later task builds. */
const later = (n: 2 | 3 | 4 | 5 | 6, ziel: string, art: UnlockInput['art'], de: string, en: string, task: string): UnlockInput => ({ id: `lf${n}_${ziel}`, leuchtfeuer: n, art, ziel, name: { de, en }, umgesetzt: { task } });

/** Every row of §23.1. */
export const UNLOCKS: readonly UnlockInput[] = [
  // Leuchtfeuer 1 – Grünhain (M7-36).
  lf1('lumen_werkbank', 'station', 'Lumen-Werkbank', 'Lumen Workbench'),
  lf1('lumen_laterne', 'licht', 'Lumen-Laterne', 'Lumen Lantern'),
  lf1('wegstein', 'bauteil', 'Wegsteine', 'Waystones', 'lf1_wegsteine'),
  lf1('glutkern_1', 'item', 'Glutkern des Grünhains', 'Greengrove Ember Core', 'lf1_glutkern'),
  // Leuchtfeuer 2 – Nebelmoor (M8-44).
  later(2, 'kanu', 'bauteil', 'Kanu', 'Canoe', 'M8-35'),
  later(2, 'alchemie_2', 'mechanik', 'Alchemie II', 'Alchemy II', 'M8-49'),
  later(2, 'runenaltar', 'station', 'Runenaltar', 'Rune Altar', 'M8-45'),
  later(2, 'glutkern', 'item', 'Glutkern des Nebelmoors', 'Mistmoor Ember Core', 'M8-44'),
  // Leuchtfeuer 3 – Frostkamm (M8-46; the network parts are wired in M11-14).
  later(3, 'wasserrad', 'bauteil', 'Wasserrad', 'Water Wheel', 'M11-14'),
  later(3, 'windrad', 'bauteil', 'Windrad', 'Wind Wheel', 'M11-14'),
  later(3, 'lumen_netz_1', 'mechanik', 'Lumen-Netz I', 'Lumen Network I', 'M11-14'),
  later(3, 'blitzableiter', 'bauteil', 'Blitzableiter', 'Lightning Rod', 'M8-46'),
  later(3, 'glutkern', 'item', 'Glutkern des Frostkamms', 'Frostcomb Ember Core', 'M8-46'),
  // Leuchtfeuer 4 – Glutsand (M10-23).
  later(4, 'linsenschleifer', 'station', 'Linsenschleifer', 'Lens Grinder', 'M10-23'),
  later(4, 'lichtwacht', 'bauteil', 'Lichtwacht', 'Light Watch', 'M10-23'),
  later(4, 'fernrohr', 'item', 'Fernrohr', 'Telescope', 'M10-23'),
  later(4, 'sonnenlinse', 'bauteil', 'Sonnenlinse', 'Sun Lens', 'M11-14'),
  later(4, 'glutkern', 'item', 'Glutkern des Glutsands', 'Embersand Ember Core', 'M10-23'),
  // Leuchtfeuer 5 – Aschenschlund (M10-24; the machines are wired in M11-14).
  later(5, 'glutgenerator', 'bauteil', 'Glutgenerator', 'Ember Generator', 'M11-14'),
  later(5, 'foerderbaender', 'bauteil', 'Förderbänder', 'Conveyor Belts', 'M11-14'),
  later(5, 'greifarme', 'bauteil', 'Greifarme', 'Grabber Arms', 'M11-14'),
  later(5, 'sortierer', 'bauteil', 'Sortierer', 'Sorters', 'M11-14'),
  later(5, 'glutkern', 'item', 'Glutkern des Aschenschlunds', 'Ashmaw Ember Core', 'M10-24'),
  // Leuchtfeuer 6 – Scherbenhain (M12-13; the Lumen core in M11-14).
  later(6, 'prismenwerkbank', 'station', 'Prismenwerkbank', 'Prism Workbench', 'M12-13'),
  later(6, 'lumen_kern', 'bauteil', 'Lumen-Kern', 'Lumen Core', 'M11-14'),
  later(6, 'sechsfach_flamme', 'item', 'Sechsfach-Flamme', 'Six-fold Flame', 'M12-13'),
  later(6, 'glutkern', 'item', 'Glutkern des Scherbenhains', 'Shardgrove Ember Core', 'M12-13'),
];

export * from './schema';
