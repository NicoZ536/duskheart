/**
 * Spawn tables (MASTERPROMPT §12.4, §20.1, §31.4 "Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten"; docs/SPIEL.md
 * §11 "Bestand und Spawn"; M6-27). A table has the id of its biome. Its `tag` and `nacht` entries name who appears at
 * that time (weight, group size, seasons); `jahreszeiten` scales how much appears in each season.
 *
 * - Wildlife entries (every family but the shadow brood) make up the persistent population of a chunk: drawn at its first
 *   activation and whenever an animal grows back, with the table of that moment (src/game/creatures/spawn.ts).
 * - Shadow brood entries of `nacht` are what the night spawner brings (§12.4); underground layers use them at any hour.
 *
 * Tables of the other biomes come with their creatures (tools/validator/spawn-geplant.ts names task and reason for each).
 */
import { defineCreatureRecords } from './define';
import { spawnTableSchema } from './schema';

/** Every spawn table, validated and frozen. */
export const SPAWN_TABLES = defineCreatureRecords('spawnTables', spawnTableSchema, [
  {
    // Grünhain: hares and deer at every hour (both are awake at dusk and night too), quail by day from spring to autumn.
    id: 'gruenhain',
    tag: [
      { kreatur: 'hase', gewicht: 4, gruppe: [1, 2] },
      { kreatur: 'reh', gewicht: 2, gruppe: [1, 3] },
      { kreatur: 'wachtel', gewicht: 3, gruppe: [2, 4], jahreszeiten: ['fruehling', 'sommer', 'herbst'] },
    ],
    nacht: [
      { kreatur: 'hase', gewicht: 3, gruppe: [1, 1] },
      { kreatur: 'reh', gewicht: 2, gruppe: [1, 2] },
    ],
    // Spring and summer are full of young animals; the autumn thins out, the winter halves what appears.
    jahreszeiten: { fruehling: 1.2, sommer: 1, herbst: 0.9, winter: 0.5 },
  },
]);
