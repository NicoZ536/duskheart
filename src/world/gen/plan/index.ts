/**
 * The world plan (docs/WORLD.md §2 step 1; MASTERPROMPT §9.2 steps 1–6): a small, deterministic,
 * structured-cloneable description of the whole surface, generated once per world from the seed.
 *
 * Steps: island mask (`island.ts`) → Poisson regions, Voronoi, region graph (`regions.ts`) →
 * climate proxies and biome constraint solver (`biomes.ts`) → elevation (`height.ts`) → lakes,
 * rivers, streams (`water.ts`) → levels 0–4, reachability repair, ramps and stairs (`height.ts`) →
 * fords. Tile-level realisation for the chunk generator: `createPlanSampler` (coast, height with
 * ramps, water) and `createBiomeSampler` (domain-warped biome borders with transition strips).
 *
 * A plan attempt that cannot satisfy the biome rules is retried with a new island derived from the
 * same seed (`PLAN_MAX_ATTEMPTS`); the attempt number is part of the plan, so the result stays a pure
 * function of (seed, size). The plan is not saved: it is rebuilt from the seed (it is < 2 MB and
 * structured-cloneable, so a worker can hand it to the main thread).
 */
import type { WorldSizePreset } from '../../../content/balance';
import { Fnv1a64 } from '../../../engine/binary';
import { normalizeSeed } from '../../../engine/rng';
import { assignBiomes, computeClimate, PlanConstraintError, planBiomeIndex, type BiomeAssignment, type Climate } from './biomes';
import { createPlanFields, planRng } from './fields';
import type { PlanGrid } from './grid';
import { computeElevation, finalizeHeight, quantizeLevels, type PlanRamp } from './height';
import { generateIsland, type IslandMask } from './island';
import { PLAN_MAX_ATTEMPTS, PLAN_VERSION } from './params';
import { generateRegions, type PlanEdge, type PlanRegion, type RegionMap } from './regions';
import { generateHydrology, placeFords, type PlanFord, type PlanLake, type PlanRiver } from './water';

export { MAX_TIER, PLAN_BIOME_IDS, PlanConstraintError, planBiomeIndex, INLAND_BIOME_BY_TIER, unreachableByTier, missingTiers, progressionDistance, regionGraph, HARD_RULES, type RegionGraph } from './biomes';
export type { BiomeAssignment, Climate } from './biomes';
export { createPlanFields, planRng, planSeed, type PlanFields } from './fields';
export { planGrid, cellAtTile, cellCenterX, cellCenterY, neighbour4, type PlanGrid } from './grid';
export { MAX_LEVEL, heightTemperatureOffsetC, type PlanRamp, type RampKind } from './height';
export { MAIN_LANDMASS, NO_LANDMASS, generateIsland, type IslandMask } from './island';
export { PLAN_CELL_TILES, PLAN_VERSION } from './params';
export { CELL_BAND, CELL_INTERIOR, CELL_SEA, NO_REGION, generateRegions, type PlanEdge, type PlanRegion, type RegionKind, type RegionMap } from './regions';
export type { PlanFord, PlanLake, PlanRiver, RiverEnd, RiverKind } from './water';
export { createPlanSampler, createTerrainSample, type PlanSampler, type TerrainSample } from './sampler';
export { createBiomeSampler, createBiomeSample, pickBiome, type BiomeSample, type BiomeSampler } from './borders';

/** A region with its biome assignment and climate. */
export interface PlanRegionInfo extends PlanRegion {
  /** Surface biome id. */
  readonly biome: string;
  /** Progression tier 0…7. */
  readonly tier: number;
  /** Progression distance from the start [tiles, weighted]. */
  readonly distance: number;
  /** Mean mountain relief [0, 1]. */
  readonly relief: number;
  /** Mean moisture [0, 1]. */
  readonly moisture: number;
}

