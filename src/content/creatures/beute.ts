/**
 * Loot tables (MASTERPROMPT §14 "Jagen & Zerlegen", §12.4 "Beute: Lumen-Scherben", §D "Lumen-Scherben ≈ 15–25 pro aktiver
 * Nacht auf Stufe 1"; docs/SPIEL.md §11 "Beute, Jagen, Fallen"; M6-30). A table has the id of its creature, so it is the
 * source `drop:<kreatur>` of every item it names (src/content/items/relations.ts).
 *
 * - `beute`: drawn on defeat – `ziehungen` weighted draws (seeded, `drawLoot` in src/game/creatures/formulas.ts) from the entries available
 *   at the creature's tier (`stufeAb`), each with its count range; the pieces land around the body.
 * - `zerlegen`: the carcass an animal leaves is carved with a knife (E); each entry comes with its own chance.
 *
 * Animals leave a carcass and no direct loot; shadow brood leaves loot and no carcass.
 */
import { defineCreatureRecords } from './define';
import { lootTableSchema } from './schema';

/** Every loot table, validated and frozen. */
export const LOOT_TABLES = defineCreatureRecords('lootTables', lootTableSchema, [
  {
    id: 'hase',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [1, 2] },
      { item: 'fell', chance: 1, anzahl: [1, 1] },
      { item: 'knochen', chance: 0.6, anzahl: [1, 1] },
      { item: 'sehnen', chance: 0.3, anzahl: [1, 1] },
    ],
  },
  {
    id: 'reh',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'wildfleisch_roh', chance: 1, anzahl: [2, 4] },
      { item: 'fell', chance: 1, anzahl: [1, 2] },
      { item: 'knochen', chance: 1, anzahl: [1, 3] },
      { item: 'sehnen', chance: 0.8, anzahl: [1, 2] },
      { item: 'fett', chance: 0.7, anzahl: [1, 2] },
      // Only a buck carries antlers: about every third deer.
      { item: 'hirschgeweih', chance: 0.35, anzahl: [1, 1] },
    ],
  },
  {
    id: 'wachtel',
    ziehungen: [0, 0],
    beute: [],
    zerlegen: [
      { item: 'gefluegel_roh', chance: 1, anzahl: [1, 1] },
      { item: 'federn', chance: 1, anzahl: [2, 4] },
      { item: 'knochen', chance: 0.3, anzahl: [1, 1] },
    ],
  },
  {
    // The Nachtmahr is a night's worth of shadow brood (§D: 15–25 shards a night at tier 1): a third of it, more from
    // tier 3 on where it is stronger.
    id: 'nachtmahr',
    ziehungen: [1, 1],
    beute: [
      { item: 'lumen_scherbe', gewicht: 1, anzahl: [4, 6] },
      { item: 'lumen_scherbe', gewicht: 2, anzahl: [7, 9], stufeAb: 3 },
    ],
    zerlegen: [],
  },
]);
