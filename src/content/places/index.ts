/**
 * The places of the world (docs/SPIEL.md §18, ADR-0207; collections `locationTypes`, `placeLayouts`, `placeLoot` in
 * src/content/index.ts). An aggregation file: strand B adds its location types, layouts and loot, C the `gewoelbe` record and
 * the vault loot (`src/content/dungeons/ort.ts`), F the `bossarena` record and its layout (`src/content/bosses/arena.ts`) –
 * each one import and one spread per list, nothing else.
 */
import type { PlaceDefInput, PlaceLayoutInput, PlaceLootInput } from './schema';

/** Location types (`PlaceDef`, id = a `LocationType`). */
export const PLACE_TYPES: readonly PlaceDefInput[] = [];
/** ASCII layouts of the places. */
export const PLACE_LAYOUTS: readonly PlaceLayoutInput[] = [];
/** Chest loot of places and vaults. */
export const PLACE_LOOT: readonly PlaceLootInput[] = [];
