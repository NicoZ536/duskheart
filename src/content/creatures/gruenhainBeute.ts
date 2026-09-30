/**
 * Loot and spawn entries of the Grünhain creatures of M6-20 … M6-22 (MASTERPROMPT §14 "Jagen & Zerlegen", §20.1, §31.4
 * "Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten", §D "Ökonomie"; docs/SPIEL.md §11 "Beute, Jagen, Fallen",
 * "Bestand und Spawn"). The group file src/content/creatures/gruenhain.ts registers them.
 *
 * **Loot** (a table has the id of its creature – the source `drop:<kreatur>` of its items): animals leave a carcass to carve
 * with a knife and no direct loot, like the reference creatures; the amounts follow the body – a squirrel or a frog is a
 * snack with a scrap of hide, a boar a feast with fat for the lamp. §D wants a tier's full equipment in 2–3 hours of
 * gathering: a boar's or a wolf pack's hides are a real step towards the leather set (4 hides per piece at the tanning frame),
 * so their fights are worth it without making the leather free. The Dornling is a plant and leaves no carcass; its thorns
 * hold what is left of its prey (bones, hide, feathers). The wasp swarm leaves its poison stings (`wespenstachel`, an arrow
 * poison, src/content/items/jagd_gruenhain.ts). The firefly leaves nothing (`ohneBeute`, docs/SPIEL.md §11: its light goes
 * out with it). No foe drops what the world offers to gather (wood, twigs, fibre): the item hints name the world first.
 *
 * **Spawn** (entries added to the Grünhain table of the core, src/content/creatures/spawn.ts – `tag` by day and at dusk,
 * `nacht` at night): the peaceful ones common, the foes rare enough that the meadows stay the safe start (§23.1); wolves come
 * as a pack of two or three, by night more often. Seasons: squirrels all year; frogs and wasps not in winter (hibernation,
 * the swarm dies off); fireflies only on spring and summer nights – exactly the nights the drifting fireflies of the world
 * surface fly (`SURFACE_PARAMS.fireflies.seasons`, M5-23; tests/unit/game/kreaturen-gruenhain.test.ts compares).
 */
import { defineCreatureRecords, defineSpawnAdditions } from './define';
import { lootTableSchema } from './schema';

/** The loot tables of the Grünhain creatures, validated and frozen. */
export const GRUENHAIN_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  {
    id: 'eichhoernchen',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [1, 1] },
      { item: 'fell', chance: 0.8, anzahl: [1, 1] },
      { item: 'knochen', chance: 0.3, anzahl: [1, 1] },
    ],
  },
  {
    // Frog legs: a mouthful of meat, a small bone now and then.
    id: 'frosch',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 0.8, anzahl: [1, 1] },
      { item: 'knochen', chance: 0.2, anzahl: [1, 1] },
    ],
  },
  {
    id: 'keiler',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [3, 5] },
      { item: 'fell', chance: 1, anzahl: [1, 2] },
      { item: 'knochen', chance: 1, anzahl: [2, 3] },
      { item: 'fett', chance: 1, anzahl: [2, 3] },
      { item: 'sehnen', chance: 0.7, anzahl: [1, 2] },
    ],
  },
  {
    // The badger is famous for its fat and its dense pelt.
    id: 'dachs',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [1, 2] },
      { item: 'fell', chance: 1, anzahl: [1, 1] },
      { item: 'fett', chance: 1, anzahl: [1, 3] },
      { item: 'knochen', chance: 0.7, anzahl: [1, 2] },
      { item: 'sehnen', chance: 0.4, anzahl: [1, 1] },
    ],
  },
  {
    id: 'wolf',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [1, 2] },
      { item: 'fell', chance: 1, anzahl: [1, 2] },
      { item: 'knochen', chance: 0.8, anzahl: [1, 2] },
      { item: 'sehnen', chance: 0.8, anzahl: [1, 2] },
      { item: 'fett', chance: 0.3, anzahl: [1, 1] },
    ],
  },
  {
    // A plant foe: no carcass, but its thorns and hollow hold what is left of its prey – bones, tufts of hide, feathers.
    id: 'dornling',
    ziehungen: [1, 2],
    beute: [
      { item: 'knochen', gewicht: 3, anzahl: [1, 2] },
      { item: 'fell', gewicht: 2, anzahl: [1, 1] },
      { item: 'federn', gewicht: 2, anzahl: [1, 3] },
    ],
    zerlegen: [],
  },
  {
    // The stings of the slain swarm, still full of venom (an arrow poison, src/content/items/jagd_gruenhain.ts).
    id: 'wespenschwarm',
    ziehungen: [1, 1],
    beute: [{ item: 'wespenstachel', gewicht: 1, anzahl: [1, 2] }],
    zerlegen: [],
  },
]);

/** The Grünhain creatures in the Grünhain table (by day and at dusk, by night), validated and frozen. */
export const GRUENHAIN_SPAWN = defineSpawnAdditions('spawnTables', [
  {
    biom: 'gruenhain',
    tag: [
      { kreatur: 'eichhoernchen', gewicht: 2.5, gruppe: [1, 2] },
      { kreatur: 'frosch', gewicht: 1.5, gruppe: [1, 2], jahreszeiten: ['fruehling', 'sommer', 'herbst'] },
      { kreatur: 'keiler', gewicht: 1, gruppe: [1, 2] },
      { kreatur: 'dachs', gewicht: 0.6, gruppe: [1, 1] },
      { kreatur: 'wolf', gewicht: 0.5, gruppe: [2, 3] },
      { kreatur: 'dornling', gewicht: 0.8, gruppe: [1, 1] },
      { kreatur: 'wespenschwarm', gewicht: 0.8, gruppe: [1, 1], jahreszeiten: ['fruehling', 'sommer', 'herbst'] },
    ],
    nacht: [
      { kreatur: 'frosch', gewicht: 2, gruppe: [1, 2], jahreszeiten: ['fruehling', 'sommer', 'herbst'] },
      { kreatur: 'gluehwuermchen', gewicht: 3, gruppe: [1, 2], jahreszeiten: ['fruehling', 'sommer'] },
      { kreatur: 'keiler', gewicht: 1, gruppe: [1, 2] },
      { kreatur: 'dachs', gewicht: 1.2, gruppe: [1, 1] },
      { kreatur: 'wolf', gewicht: 1.2, gruppe: [2, 3] },
      { kreatur: 'dornling', gewicht: 0.8, gruppe: [1, 1] },
    ],
  },
]);