/** Counters of the generation (validation and repair report, WORLD.md §2). */
export interface PlanReport {
  /** Plan attempts used (1 = first island). */
  readonly planAttempts: number;
  /** Biome solver attempts of the final plan attempt. */
  readonly solverAttempts: number;
  /** Final soft cost of the biome solver. */
  readonly solverCost: number;
  /** Offshore islets added to the noise island. */
  readonly addedIslets: number;
  /** Cells stepped to make every plateau reachable. */
  readonly heightRepairs: number;
  /** Cells flattened into their surroundings (tiny plateaus). */
  readonly smoothedCells: number;
}

/** The world plan. */
export interface WorldPlan {
  readonly version: number;
  /** World seed (u32). */
  readonly seed: number;
  readonly preset: WorldSizePreset;
  /** Plan attempt the plan comes from (0 = first). */
  readonly attempt: number;
  readonly grid: PlanGrid;
  /** 1 = land per cell. */
  readonly land: Uint8Array;
  /** Landmass per cell (0 main island, −1 sea). */
  readonly landmass: Int16Array;
  readonly landmassSizes: readonly number[];
  /** Signed distance to the coast per cell [tiles]. */
  readonly coastDistance: Float32Array;
  /** Cell kind (sea, coastal band, interior). */
  readonly cellKind: Uint8Array;
  /** Region per cell (−1 sea). */
  readonly region: Int16Array;
  readonly regions: readonly PlanRegionInfo[];
  readonly edges: readonly PlanEdge[];
  readonly neighbours: readonly (readonly number[])[];
  /** Start region (Grünhain on the south coast). */
  readonly start: number;
  /** Nachtherz region. */
  readonly core: number;
  /** Filled elevation per cell [levels]. */
  readonly elevation: Float32Array;
  /** Height level 0–4 per cell. */
  readonly level: Uint8Array;
  readonly ramps: readonly PlanRamp[];
  /** Lake id per cell (−1 none). */
  readonly lake: Int16Array;
  readonly lakes: readonly PlanLake[];
  /** 1 on cells a river or stream runs through. */
  readonly riverCell: Uint8Array;
  readonly rivers: readonly PlanRiver[];
  readonly fords: readonly PlanFord[];
  readonly report: PlanReport;
}

/** Steps 1–3 of one attempt (also used by the step tests). */
export interface PlanBiomeStage {
  readonly island: IslandMask;
  readonly regions: RegionMap;
  readonly climate: Climate;
  readonly biomes: BiomeAssignment;
}

/** Runs steps 1–3 (island, regions, biomes) of one plan attempt. Throws `PlanConstraintError` like `assignBiomes`. */
export function planBiomeStage(worldSeed: number, attempt: number, preset: WorldSizePreset): PlanBiomeStage {
  const island = generateIsland(worldSeed, attempt, preset);
  const regions = generateRegions(worldSeed, attempt, preset, island);
  const climate = computeClimate(regions, createPlanFields(worldSeed, attempt, preset, regions.grid.tiles), island.landmass);
  const biomes = assignBiomes(worldSeed, attempt, regions, climate);
  return { island, regions, climate, biomes };
}

