/**
 * World generation (docs/WORLD.md §2 step 1, MASTERPROMPT §9.2 steps 1–9, M2-10 … M2-14): builds the
 * whole description of a world from (seed, size) – pure, deterministic and structured-cloneable,
 * so the worker can build it and hand it to the main thread, and the chunk generator
 * (`chunk.ts`) can realise any chunk of any layer from it.
 *
 * Steps (progress events in this order, `WORLD_GEN_STEPS`):
 * 1. `weltplan` – island, regions, biomes, height, water (src/world/gen/plan, steps 1–6).
 * 2. `schluesselorte` – start beach, Nachtherz with the finale arena, six beacon sites with arenas.
 * 3. `strassen` – decayed Builder roads between the sites.
 * 4. `erreichbarkeit` – reachability of every cell from the start beach; ramps, fords and bridges
 *    inserted where needed (the plan is extended by the new ramps and fords).
 * 5. `orte` – bridge ruins and the other places (§21); then one content layout per slot whose type and biome have one
 *    (`placeLayouts`, src/world/gen/places, M7-07: a pure function of seed, slot and content; bridge heads reserved like
 *    discs), stamped into the surface chunks by the chunk generator.
 * 6. `untergrund` – cave network of the layers −1 … −3 (src/world/gen/underground) from filtered
 *    entrance proposals; a cave mouth place per accepted entrance.
 * 7. `ressourcen` – deposits with the local re-scatter of missing amounts per tier.
 * 8. `pruefung` – final checks: every region reachable, every site with an arena, roads connect the
 *    sites, minimum resources per tier; problems and repair counters in the report.
 */
import type { WorldSizePreset } from '../../content/balance';
import { Fnv1a64 } from '../../engine/binary';
import { normalizeSeed } from '../../engine/rng';
import { chunkHash } from '../model/chunk';
import { worldDimensions } from '../model/worldSize';
import { cellAtTile } from './plan/grid';
import { HEIGHT } from './plan/params';
import { createTerrainSample, generateWorldPlan, PLAN_VERSION, worldPlanHash, type PlanReport, type WorldPlan } from './plan/index';
import { createUndergroundPlan, proposeEntranceCandidates, undergroundPlanHash, type UndergroundPlan } from './underground/index';
import { TileWindow } from './chunkWindow';
import { generateChunk } from './chunk';
import {
  createCellInfo,
  filterCaveCandidates,
  LocationPlacer,
  LOCATION_TYPES,
  placeCaveMouths,
  placeKeySites,
  placeSecondary,
  slotCellMask,
  slotDiscs,
  type LocationSlot,
  type LocationType,
} from './locations';
import { placeResources, type DepositDensity, type ResourcePlan, type ResourceTally } from './resources';
import { buildRoads, rampDirections, roadCellMask, roadSegments, type RoadNetwork } from './roads';
import { bridgeSegments, checkStructure, createReachModel, placeBridgeRuins, reachFrom, repairReachability, VALIDATION, type Bridge } from './validate';
import { createReservations, createSurfaceContext, surfaceContextOf, type ReservedDisc, type SurfaceContext } from './worldContext';
import { contentPlaceLayouts, extraPlaceDiscs, selectPlaceLayouts, stampRight, STAMP_NONE, type PlacePlacement, type StampTest } from './places/index';

/**
 * Version of the world generator (steps 7–9 and the chunk generator); part of the world hash. 2 (M7-07): the places'
 * layouts are chosen in the step `orte` and stamped into the surface chunks; saves of version 1 load with `generatorChanged`
 * (their saved tiles keep their values, docs/SPIEL.md §18).
 */
export const WORLD_GEN_VERSION = 2;

/** Generation steps in order (progress events). */
export const WORLD_GEN_STEPS = ['weltplan', 'schluesselorte', 'strassen', 'erreichbarkeit', 'orte', 'untergrund', 'ressourcen', 'pruefung'] as const;
/** One generation step. */
export type WorldGenStep = (typeof WORLD_GEN_STEPS)[number];

