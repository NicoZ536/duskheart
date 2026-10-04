/**
 * The spawn tables of the underground (MASTERPROMPT §12.4 "Spawnt in Gruppen … nachts oder im Untergrund", §20.1
 * "Schattenbrut (überall nachts und im Untergrund)", §31.4; docs/SPIEL.md §11 "Bestand und Spawn"; M6-Gate): the cave
 * biomes the world generates (src/world/gen/underground/params.ts) – Wurzelhöhlen (−1), Tiefgrund (−2), Glutadern (−3) –
 * get their tables now, so that the night spawner finds one wherever the player stands below the surface. The shadow brood
 * adds its base family to them (schattenbrutDaten.ts), each brood in the variant of the biome (Tiefgrund `tiefe`,
 * Glutadern `asche`) and at the density of the biome's tier (`BALANCE.spawn.biomeTier`).
 *
 * Underground there is no day: the night list holds at every hour, the day list stays empty (validator rule `spawn`). No
 * wildlife lives in the caves yet – its creatures come with their content (M8-13 Wurzelhöhlen, M8-15 Tiefgrund, M10-10
 * Glutadern) and add themselves to these tables (`defineSpawnAdditions`). The seasons do not reach the depth: every factor 1.
 */
import { defineCreatureRecords, type CreatureGroup } from './define';
import { spawnTableSchema } from './schema';

/** No season reaches the caves. */
const JAHRESZEITEN = { fruehling: 1, sommer: 1, herbst: 1, winter: 1 } as const;

/** The underground biomes' tables (their entries come from the groups that live there), validated and frozen. */
export const UNTERGRUND_SPAWN = defineCreatureRecords('spawnTables', spawnTableSchema, [
  { id: 'wurzelhoehlen', tag: [], nacht: [], jahreszeiten: JAHRESZEITEN },
  { id: 'tiefgrund', tag: [], nacht: [], jahreszeiten: JAHRESZEITEN },
  { id: 'glutadern', tag: [], nacht: [], jahreszeiten: JAHRESZEITEN },
]);

/** The underground group (M6-Gate): no creatures of its own yet, the tables of the cave biomes. */
export const UNTERGRUND_GRUPPE: CreatureGroup = {
  id: 'untergrund',
  kreaturen: [],
  profile: [],
  beute: [],
  spawnTabellen: UNTERGRUND_SPAWN,
  spawnZusaetze: [],
};
