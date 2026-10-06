/**
 * Chest and cache loot of the places (docs/SPIEL.md §18 "Truhen", §29 "Beute `ort_<ortstyp>_<stufe>`"; MASTERPROMPT §21
 * "Truhen nach Stufe"; M7-08, M7-09; strand B). Drawn with `hash(seed, place, chest)` when a chest opens or the shovel finds a
 * cache (src/game/places/formulas.ts `drawPlaceLoot`): the guaranteed pieces, then `ziehungen` weighted draws.
 *
 * Tiers: 1 a farmer's or hermit's wooden chest – the means of an early camp (rope, fat, leather, arrows, bandages, a seedling);
 * 2 an iron-bound chest – processed goods a first base still lacks (nails, yarn, copper and tin bars, a leather piece); 3 a
 * Builder casket – Lumen shards and bronze, rare even after the first beacon. A dig site's cache is tier 1 with a shard; the
 * ancient tree hides a tier-2 hollow in its roots. Everything here is obtainable elsewhere too – the places speed a run up,
 * they gate nothing (§13.2).
 */
import type { PlaceLootInput } from './schema';

export const PLACE_LOOT_B: readonly PlaceLootInput[] = [
  {
    id: 'ort_gehoeft_1',
    ziehungen: [2, 3],
    beute: [
      { item: 'faserseil', gewicht: 3, anzahl: [2, 4] },
      { item: 'fett', gewicht: 2, anzahl: [1, 3] },
      { item: 'leder', gewicht: 2, anzahl: [1, 2] },
      { item: 'fackel', gewicht: 2, anzahl: [1, 2] },
      { item: 'verband', gewicht: 2, anzahl: [1, 2] },
      { item: 'keramik_topf', gewicht: 1, anzahl: [1, 1] },
    ],
    garantiert: [{ item: 'setzling_apfelbaum', anzahl: 1 }],
  },
  {
    id: 'ort_gehoeft_2',
    ziehungen: [2, 3],
    beute: [
      { item: 'nagel_bronze', gewicht: 3, anzahl: [4, 8] },
      { item: 'garn', gewicht: 3, anzahl: [2, 4] },
      { item: 'kupferbarren', gewicht: 2, anzahl: [1, 2] },
      { item: 'zinnbarren', gewicht: 1, anzahl: [1, 1] },
      { item: 'lederkappe', gewicht: 1, anzahl: [1, 1] },
      { item: 'pfeil_feuerstein', gewicht: 2, anzahl: [6, 10] },
    ],
  },
  {
    id: 'ort_aussichtsturm_1',
    ziehungen: [2, 3],
    beute: [
      { item: 'pfeil_feuerstein', gewicht: 3, anzahl: [6, 12] },
      { item: 'fackel', gewicht: 3, anzahl: [1, 3] },
      { item: 'faserseil', gewicht: 2, anzahl: [2, 3] },
      { item: 'kurzbogen', gewicht: 1, anzahl: [1, 1] },
      { item: 'holzkohle', gewicht: 2, anzahl: [2, 4] },
    ],
  },
  {
    id: 'ort_eremitenhuette_1',
    ziehungen: [3, 4],
    beute: [
      { item: 'schafgarbe', gewicht: 3, anzahl: [2, 4] },
      { item: 'wegerich', gewicht: 3, anzahl: [2, 4] },
      { item: 'verband', gewicht: 2, anzahl: [1, 3] },
      { item: 'schiene', gewicht: 1, anzahl: [1, 1] },
      { item: 'leuchtpilz', gewicht: 2, anzahl: [1, 3] },
      { item: 'harz', gewicht: 2, anzahl: [2, 4] },
    ],
  },
  {
    id: 'ort_brueckenruine_2',
    ziehungen: [2, 3],
    beute: [
      { item: 'steinblock', gewicht: 2, anzahl: [2, 4] },
      { item: 'nagel_bronze', gewicht: 2, anzahl: [4, 8] },
      { item: 'kupferbarren', gewicht: 2, anzahl: [1, 2] },
      { item: 'zinnbarren', gewicht: 2, anzahl: [1, 2] },
      { item: 'lumen_scherbe', gewicht: 1, anzahl: [1, 2] },
    ],
  },
  {
    id: 'ort_friedhof_3',
    ziehungen: [2, 3],
    beute: [
      { item: 'lumen_scherbe', gewicht: 3, anzahl: [2, 4] },
      { item: 'bronzebarren', gewicht: 2, anzahl: [1, 2] },
      { item: 'glas', gewicht: 2, anzahl: [2, 3] },
      { item: 'haueramulett', gewicht: 1, anzahl: [1, 1] },
      { item: 'wolfszahnkette', gewicht: 1, anzahl: [1, 1] },
    ],
    garantiert: [{ item: 'lumen_scherbe', anzahl: 1 }],
  },
  {
    id: 'ort_naturwunder_2',
    ziehungen: [2, 3],
    beute: [
      { item: 'walnuss', gewicht: 3, anzahl: [3, 6] },
      { item: 'harz', gewicht: 3, anzahl: [3, 5] },
      { item: 'steinpilz', gewicht: 2, anzahl: [1, 3] },
      { item: 'leuchtpilz', gewicht: 2, anzahl: [2, 3] },
      { item: 'setzling_eiche', gewicht: 1, anzahl: [1, 2] },
    ],
  },
  {
    id: 'ort_buddelstelle_1',
    ziehungen: [2, 3],
    beute: [
      { item: 'feuerstein', gewicht: 3, anzahl: [2, 4] },
      { item: 'kupfererz', gewicht: 2, anzahl: [2, 4] },
      { item: 'zinnerz', gewicht: 2, anzahl: [2, 3] },
      { item: 'knochen', gewicht: 2, anzahl: [1, 3] },
      { item: 'keramik_topf', gewicht: 1, anzahl: [1, 1] },
    ],
    garantiert: [{ item: 'lumen_scherbe', anzahl: 1 }],
  },
];
