/**
 * The places of the world (docs/SPIEL.md §18, ADR-0207; collections `locationTypes`, `placeLayouts`, `placeLoot` in
 * src/content/index.ts). An aggregation file: strand B adds its location types, layouts and loot, C the `gewoelbe` record and
 * the vault loot (`src/content/dungeons/ort.ts`), F the `bossarena` record and its layout (`src/content/bosses/arena.ts`) –
 * each one import and one spread per list, nothing else.
 */
import type { PlaceDefInput, PlaceLayoutInput, PlaceLootInput } from './schema';
import { PLACE_TYPES_B } from './typen';
import { PLACE_LAYOUTS_B } from './layouts/index';
import { PLACE_LOOT_B } from './beute';
import { BOSS_ARENA_LAYOUTS, BOSS_ARENA_PLACE } from '../bosses/arena';

/** Location types (`PlaceDef`, id = a `LocationType`). */
export const PLACE_TYPES: readonly PlaceDefInput[] = [...PLACE_TYPES_B, BOSS_ARENA_PLACE];
/** ASCII layouts of the places. */
export const PLACE_LAYOUTS: readonly PlaceLayoutInput[] = [...PLACE_LAYOUTS_B, ...BOSS_ARENA_LAYOUTS];
/** Chest loot of places and vaults. */
export const PLACE_LOOT: readonly PlaceLootInput[] = [...PLACE_LOOT_B];
