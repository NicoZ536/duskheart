/**
 * Content entry point: the game's content registry plus the shared schemas and balance table.
 * Collections are defined here in dependency order; the validator (`npm run validate:content`)
 * loads `CONTENT` and checks schemas, references, texts and the §C counts.
 */
import { BIOMES, biomeSchema } from './biomes';
import { ORES, oreSchema } from './ores';
import { ContentRegistry } from './registry';
import { ref } from './schema/common';
import { TERRAIN, terrainSchema } from './terrain';
import { WORLD_OBJECTS, worldObjectSchema } from './worldObjects';

/** The registry holding every content collection of the game. */
export const CONTENT = new ContentRegistry()
  // World (M2, docs/WORLD.md §4/§7). Only trees count towards §C ("Baumarten", ADR-0006).
  .defineCollection('biomes', biomeSchema, BIOMES)
  .defineCollection('ores', oreSchema, ORES, { refs: [ref('biomes[]', 'biomes')] })
  .defineCollection('terrain', terrainSchema, TERRAIN, { refs: [ref('dig.becomes', 'terrain'), ref('ore', 'ores')] })
  .defineCollection('worldObjects', worldObjectSchema, WORLD_OBJECTS, {
    category: (o) => (o.kind === 'baum' ? ['trees'] : []),
    refs: [ref('biomes[]', 'biomes'), ref('ore', 'ores')],
  });

export { BALANCE, SEASON_IDS, type Balance, type SeasonId, type WorldSizePreset } from './balance';
export { BIOMES, MAX_DAY_AMPLITUDE_C, PALETTE_RAMP_NAMES, WORLD_LAYERS, biomeSchema, paletteRefSchema, worldLayerSchema, type Biome, type WorldLayer } from './biomes';
export { CONTENT_CATEGORIES, contentCategorySchema, isContentCategory, type ContentCategory } from './categories';
export { deepFreeze, type DeepReadonly } from './freeze';
export { ORES, ORE_HARDNESS_MAX, ORE_HARDNESS_MIN, oreSchema, type Ore } from './ores';
export {
  COLLECTION_NAME_PATTERN,
  ContentError,
  ContentRegistry,
  type CategoryMapping,
  type CollectionMap,
  type CollectionOptions,
  type ContentCollection,
  type ContentRecord,
  type ContentRegistryView,
  type ReferenceUse,
} from './registry';
export * from './schema/common';
export {
  FOOTSTEP_MATERIALS,
  TERRAIN,
  TERRAIN_KINDS,
  TILESET_VARIANTS_MAX,
  TOOL_KINDS,
  VEIN_PREFIX,
  terrainSchema,
  terrainTilesetSchema,
  veinTerrainId,
  type FootstepMaterial,
  type Terrain,
  type TerrainKind,
  type ToolKind,
} from './terrain';
export { WORLD_OBJECTS, WORLD_OBJECT_KINDS, worldObjectSchema, type WorldObject, type WorldObjectKind } from './worldObjects';
