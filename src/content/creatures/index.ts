/**
 * Creature content (MASTERPROMPT §19.4, §20.1; docs/SPIEL.md §11, §14): the schemas and the five lists the registry turns
 * into the collections `creatures`, `aiProfiles`, `lootTables`, `spawnTables` and `traps` (src/content/index.ts).
 */
export { AI_PROFILES } from './profile';
export { CREATURES } from './kreaturen';
export { LOOT_TABLES } from './beute';
export { SPAWN_TABLES } from './spawn';
export { TRAPS } from './fallen';
export { CreatureContentError, defineCreatureRecords } from './define';
export * from './schema';
