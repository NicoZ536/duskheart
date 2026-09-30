/**
 * Creature content (MASTERPROMPT §19.4, §20.1; docs/SPIEL.md §11, §14): the schemas and the lists the registry turns into
 * the collections `creatures`, `aiProfiles`, `lootTables`, `spawnTables` and `traps` (src/content/index.ts).
 *
 * The creatures come in groups (`CreatureGroup`, define.ts): the core's reference creatures (kreaturen.ts with profile.ts,
 * beute.ts, spawn.ts) and one file per further set of creatures, each registered with one line in `CREATURE_GROUPS`. The
 * collections join the groups in this order; a group's spawn additions go into the tables other groups own.
 */
import { AI_PROFILES as KERN_PROFILE } from './profile';
import { CREATURES as KERN_KREATUREN } from './kreaturen';
import { LOOT_TABLES as KERN_BEUTE } from './beute';
import { SPAWN_TABLES as KERN_SPAWN } from './spawn';
import { joinSpawnTables, type CreatureGroup } from './define';
import { GRUENHAIN_GRUPPE } from './gruenhain';
import { SALZKUESTE_GRUPPE } from './salzkueste';
import { SCHATTENBRUT_GRUPPE } from './schattenbrut';
import type { AiProfileDef, CreatureDef, LootTableDef, SpawnTableDef } from './schema';

/** The creature groups in registry order (one line per group file). */
export const CREATURE_GROUPS: readonly CreatureGroup[] = [
  // The reference creatures of the creature core (hase, reh, wachtel, nachtmahr) and the Grünhain table (M6-19, M6-29).
  { id: 'kern', kreaturen: KERN_KREATUREN, profile: KERN_PROFILE, beute: KERN_BEUTE, spawnTabellen: KERN_SPAWN, spawnZusaetze: [] },
  // Grünhain II–IV: squirrel, fireflies, frog, boar, badger, wolf, Dornling, wasp swarm (M6-20 … M6-22).
  GRUENHAIN_GRUPPE,
  // Salzküste I–II: crab, gull, seal, lobster, jellyfish, beach raider and the coast's table (M6-23, M6-24).
  SALZKUESTE_GRUPPE,
  // The shadow brood's base family with its biome variants and its nights in every table (M6-25, M6-26).
  SCHATTENBRUT_GRUPPE,
];

/** Every creature, in group order. */
export const CREATURES: readonly CreatureDef[] = CREATURE_GROUPS.flatMap((g) => g.kreaturen);
/** Every AI profile, in group order. */
export const AI_PROFILES: readonly AiProfileDef[] = CREATURE_GROUPS.flatMap((g) => g.profile);
/** Every loot table, in group order. */
export const LOOT_TABLES: readonly LootTableDef[] = CREATURE_GROUPS.flatMap((g) => g.beute);
/** Every spawn table with the additions of all groups. */
export const SPAWN_TABLES: readonly SpawnTableDef[] = joinSpawnTables(CREATURE_GROUPS);

export { TRAPS } from './fallen';
export { CreatureContentError, defineCreatureRecords, defineSpawnAdditions, joinSpawnTables, type CreatureGroup, type SpawnAddition } from './define';
export * from './schema';
