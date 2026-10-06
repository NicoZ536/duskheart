/**
 * The bosses (docs/SPIEL.md §22, MASTERPROMPT §20.2; strand F, collection `bosses`, §C "Bosse"): one record per boss,
 * validated by `bossSchema` when the registry loads (src/content/index.ts). M7: the Borkenvater of Grünhain (M7-33, M7-34);
 * the bosses of the other biomes follow with their beacons (M8-23, M8-25, M10-15, M10-17, M12-12, M12-16/17).
 */
import { BORKENVATER } from './borkenvater';
import type { BossInput } from './schema';

/** Every boss, in beacon order. */
export const BOSSES: readonly BossInput[] = [BORKENVATER];

export * from './schema';
export { BOSS_ARENA_LAYOUTS, BOSS_ARENA_PLACE } from './arena';