function buildPlan(worldSeed: number, attempt: number, preset: WorldSizePreset): WorldPlan {
  const { island, regions: map, climate, biomes } = planBiomeStage(worldSeed, attempt, preset);
  const grid = map.grid;
  const elevation = computeElevation(worldSeed, attempt, map, biomes, climate);
  const hydro = generateHydrology({ worldSeed, attempt, preset, map, land: island.land, landmass: island.landmass, regionBiome: biomes.biome, elevation }, planRng(worldSeed, attempt, 'water'));
  const level = quantizeLevels(grid, hydro.filled, island.land);
  for (let c = 0; c < grid.count; c++) {
    const lk = hydro.lake[c] as number;
    if (lk >= 0) level[c] = (hydro.lakes[lk] as PlanLake).level;
  }
  const height = finalizeHeight({ grid, landmass: island.landmass, region: map.region, regionBiome: biomes.biome, levels: level, lake: hydro.lake, river: hydro.riverCell }, planRng(worldSeed, attempt, 'height'));
  const fords = placeFords(grid, hydro.rivers, level, island.land, hydro.lake, hydro.riverCell);
  const regions: PlanRegionInfo[] = map.regions.map((r) => ({
    ...r,
    biome: biomes.biome[r.id] as string,
    tier: biomes.tier[r.id] as number,
    distance: biomes.distance[r.id] as number,
    relief: climate.regionRelief[r.id] as number,
    moisture: climate.regionMoisture[r.id] as number,
  }));
  return {
    version: PLAN_VERSION,
    seed: normalizeSeed(worldSeed),
    preset,
    attempt,
    grid,
    land: island.land,
    landmass: island.landmass,
    landmassSizes: island.landmassSizes,
    coastDistance: map.coastDistance,
    cellKind: map.cellKind,
    region: map.region,
    regions,
    edges: map.edges,
    neighbours: map.neighbours,
    start: biomes.start,
    core: biomes.core,
    elevation: hydro.filled,
    level,
    ramps: height.ramps,
    lake: hydro.lake,
    lakes: hydro.lakes,
    riverCell: hydro.riverCell,
    rivers: hydro.rivers,
    fords,
    report: {
      planAttempts: attempt + 1,
      solverAttempts: biomes.attempts,
      solverCost: biomes.cost,
      addedIslets: island.addedIslets,
      heightRepairs: height.repairs,
      smoothedCells: height.smoothed,
    },
  };
}

/** Generates the world plan of a seed and world size (pure, deterministic). */
export function generateWorldPlan(worldSeed: number, preset: WorldSizePreset): WorldPlan {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < PLAN_MAX_ATTEMPTS; attempt++) {
    try {
      return buildPlan(worldSeed, attempt, preset);
    } catch (e) {
      if (!(e instanceof PlanConstraintError)) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new PlanConstraintError('world plan failed');
}

/** Bytes of the typed arrays of the plan plus its JSON part (the < 2 MB budget of WORLD.md §2). */
export function planByteSize(plan: WorldPlan): number {
  let bytes = 0;
  const json = JSON.stringify(plan, (_key, value: unknown) => {
    if (ArrayBuffer.isView(value)) {
      bytes += value.byteLength;
      return null;
    }
    return value;
  });
  return bytes + json.length;
}

/** Determinism hash of the whole plan (FNV-1a 64 over every array and record, fixed order). */
export function worldPlanHash(plan: WorldPlan): string {
  const h = new Fnv1a64();
  h.update(Int32Array.of(plan.version, plan.seed, plan.attempt, plan.grid.tiles, plan.start, plan.core));
  h.update(plan.land).update(plan.landmass).update(plan.cellKind).update(plan.region).update(plan.coastDistance);
  h.update(plan.elevation).update(plan.level).update(plan.lake).update(plan.riverCell);
  h.update(Float64Array.from(plan.regions.flatMap((r) => [r.seedX, r.seedY, r.cells, r.tier, planBiomeIndex(r.biome), r.distance])));
  h.update(Int32Array.from(plan.edges.flatMap((e) => [e.a, e.b, e.border, e.crossing ? 1 : 0])));
  h.update(Int32Array.from(plan.ramps.flatMap((r) => [r.low, r.high, r.dir, r.level, r.kind === 'treppe' ? 1 : 0])));
  for (const r of plan.rivers) {
    h.update(r.cells).update(r.xs).update(r.ys).update(r.width).update(r.level).update(r.elevation);
    const end = r.end.kind === 'meer' ? [0, -1, -1] : r.end.kind === 'see' ? [1, r.end.lake, -1] : [2, r.end.river, r.end.vertex];
    h.update(Int32Array.from([r.kind === 'bach' ? 1 : 0, r.fromLake, ...end]));
  }
  h.update(Float64Array.from(plan.lakes.flatMap((l) => [l.cells, l.level, l.surface])));
  h.update(Float64Array.from(plan.fords.flatMap((f) => [f.river, f.cell, f.vertex, f.x, f.y, f.level])));
  return h.hex();
}