/** Progress of a running generation: the step that starts now. */
export interface WorldGenProgress {
  readonly step: WorldGenStep;
  /** Index of the step (0 … count − 1). */
  readonly index: number;
  readonly count: number;
}

/** Validation and repair report (WORLD.md §2 "Validierungs- und Reparaturbericht"). */
export interface WorldReport {
  /** Counters of the world plan (attempts, solver, height repairs). */
  readonly plan: PlanReport;
  readonly reachability: {
    /** Walkable main-island cells unreachable before and after the repair. */
    readonly unreachableBefore: number;
    readonly unreachableAfter: number;
    readonly rampsAdded: number;
    readonly fordsAdded: number;
    readonly bridgesAdded: number;
    readonly rounds: number;
    /** Regions only reachable by raft (offshore islets). */
    readonly raftRegions: number;
  };
  readonly locations: {
    readonly total: number;
    /** Key sites that could not be placed. */
    readonly keyMissing: readonly string[];
    /** Wanted and placed count per secondary type. */
    readonly counts: Readonly<Partial<Record<LocationType, { readonly wanted: number; readonly placed: number }>>>;
    readonly caveMouths: number;
    readonly bridgeRuins: number;
  };
  readonly roads: {
    readonly count: number;
    readonly lengthTiles: number;
    readonly crossings: number;
    readonly connected: boolean;
  };
  readonly resources: {
    readonly deposits: number;
    readonly nodes: number;
    /** Deposits added by the local re-scatter. */
    readonly rescattered: number;
    /** Node counts per object and tier with their minimum. */
    readonly tallies: readonly ResourceTally[];
  };
  /** All repairs: ramps, fords, bridges, re-scattered deposits. */
  readonly repairs: number;
  /** Failed checks (empty = the world is valid). */
  readonly problems: readonly string[];
}

/** A generated world. */
export interface GeneratedWorld {
  readonly version: number;
  /** World seed (u32). */
  readonly seed: number;
  readonly preset: WorldSizePreset;
  /** World plan extended by the inserted ramps and fords. */
  readonly plan: WorldPlan;
  readonly locations: readonly LocationSlot[];
  /** The layout of every slot that has one (slot order; M7-07, docs/SPIEL.md §18). */
  readonly placeLayouts: readonly PlacePlacement[];
  readonly roads: RoadNetwork;
  /** Inserted bridges and bridge ruins. */
  readonly bridges: readonly Bridge[];
  readonly resources: ResourcePlan;
  readonly underground: UndergroundPlan;
  /** Spawn tile: centre of the start beach (§11.4 M3-08 "Startstrand"). */
  readonly spawn: { readonly x: number; readonly y: number };
  readonly report: WorldReport;
  /** Resource density of the step `ressourcen` (M7-51); absent = `normal` (the world before M7, the same hash). */
  readonly resourceDensity?: DepositDensity;
}

/** Window size of the resource placement [tiles]: the largest deposit window. */
const RESOURCE_WINDOW_TILES = 40;

/** Reservations of the placed features (`extra`: the discs of places standing outside their slot, `extraPlaceDiscs`). */
function reservationsOf(seed: number, plan: WorldPlan, slots: readonly LocationSlot[], roads: RoadNetwork, bridges: readonly Bridge[], extra: readonly ReservedDisc[] = []) {
  return createReservations(seed, plan.grid, { discs: [...slotDiscs(slots), ...extra], roads: roadSegments(roads), bridges: bridgeSegments(bridges) });
}

