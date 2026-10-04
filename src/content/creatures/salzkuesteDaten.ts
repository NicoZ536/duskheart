/**
 * AI profiles, loot tables and the spawn table of the Salt Coast creatures (salzkueste.ts; MASTERPROMPT §19.4, §14
 * "Jagen & Zerlegen", §D "Ökonomie", §31.4 "Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten"; M6-23, M6-24).
 *
 * **Profiles** (docs/SPIEL.md §11 "KI"):
 * - `krabbe` – defiant small game: scuttles off at three tiles, pinches back when struck and cornered.
 * - `moewe` – a flier: shy, lifts off at five tiles; struck while it still has courage, it pecks back once.
 * - `robbe` – defiant: flees towards the water early, bites what corners it until its courage runs out.
 * - `scherenkrebs` – territorial: holds its rock, attacks whoever comes within four tiles of it, never strays far.
 * - `qualle` – territorial drifter: blind and slow, stings what comes within two tiles of where it drifts.
 * - `strandraeuber` – aggressive pack of two: sees far at dusk, flanks its prey (one strikes, one circles), breaks doors,
 *   gives up when badly hurt (they are people still).
 *
 * **Loot** (§14, §D): animals leave a carcass and no direct loot – crab and lobster raw crab meat, the gull fowl and many
 * feathers, the seal much fat (a fuel like resinous wood) with hide, bones and sinew. The jellyfish leaves nothing
 * (`ohneBeute`). The raiders leave one or two pieces of what a beachcomber carries – flint, fibre rope, salt, driftwood –
 * and now and then the flint blade they fought with; no carcass.
 *
 * **Spawn table** `salzkueste` (§12.4, §20.1): by day crabs, gulls, seals and the jellyfish of the warm months; at night
 * crabs, lobsters, seals, jellyfish and the beach raiders. The shadow brood of the coast's nights comes with its own group
 * (schattenbrut.ts adds it). Summer is the coast's busiest season, winter thins it out.
 */
import { defineCreatureRecords } from './define';
import { aiProfileSchema, lootTableSchema, spawnTableSchema } from './schema';

/** AI profiles of the Salt Coast creatures, validated and frozen. */
export const SALZKUESTE_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'krabbe',
    haltung: 'wehrhaft',
    sicht: 6,
    gehoer: 1.2,
    fluchtDistanz: 3,
    mut: 0.3,
    leine: 12,
    streifen: 5,
    gewichte: { ruhen: 2, grasen: 3, umherstreifen: 2 },
    untersuchen: 2,
    gedaechtnis: 3,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'moewe',
    haltung: 'wehrhaft',
    sicht: 12,
    gehoer: 1.2,
    fluchtDistanz: 5,
    mut: 0.6,
    leine: 28,
    streifen: 12,
    gewichte: { ruhen: 2, grasen: 2, umherstreifen: 3 },
    untersuchen: 2,
    gedaechtnis: 4,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'robbe',
    haltung: 'wehrhaft',
    sicht: 8,
    gehoer: 1.1,
    fluchtDistanz: 5,
    mut: 0.3,
    leine: 18,
    streifen: 6,
    gewichte: { ruhen: 4, grasen: 1, umherstreifen: 1 },
    untersuchen: 3,
    gedaechtnis: 5,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'scherenkrebs',
    haltung: 'revier',
    sicht: 8,
    gehoer: 1,
    fluchtDistanz: 4,
    mut: 0.2,
    leine: 10,
    streifen: 4,
    gewichte: { ruhen: 3, grasen: 1, umherstreifen: 1 },
    untersuchen: 4,
    gedaechtnis: 6,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'qualle',
    haltung: 'revier',
    sicht: 3,
    gehoer: 0.5,
    fluchtDistanz: 2,
    mut: 0,
    leine: 8,
    streifen: 4,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 2 },
    untersuchen: 2,
    gedaechtnis: 3,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'strandraeuber',
    haltung: 'aggressiv',
    sicht: 12,
    gehoer: 1.2,
    fluchtDistanz: 0,
    mut: 0.25,
    leine: 24,
    streifen: 8,
    gewichte: { ruhen: 2, grasen: 0, umherstreifen: 2 },
    untersuchen: 6,
    gedaechtnis: 10,
    rudel: { ringTiles: 3, angreiferZugleich: 1 },
    schuetztSich: false,
    brichtTueren: true,
    meidetLicht: null,
    unerbittlich: false,
  },
]);

