/**
 * The Builder vaults' content (docs/SPIEL.md §19, §29; strand C): room templates per tileset, the tilesets, the puzzle types,
 * the traps, the tablets – the five collections `roomTemplates`, `vaultTilesets`, `puzzleTypes`, `vaultTraps`, `tablets` of
 * src/content/index.ts – and what other aggregation files spread in: the place `gewoelbe` with its layout and chest loot
 * (src/content/places/index.ts), the vault objects (src/content/worldObjects.ts), the schematics' unlock rows
 * (src/content/unlocks/index.ts).
 */
import { GRUENHAIN_TEMPLATES } from './gruenhain/vorlagen';
import type { RoomTemplateInput } from './schema';

export { VAULT_TILESETS } from './tileset';
export { PUZZLE_TYPES } from './raetsel';
export { VAULT_TRAPS } from './fallen';
export { TABLETS } from './tafeln';
export { VAULT_LOOT, VAULT_PLACE, VAULT_PLACE_LAYOUTS } from './ort';
export { VAULT_OBJECTS } from './objekte';
export * from './schema';

/** Every room template of every tileset. */
export const ROOM_TEMPLATES: readonly RoomTemplateInput[] = [...GRUENHAIN_TEMPLATES];