/** The stamping rule of the places over the generated tiles of `ctx` (the chunk generator applies the same, src/world/gen/places/stamp.ts). */
function placeStampTest(ctx: SurfaceContext, reservations: ReturnType<typeof reservationsOf>): StampTest {
  const sample = createTerrainSample();
  const tiles = ctx.grid.tiles;
  return (tx, ty, level) => {
    if (tx < 0 || ty < 0 || tx >= tiles || ty >= tiles) return STAMP_NONE;
    const s = ctx.terrain.sample(tx, ty, sample);
    return stampRight(s.land, s.level, level, s.water, s.flags, s.land ? reservations.at(tx, ty, s.level) : 0, s.land && ctx.lavaAt(tx, ty));
  };
}

/**
 * Generates a world (pure and deterministic); `onProgress` is told about every step before it starts.
 * `basePlan` may hand in the world plan of (seed, size) exactly as `generateWorldPlan` returned it (not
 * the extended `GeneratedWorld.plan`), e.g. when a simulation built it earlier for its weather; the
 * result is the same world. `resourceDensity` (M7-51) scales the deposits of the step `ressourcen`; `normal` is the world
 * before M7.
 */
export function generateWorld(worldSeed: number, preset: WorldSizePreset, onProgress?: (p: WorldGenProgress) => void, basePlan?: WorldPlan, resourceDensity: DepositDensity = 'normal'): GeneratedWorld {
  const seed = normalizeSeed(worldSeed);
  const count = WORLD_GEN_STEPS.length;
  const step = (s: WorldGenStep): void => onProgress?.({ step: s, index: WORLD_GEN_STEPS.indexOf(s), count });
  if (basePlan !== undefined && (basePlan.seed !== seed || basePlan.preset !== preset || basePlan.version !== PLAN_VERSION)) {
    throw new RangeError(`generateWorld: the plan (seed ${basePlan.seed}, ${basePlan.preset}, version ${basePlan.version}) is not the plan of seed ${seed}, ${preset}`);
  }

  step('weltplan');
  const plan0 = basePlan ?? generateWorldPlan(seed, preset);
  const ctx0 = createSurfaceContext(plan0);
  const cells0 = createCellInfo(ctx0);

  step('schluesselorte');
  const keyPlacer = new LocationPlacer(ctx0, cells0, null);
  const key = placeKeySites(keyPlacer);
  const sites = keyPlacer.slots.filter((s) => s.type === 'leuchtfeuer' || s.type === 'nachtherz');

  step('strassen');
  const roads = buildRoads(ctx0, cells0, sites, slotCellMask(plan0.grid, keyPlacer.slots), HEIGHT.rampDepthTiles / 2);

  step('erreichbarkeit');
  const startSlot = keyPlacer.slots.find((s) => s.type === 'startstrand');
  const startRegion = plan0.regions[plan0.start];
  const spawn = startSlot !== undefined ? { x: startSlot.x, y: startSlot.y } : { x: Math.floor(startRegion?.centroidX ?? 0), y: Math.floor(startRegion?.centroidY ?? 0) };
  const root = cellAtTile(plan0.grid, spawn.x + 0.5, spawn.y + 0.5);
  const avoid = slotCellMask(plan0.grid, keyPlacer.slots);
  roadCellMask(plan0.grid, roads).forEach((v, c) => {
    if (v === 1) avoid[c] = 1;
  });
  const model0 = createReachModel(ctx0, cells0, roads, [], rampDirections(ctx0));
  const repair = repairReachability(ctx0, cells0, model0, root, avoid, 0);
  const plan: WorldPlan = { ...plan0, ramps: [...plan0.ramps, ...repair.ramps], fords: [...plan0.fords, ...repair.fords] };
  // The world's plan: its context is the one the chunk generator of this world object reads (`surfaceContextOf`).
  const ctx = surfaceContextOf(plan);
  const cells = createCellInfo(ctx);

  step('orte');
  const bridges: Bridge[] = [...repair.bridges];
  const placer = new LocationPlacer(ctx, cells, reservationsOf(seed, plan, keyPlacer.slots, roads, bridges), keyPlacer.slots);
  const ruins = placeBridgeRuins(ctx, placer, preset, bridges, roads, bridges.length, createReachModel(ctx, cells, roads, bridges, rampDirections(ctx)), root);
  bridges.push(...ruins);
  placer.setReservations(reservationsOf(seed, plan, placer.slots, roads, bridges));
  const roadCells = roadCellMask(plan.grid, roads);
  const secondary = placeSecondary(placer, preset, roadCells);
  // The places' layouts (M7-07); bridge heads outside their slot's disc are reserved for the later steps.
  const placeLayouts = selectPlaceLayouts(seed, placer.slots, contentPlaceLayouts().values(), bridges, placeStampTest(ctx, reservationsOf(seed, plan, placer.slots, roads, bridges)));
  const placeDiscs = extraPlaceDiscs(placeLayouts);
  placer.setReservations(reservationsOf(seed, plan, placer.slots, roads, bridges, placeDiscs));

  step('untergrund');
  const extent = { cellTiles: plan.grid.cellTiles, width: plan.grid.width, height: plan.grid.height, mask: plan.land };
  const proposals = proposeEntranceCandidates(seed, preset, extent);
  const reachModel = createReachModel(ctx, cells, roads, bridges, rampDirections(ctx));
  const reached = reachFrom(reachModel, root);
  const entranceCandidates = filterCaveCandidates(placer, proposals, (tx, ty) => {
    const c = cellAtTile(plan.grid, tx + 0.5, ty + 0.5);
    return reached[c] === 1 && reachModel.barrier[c] !== 1;
  });
  const underground = createUndergroundPlan({ seed, preset, entranceCandidates, extent });
  const caveMouths = placeCaveMouths(
    placer,
    underground.links.filter((l) => l.kind === 'eingang'),
  );

  step('ressourcen');
  const reservations = reservationsOf(seed, plan, placer.slots, roads, bridges, placeDiscs);
  const win = new TileWindow(ctx, reservations, RESOURCE_WINDOW_TILES, RESOURCE_WINDOW_TILES);
  const resources = placeResources(plan, cells, win, resourceDensity);

  step('pruefung');
  const model = createReachModel(ctx, cells, roads, bridges, rampDirections(ctx));
  const structure = checkStructure(plan, model, root, placer.slots, roads);
  const problems: string[] = [];
  if (startSlot === undefined) problems.push('Startstrand fehlt');
  for (const m of key.missing) problems.push(`Schlüsselort fehlt: ${m}`);
  for (const m of structure.missingSites) problems.push(`Stätte fehlt: ${m}`);
  for (const id of structure.sitesWithoutArena) problems.push(`Stätte ohne Boss-Arena: Ort ${id}`);
  for (const r of structure.unreachableRegions) problems.push(`Region ${r} nicht erreichbar`);
  for (const id of structure.unreachableSlots) problems.push(`Ort ${id} (${placer.slots[id]?.type ?? '?'}) nicht erreichbar`);
  if (!structure.roadsConnected) problems.push('Straßennetz verbindet nicht alle Stätten');
  for (const t of resources.tallies) if (t.after < t.min) problems.push(`Ressource ${t.object} auf Stufe ${t.tier}: ${t.after} < ${t.min}`);
  const counts = { ...secondary.counts, brueckenruine: { wanted: VALIDATION.ruins[preset], placed: ruins.length } };
  for (const [type, c] of Object.entries(counts)) if (c.placed < c.wanted) problems.push(`Ort ${type}: ${c.placed} von ${c.wanted}`);
  if (repair.unreachableAfter > 0) problems.push(`${repair.unreachableAfter} Zellen nicht erreichbar`);

  let nodes = 0;
  for (const d of resources.plan.deposits) nodes += d.count;
  const report: WorldReport = {
    plan: plan0.report,
    reachability: {
      unreachableBefore: repair.unreachableBefore,
      unreachableAfter: repair.unreachableAfter,
      rampsAdded: repair.ramps.length,
      fordsAdded: repair.fords.length,
      bridgesAdded: repair.bridges.length,
      rounds: repair.rounds,
      raftRegions: structure.raftRegions.length,
    },
    locations: { total: placer.slots.length, keyMissing: key.missing, counts, caveMouths, bridgeRuins: ruins.length },
    roads: { count: roads.roads.length, lengthTiles: roads.lengthTiles, crossings: roads.crossings.length, connected: roads.connected },
    resources: { deposits: resources.plan.deposits.length, nodes, rescattered: resources.rescattered, tallies: resources.tallies },
    repairs: repair.ramps.length + repair.fords.length + repair.bridges.length + resources.rescattered,
    problems,
  };
  return { version: WORLD_GEN_VERSION, seed, preset, plan, locations: placer.slots.slice(), placeLayouts, roads, bridges, resources: resources.plan, underground, spawn, report, ...(resourceDensity === 'normal' ? {} : { resourceDensity }) };
}

