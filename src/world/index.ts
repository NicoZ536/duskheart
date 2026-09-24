/**
 * Public entry of the world layer (MASTERPROMPT §3.2 `src/world`; docs/WORLD.md, docs/ARCHITEKTUR.md
 * "Welt"): data model, generation (world plan, places, roads, deposits, chunk generator, worker),
 * streaming with the active zone, calendar, climate, collision and autotiling.
 *
 * World generation in short: `generateWorld(seed, size, onProgress)` (or `requestWorld` against the
 * world worker, `world.worker.ts`) builds the `GeneratedWorld`; `generateChunk(world, layer, cx, cy)`
 * realises any chunk of it, in any order.
 */
export * from './model/index';
export * from './stream/index';
export * from './calendar';
export * from './climate/index';
export * from './collision/index';
export * from './autotile';
export { generateWorldPlan, worldPlanHash, PLAN_BIOME_IDS, PLAN_VERSION, type WorldPlan, type PlanReport } from './gen/plan/index';
export { generateWorld, surfaceChunksHash, worldHash, WORLD_GEN_STEPS, WORLD_GEN_VERSION, type GeneratedWorld, type WorldGenProgress, type WorldGenStep, type WorldReport } from './gen/world';
export { generateChunk } from './gen/chunk';
export { createWorldWorkerHandlers, requestWorld, serveWorldWorker, type WorldWorkerApi, type WorldWorkerEvents } from './gen/worker';
export { BEACON_BIOMES, LOCATION_RULES, LOCATION_TYPES, LOCATIONS, type LocationSlot, type LocationType } from './gen/locations';
export { ROADS, type Road, type RoadCrossing, type RoadNetwork } from './gen/roads';
export { VALIDATION, type Bridge } from './gen/validate';
export { DEPOSIT_OBJECTS, RESOURCES, resourceRequirements, type ResourceDeposit, type ResourcePlan, type ResourceRequirement, type ResourceTally } from './gen/resources';
export { SCATTER, SPECIES, VEGETATION } from './gen/vegetation';
