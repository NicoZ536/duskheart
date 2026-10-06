/**
 * The fish of M7 (docs/SPIEL.md §29 "Feld & Fang", MASTERPROMPT §14 "Angeln … nach Biom, Tageszeit, Wetter und
 * Jahreszeit", M7-24; collection `fish`, §C "Fischarten"): eight species of the Grünhain waters, the Salt Coast and the
 * frozen lakes. Their raw items and icons live in src/content/items/fang.ts.
 *
 * Who bites where and when: trout in clear running water by day, perch everywhere by day (the common catch), carp and
 * eel in calm or murky water at dusk and night – eels after rain –, pike in lakes, rivers and through the ice, burbot
 * in the cold half of the year and under ice, herring and mackerel in the sea. Fight (`kampf`): perch and herring pull
 * gently and tire fast, pike and mackerel pull hard and leap; the mini-game's balance lives in `BALANCE.fishing`.
 * Fish traps (`reuse`) catch the fish that swim into baskets – not the predators that chase and leap.
 */
import { defineFish, type FishInput } from './schema';

export { defineFish, fishSchema, DAY_PHASES, FISH_WATERS, type DayPhase, type FishDef, type FishInput, type FishWater } from './schema';

const RECORDS: readonly FishInput[] = [
  {
    id: 'forelle',
    biome: ['gruenhain', 'frostkamm'],
    gewaesser: ['fluss'],
    tageszeit: ['tag', 'daemmerung'],
    jahreszeiten: ['fruehling', 'sommer', 'herbst'],
    koeder: ['regenwurm'],
    gewicht: 1,
    kampf: { kraft: 0.55, ausdauer: 9, spruenge: 3 },
    reuse: false,
  },
  {
    id: 'barsch',
    biome: ['gruenhain', 'nebelmoor', 'frostkamm'],
    gewaesser: ['see', 'fluss'],
    tageszeit: ['tag'],
    jahreszeiten: ['fruehling', 'sommer', 'herbst', 'winter'],
    koeder: ['regenwurm'],
    gewicht: 1.4,
    kampf: { kraft: 0.35, ausdauer: 6, spruenge: 1 },
    reuse: true,
  },
  {
    id: 'karpfen',
    biome: ['gruenhain', 'nebelmoor'],
    gewaesser: ['see'],
    tageszeit: ['daemmerung', 'nacht'],
    jahreszeiten: ['fruehling', 'sommer', 'herbst'],
    gewicht: 0.9,
    kampf: { kraft: 0.5, ausdauer: 14, spruenge: 0.5 },
    reuse: true,
  },
  {
    id: 'hecht',
    biome: ['gruenhain', 'nebelmoor', 'frostkamm'],
    gewaesser: ['see', 'fluss', 'eis'],
    tageszeit: ['tag', 'daemmerung'],
    jahreszeiten: ['fruehling', 'sommer', 'herbst', 'winter'],
    gewicht: 0.4,
    kampf: { kraft: 0.8, ausdauer: 16, spruenge: 2 },
    reuse: false,
  },
  {
    id: 'aal',
    biome: ['gruenhain', 'nebelmoor', 'salzkueste'],
    gewaesser: ['fluss', 'see'],
    tageszeit: ['nacht'],
    jahreszeiten: ['sommer', 'herbst'],
    wetter: ['niesel', 'regen', 'gewitter', 'bewoelkt', 'nebel'],
    koeder: ['regenwurm'],
    gewicht: 0.7,
    kampf: { kraft: 0.6, ausdauer: 12, spruenge: 0 },
    reuse: true,
  },
  {
    id: 'quappe',
    biome: ['gruenhain', 'frostkamm', 'nebelmoor'],
    gewaesser: ['fluss', 'see', 'eis'],
    tageszeit: ['daemmerung', 'nacht'],
    jahreszeiten: ['herbst', 'winter'],
    gewicht: 0.8,
    kampf: { kraft: 0.4, ausdauer: 10, spruenge: 0 },
    reuse: true,
  },
  {
    id: 'hering',
    biome: ['salzkueste'],
    gewaesser: ['meer'],
    tageszeit: ['tag', 'daemmerung'],
    jahreszeiten: ['fruehling', 'sommer', 'herbst', 'winter'],
    gewicht: 1.4,
    kampf: { kraft: 0.3, ausdauer: 5, spruenge: 1 },
    reuse: true,
  },
  {
    id: 'makrele',
    biome: ['salzkueste'],
    gewaesser: ['meer'],
    tageszeit: ['tag'],
    jahreszeiten: ['sommer', 'herbst'],
    gewicht: 0.8,
    kampf: { kraft: 0.65, ausdauer: 10, spruenge: 4 },
    reuse: false,
  },
];

/** Fish 1–8 (M7-24). */
export const FISH = defineFish(RECORDS);
