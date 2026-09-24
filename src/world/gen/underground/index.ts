/**
 * Underground layers −1 Wurzelhöhlen, −2 Tiefgrund, −3 Glutadern (MASTERPROMPT §9.1–§9.3; docs/WORLD.md
 * §2; M2-13).
 *
 * Contract for the surface plan and the chunk generator:
 * - `createUndergroundPlan({ seed, preset, entranceCandidates, extent? })` builds the cave network once
 *   per world (pure, structured-cloneable). The surface proposes candidate entrance tiles (or takes
 *   `proposeEntranceCandidates`); the accepted ones are `plan.links` of kind `eingang` – the surface
 *   puts its cave mouths exactly there. `extent` (e.g. `{ ...plan.grid, mask: plan.land }` of the world
 *   plan) keeps caverns under land.
 * - `generateUndergroundChunk(plan, layer, cx, cy)` generates one chunk of layer −1/−2/−3 in any order;
 *   `generateUndergroundChunkFor(input, …)` does both steps for one input object.
 * - Links between layers share their tile: `TILE_FLAG_RAMP` marks the way up in the lower layer,
 *   `TILE_FLAG_STAIRS` the shaft down in the upper underground layer.
 */
export { CARVE_OVERLAP, carveRect, primsInWindow, type CarvedRect } from './carve';
export { generateUndergroundChunk, generateUndergroundChunkFor } from './chunk';
export { LAKE_DEEP, LAKE_DRY, LAKE_RIM, LAKE_SHALLOW, lakeRadius, lakeRaster, type LakeRaster } from './lakes';
export {
  createUndergroundPlan,
  layerPlanOf,
  proposeEntranceCandidates,
  selectCaveEntrances,
  undergroundPlanHash,
  undergroundSeed,
  type CaveLink,
  type CaveNode,
  type CaveSlot,
  type CaveSystem,
  type CaveTunnel,
  type NodeFeature,
  type NodeRole,
  type TilePoint,
  type UndergroundExtent,
  type UndergroundInput,
  type UndergroundLayerPlan,
  type UndergroundPlan,
} from './network';
export {
  AREA,
  CARVE,
  CAVE_SPECIALS,
  LAKES,
  LAYER_PARAMS,
  LINKS,
  LLOYD_ITERATIONS,
  SHAPES,
  UNDERGROUND_LAYERS,
  UNDERGROUND_VERSION,
  VEINS,
  isUndergroundLayer,
  layerParams,
  type CaveSpecial,
  type FloorPatch,
  type LayerParams,
  type ObjectDensity,
  type UndergroundLayer,
} from './params';
