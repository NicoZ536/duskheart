/**
 * The Builder vaults in the world generator (docs/SPIEL.md §19, ADR-0207; strand C): the graph grammar, the room templates, the
 * embedding and occupancy, the step `gewoelbe` and the raster the underground chunk generator stamps into layer −1.
 */
export { vaultGraph, walkVault, type VaultGraphParams, type VaultOccupancy } from './grammar';
export { planReachable, planVault, type VaultPlanInput } from './embed';
export { planVaults, shardSlots, vaultGraphParams, vaultPlansHash, VAULT_GUARDS, VAULT_SLOT_TYPE, type VaultClearing } from './plan';
export { contentVaultTilesets, tilesetOfBiome, type CompiledTemplate, type TilesetTemplates } from './templates';
export { placedTemplate, stampVault, vaultChestObject, vaultRaster, VAULT_COLLAPSED_OBJECT, VAULT_OPEN_CHEST_OBJECT, VAULT_STAIRS_DOWN_OBJECT, VAULT_STAIRS_UP_OBJECT, VAULT_TABLET_OBJECT, type VaultRaster } from './raster';
export { kistenMap, kistenStep, partOrdinal, PUSH_DIRECTIONS, puzzleLayout, PUZZLE_PART_ROLES, type KistenMap, type PuzzleLayout, type PuzzlePart, type PuzzlePartRole } from './puzzleLayout';
export * from './types';