/** Surface context of a finished world (samplers of the extended plan). */
export function worldSurfaceContext(world: GeneratedWorld): SurfaceContext {
  return surfaceContextOf(world.plan);
}

function updateString(h: Fnv1a64, s: string): void {
  const codes = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) codes[i] = s.charCodeAt(i);
  h.update(codes);
}

/** Determinism hash of a world description (plan, places, roads, bridges, deposits, underground, report). */
export function worldHash(world: GeneratedWorld): string {
  const h = new Fnv1a64();
  h.update(Int32Array.of(world.version, world.seed, world.spawn.x, world.spawn.y));
  updateString(h, world.preset);
  updateString(h, worldPlanHash(world.plan));
  h.update(Int32Array.from(world.locations.flatMap((s) => [s.id, LOCATION_TYPES.indexOf(s.type), s.x, s.y, s.radius, s.level, s.region, s.tier, s.landmass, s.link])));
  updateString(h, world.locations.map((s) => s.variant).join('|'));
  h.update(Int32Array.from(world.placeLayouts.flatMap((p) => [p.slot, p.rotation, p.mirror ? 1 : 0, p.x0, p.y0, p.width, p.height, p.markers.length])));
  updateString(h, world.placeLayouts.map((p) => `${p.layout}:${p.markers.map((m) => `${m.mark}@${m.tx},${m.ty}=${m.data}`).join(';')}`).join('|'));
  for (const r of world.roads.roads) h.update(r.cells).update(r.xs).update(r.ys).update(r.levelMin).update(r.levelMax);
  h.update(Float64Array.from(world.bridges.flatMap((b) => [b.id, b.river, b.cell, b.x0, b.y0, b.x1, b.y1, b.level, b.kind === 'ruine' ? 1 : 0])));
  const res = world.resources;
  updateString(h, res.objects.join('|'));
  h.update(res.nodeX).update(res.nodeY).update(res.nodeObject).update(res.bucketStart).update(res.bucketItems);
  updateString(h, undergroundPlanHash(world.underground));
  if (world.resourceDensity !== undefined) updateString(h, world.resourceDensity);
  updateString(h, JSON.stringify(world.report));
  return h.hex();
}

/**
 * Hash of every surface chunk (WORLD.md §2 "Determinismus-Test"): chunk hashes in a fixed order
 * (row major), whatever order `order` generates them in (default row major).
 */
export function surfaceChunksHash(world: GeneratedWorld, order?: readonly number[]): string {
  const chunks = worldDimensions(world.preset).chunks;
  const hashes: string[] = new Array<string>(chunks * chunks);
  const ids = order ?? Array.from({ length: chunks * chunks }, (_, i) => i);
  for (const id of ids) hashes[id] = chunkHash(generateChunk(world, 0, id % chunks, Math.floor(id / chunks)));
  const h = new Fnv1a64();
  for (let i = 0; i < hashes.length; i++) updateString(h, hashes[i] ?? '');
  return h.hex();
}