/** Loot tables of the Salt Coast creatures, validated and frozen. */
export const SALZKUESTE_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  {
    id: 'krabbe',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [{ item: 'krebsfleisch_roh', chance: 1, anzahl: [1, 1] }],
  },
  {
    id: 'moewe',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'gefluegel_roh', chance: 1, anzahl: [1, 1] },
      // A gull is mostly feathers: more than a quail.
      { item: 'federn', chance: 1, anzahl: [3, 5] },
      { item: 'knochen', chance: 0.3, anzahl: [1, 1] },
    ],
  },
  {
    id: 'robbe',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      // The seal is the coast's fat: two to four pieces, each a minute of fire.
      { item: 'fett', chance: 1, anzahl: [2, 4] },
      { item: 'fell', chance: 1, anzahl: [1, 2] },
      { item: 'knochen', chance: 1, anzahl: [1, 2] },
      { item: 'sehnen', chance: 0.6, anzahl: [1, 1] },
    ],
  },
  {
    id: 'scherenkrebs',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [{ item: 'krebsfleisch_roh', chance: 1, anzahl: [2, 3] }],
  },
  {
    // What a beachcomber carries: one or two pieces; the blade he fought with about every eighth raider.
    id: 'strandraeuber',
    ziehungen: [1, 2],
    beute: [
      { item: 'feuerstein', gewicht: 3, anzahl: [1, 2] },
      { item: 'faserseil', gewicht: 3, anzahl: [1, 1] },
      { item: 'salz', gewicht: 2, anzahl: [1, 2] },
      { item: 'treibholz', gewicht: 2, anzahl: [1, 2] },
      { item: 'feuersteinklinge', gewicht: 1, anzahl: [1, 1] },
    ],
    zerlegen: [],
  },
]);

/** The spawn table of the Salt Coast, validated and frozen. */
export const SALZKUESTE_SPAWN = defineCreatureRecords('spawnTables', spawnTableSchema, [
  {
    id: 'salzkueste',
    // Where they appear (M6-27b): crabs on the dry sand, seals within four tiles of the water, jellyfish in the shallows.
    tag: [
      { kreatur: 'krabbe', gewicht: 4, gruppe: [1, 3], ort: { boden: ['sand'] } },
      { kreatur: 'moewe', gewicht: 3, gruppe: [2, 4] },
      { kreatur: 'robbe', gewicht: 1, gruppe: [1, 2], ort: { wasserNaehe: 4 } },
      // Jellyfish drift in with the warm water.
      { kreatur: 'qualle', gewicht: 2, gruppe: [1, 2], jahreszeiten: ['sommer', 'herbst'], ort: { wasser: 'flach' } },
    ],
    nacht: [
      { kreatur: 'krabbe', gewicht: 3, gruppe: [1, 2], ort: { boden: ['sand'] } },
      { kreatur: 'scherenkrebs', gewicht: 2, gruppe: [1, 1] },
      { kreatur: 'robbe', gewicht: 1, gruppe: [1, 2], ort: { wasserNaehe: 4 } },
      { kreatur: 'qualle', gewicht: 2, gruppe: [1, 2], jahreszeiten: ['sommer', 'herbst'], ort: { wasser: 'flach' } },
      { kreatur: 'strandraeuber', gewicht: 1, gruppe: [2, 2] },
    ],
    // Summer is the busiest: gulls breed, jellyfish drift in; the winter storms empty the beach.
    jahreszeiten: { fruehling: 1, sommer: 1.2, herbst: 1, winter: 0.6 },
  },
]);
