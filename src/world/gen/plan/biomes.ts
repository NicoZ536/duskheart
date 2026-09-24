/**
 * World plan step 3 (M2-05, M2-06, MASTERPROMPT §9.2.3): biome assignment by constraint solver.
 *
 * Fixed by construction:
 * - start: the southernmost inland region behind the south coast (pulled west by a seeded amount)
 *   is Grünhain at tier 0;
 * - core: the inland region farthest from the start (progression distance) that does not touch the
 *   coastal ring is the Nachtherz (T7); all its neighbours, plus inland pockets only reachable
 *   through them, are Scherbenhain (T6) – the ring around the wound;
 * - the coastal band regions are the Salzküste ring (tier 0–2).
 * Solved: the tiers 0…5 of the other inland regions (0/1 Grünhain, 2 Nebelmoor, 3 Frostkamm,
 * 4 Glutsand, 5 Aschenschlund) and 0…2 of the ring segments. Target tiers follow the jittered graph
 * distance to the start (rank quantiles). Hard rules: every biome at least twice; no skipped tier
 * (every tier 0…7 exists and for every k the regions of tier ≤ k are connected to the start, so no
 * region is only reachable through a harder one and every tier opens after the one below);
 * Frostkamm north of the island centre or high; Glutsand south or east of the centre (not in the
 * north-west quadrant), dry and never next to the Nebelmoor; every Aschenschlund area (connected
 * Aschenschlund regions) next to Frostkamm or Glutsand. Soft costs prefer wet low moors, high
 * Frostkamm and Aschenschlund, dry Glutsand. Search: threshold accepting (no transcendental
 * functions, so every engine takes the same path) with single-tier and swap moves, greedy polish,
 * then a repair that changes whole same-tier areas or neighbouring pairs; a failed attempt retries
 * with fresh jitter (ADR-0021).
 */
import { BIOMES } from '../../../content/biomes';
import type { Rng } from '../../../engine/rng';
import { planRng, type PlanFields } from './fields';
import { cellCenterX, cellCenterY } from './grid';
import { MAIN_LANDMASS } from './island';
import { BIOME_ROLES, BIOME_SOLVER, HEIGHT, WATER } from './params';
import type { RegionMap } from './regions';

/** Surface biomes the plan assigns, in content order. */
export const PLAN_BIOME_IDS: readonly string[] = BIOMES.filter((b) => b.layer === 0).map((b) => b.id);

function biomeRecord(id: string): (typeof BIOMES)[number] {
  const b = BIOMES.find((x) => x.id === id && x.layer === 0);
  if (b === undefined) throw new Error(`World plan: surface biome "${id}" is missing in src/content/biomes.ts`);
  return b;
}

/** Index of a surface biome in `PLAN_BIOME_IDS`. */
export function planBiomeIndex(id: string): number {
  const i = PLAN_BIOME_IDS.indexOf(id);
  if (i < 0) throw new Error(`World plan: "${id}" is not a surface biome`);
  return i;
}

const RING = biomeRecord(BIOME_ROLES.ring);
const CORE = biomeRecord(BIOME_ROLES.core);
const CORE_RING = biomeRecord(BIOME_ROLES.coreRing);
for (const role of Object.values(BIOME_ROLES)) biomeRecord(role);
// Every biome list of the tuning must name surface biomes, and every surface biome needs a height profile.
for (const id of [...HEIGHT.stairBiomes, ...WATER.lakeBiomes, ...WATER.riverlessBiomes, ...WATER.streamBiomes]) planBiomeIndex(id);
for (const id of PLAN_BIOME_IDS) if (!(id in HEIGHT.profiles)) throw new Error(`World plan: no height profile for biome "${id}"`);

/** Highest tier of the surface (Nachtherz). */
export const MAX_TIER = CORE.tierMax;
/** Tier of the core region. */
export const CORE_TIER = CORE.tierMin;
/** Tier of the ring around the core. */
export const CORE_RING_TIER = CORE_RING.tierMin;
/** Lowest and highest tier of a coastal ring region. */
export const RING_TIER_MIN = RING.tierMin;
export const RING_TIER_MAX = RING.tierMax;
/** Highest tier the solver gives an inland region (below the Scherbenhain). */
export const FREE_TIER_MAX = CORE_RING_TIER - 1;

/** Inland biome per tier 0…MAX_TIER (exactly one non-ring surface biome covers each tier). */
export const INLAND_BIOME_BY_TIER: readonly string[] = (() => {
  const out: string[] = [];
  for (let t = 0; t <= MAX_TIER; t++) {
    const matches = BIOMES.filter((b) => b.layer === 0 && b.id !== RING.id && b.tierMin <= t && t <= b.tierMax);
    if (matches.length !== 1) throw new Error(`World plan: tier ${t} needs exactly one inland surface biome, found ${matches.length}`);
    out.push((matches[0] as (typeof BIOMES)[number]).id);
  }
  return out;
})();
/** Share of the free inland regions per tier 0…FREE_TIER_MAX. */
const TIER_SHARES: readonly number[] = Object.values(BIOME_SOLVER.tierShares);
if (TIER_SHARES.length !== FREE_TIER_MAX + 1) throw new Error('World plan: tierShares must cover the free tiers 0…FREE_TIER_MAX');

const TIER_OF: Readonly<Record<string, number>> = Object.fromEntries(INLAND_BIOME_BY_TIER.map((id, t) => [id, t]));
const WET_TIER = TIER_OF[BIOME_ROLES.wet] as number;
const COLD_TIER = TIER_OF[BIOME_ROLES.cold] as number;
const DRY_TIER = TIER_OF[BIOME_ROLES.dry] as number;
const VOLCANIC_TIER = TIER_OF[BIOME_ROLES.volcanic] as number;

/** Climate proxies per cell and per region (inputs of the solver and of the height field). */
export interface Climate {
  /** Mountain relief per cell [0, 1]. */
  readonly relief: Float32Array;
  /** Mean relief per region. */
  readonly regionRelief: Float32Array;
  /** Mean moisture per region. */
  readonly regionMoisture: Float32Array;
  /** Mean position of the main island's land cells [tiles]. */
  readonly centerX: number;
  readonly centerY: number;
}

/** Samples relief and moisture on the plan raster and averages them per region. */
export function computeClimate(map: RegionMap, fields: PlanFields, landmass: Int16Array): Climate {
  const { grid, region, regions } = map;
  const relief = new Float32Array(grid.count);
  const rSum = new Float64Array(regions.length);
  const mSum = new Float64Array(regions.length);
  let cx = 0;
  let cy = 0;
  let mainCells = 0;
  for (let c = 0; c < grid.count; c++) {
    const r = region[c] as number;
    if (r < 0) continue;
    const x = cellCenterX(grid, c);
    const y = cellCenterY(grid, c);
    const rv = fields.reliefAt(x, y);
    const mv = fields.moistureAt(x, y);
    relief[c] = rv;
    rSum[r] = (rSum[r] as number) + rv;
    mSum[r] = (mSum[r] as number) + mv;
    if (landmass[c] === MAIN_LANDMASS) {
      cx += x;
      cy += y;
      mainCells++;
    }
  }
  const regionRelief = new Float32Array(regions.length);
  const regionMoisture = new Float32Array(regions.length);
  for (const r of regions) {
    const n = Math.max(1, r.cells);
    regionRelief[r.id] = (rSum[r.id] as number) / n;
    regionMoisture[r.id] = (mSum[r.id] as number) / n;
  }
  return { relief, regionRelief, regionMoisture, centerX: cx / Math.max(1, mainCells), centerY: cy / Math.max(1, mainCells) };
}

/** Result of step 3. */
export interface BiomeAssignment {
  /** Surface biome id per region. */
  readonly biome: readonly string[];
  /** Tier per region (0…7). */
  readonly tier: Uint8Array;
  /** Progression distance from the start per region [tiles, weighted]. */
  readonly distance: Float64Array;
  /** Start region (Grünhain on the south coast). */
  readonly start: number;
  /** Core region (Nachtherz). */
  readonly core: number;
  /** Solver attempts used. */
  readonly attempts: number;
  /** Final soft cost (no hard rule is violated). */
  readonly cost: number;
}

/** Thrown when no attempt satisfies every hard rule (the plan then tries a new island). */
export class PlanConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanConstraintError';
  }
}

/** Progression distance: Dijkstra over the region graph with centroid distances; ring and sea crossings cost more. */
export function progressionDistance(map: RegionMap, start: number): Float64Array {
  const n = map.regions.length;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  dist[start] = 0;
  const crossing = new Map<number, boolean>();
  for (const e of map.edges) crossing.set(e.a * n + e.b, e.crossing);
  for (let step = 0; step < n; step++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (done[i] === 0 && (dist[i] as number) < best) {
        best = dist[i] as number;
        u = i;
      }
    }
    if (u < 0) break;
    done[u] = 1;
    const ru = map.regions[u];
    if (ru === undefined) break;
    for (const v of map.neighbours[u] as readonly number[]) {
      const rv = map.regions[v];
      if (rv === undefined || done[v] === 1) continue;
      const dx = rv.centroidX - ru.centroidX;
      const dy = rv.centroidY - ru.centroidY;
      let w = Math.sqrt(dx * dx + dy * dy);
      if (rv.kind === 'band') w *= BIOME_SOLVER.ringDistanceFactor;
      if (crossing.get(Math.min(u, v) * n + Math.max(u, v)) === true) w *= BIOME_SOLVER.crossingDistanceFactor;
      if (best + w < (dist[v] as number)) dist[v] = best + w;
    }
  }
  return dist;
}

/** Region graph in compressed sparse rows (allocation-free traversal in the solver). */
export interface RegionGraph {
  /** Neighbours of region r: `targets[offsets[r]] … targets[offsets[r + 1] − 1]`. */
  readonly offsets: Int32Array;
  readonly targets: Int32Array;
}

/** Compressed sparse rows of neighbour lists. */
export function regionGraph(neighbours: readonly (readonly number[])[]): RegionGraph {
  const offsets = new Int32Array(neighbours.length + 1);
  for (let r = 0; r < neighbours.length; r++) offsets[r + 1] = (offsets[r] as number) + (neighbours[r] as readonly number[]).length;
  const targets = new Int32Array(offsets[neighbours.length] as number);
  for (let r = 0; r < neighbours.length; r++) targets.set(neighbours[r] as readonly number[], offsets[r] as number);
  return { offsets, targets };
}

/** Reusable buffers of `unreachableByTier`. */
export interface TierScratch {
  readonly best: Int32Array;
  /** Bucket k occupies `buckets[k × n …]`; each region enters a bucket at most once. */
  readonly buckets: Int32Array;
  readonly fill: Int32Array;
}

/** Buffers for `unreachableByTier` over `n` regions. */
export function createTierScratch(n: number, maxTier: number): TierScratch {
  return { best: new Int32Array(n), buckets: new Int32Array((maxTier + 1) * n), fill: new Int32Array(maxTier + 1) };
}

/**
 * Violations of §9.2.3 "ohne Überspringen": the regions of tier ≤ k must form one connected
 * subgraph containing `start`, for every k. Computes the minimax path tier m(r) from the start
 * (bucket queue over the tiers, O(V + E)); a region with m(r) > t(r) is cut off for the m(r) − t(r)
 * values k ∈ [t(r), m(r)), so the sum of m(r) − t(r) counts every (k, region) violation.
 */
export function unreachableByTier(graph: RegionGraph, tier: ArrayLike<number>, start: number, maxTier: number, scratch?: TierScratch): number {
  const n = graph.offsets.length - 1;
  const s = scratch ?? createTierScratch(n, maxTier);
  const { best, buckets, fill } = s;
  const { offsets, targets } = graph;
  const unset = maxTier + 1;
  best.fill(unset);
  fill.fill(0);
  const t0 = tier[start] as number;
  best[start] = t0;
  buckets[t0 * n] = start;
  fill[t0] = 1;
  for (let k = 0; k <= maxTier; k++) {
    const base = k * n;
    for (let i = 0; i < (fill[k] as number); i++) {
      const u = buckets[base + i] as number;
      if (best[u] !== k) continue;
      const end = offsets[u + 1] as number;
      for (let j = offsets[u] as number; j < end; j++) {
        const v = targets[j] as number;
        const tv = tier[v] as number;
        const m = tv > k ? tv : k;
        if (m < (best[v] as number)) {
          best[v] = m;
          buckets[m * n + (fill[m] as number)] = v;
          fill[m] = (fill[m] as number) + 1;
        }
      }
    }
  }
  let missing = 0;
  for (let r = 0; r < n; r++) missing += (best[r] as number) - (tier[r] as number);
  return missing;
}

/** Tiers 0…maxTier without any region. */
export function missingTiers(tier: ArrayLike<number>, maxTier: number): number {
  const present = new Uint8Array(maxTier + 1);
  for (let i = 0; i < tier.length; i++) present[tier[i] as number] = 1;
  let missing = 0;
  for (let t = 0; t <= maxTier; t++) if (present[t] === 0) missing++;
  return missing;
}

/** Hard rules of the solver (indices into `SolverOut.rules`). */
export const HARD_RULES = ['frostkammNordHoch', 'glutsandSuedOstTrocken', 'glutsandNebelmoor', 'aschenschlundGebirge', 'biomMehrfach', 'stufenZusammenhang', 'stufenVollstaendig'] as const;
const RULE_COLD = 0;
const RULE_DRY = 1;
const RULE_DRY_WET = 2;
const RULE_VOLCANIC = 3;
const RULE_COUNT = 4;
const RULE_CONNECTED = 5;
const RULE_TIERS = 6;

interface SolverOut {
  hard: number;
  readonly rules: Int32Array;
}

interface SolverInput {
  readonly scratch: TierScratch;
  readonly graph: RegionGraph;
  readonly counts: Int32Array;
  readonly cluster: Int32Array;
  readonly queue: Int32Array;
  readonly map: RegionMap;
  readonly climate: Climate;
  readonly start: number;
  readonly fixed: Int8Array; // tier or −1 when free
  readonly target: Float64Array; // τ per region
  readonly isBand: Uint8Array;
  readonly north: Uint8Array;
  readonly southEast: Uint8Array;
}

/** Biome of a region with a given tier. */
function biomeOf(isBand: boolean, tier: number): string {
  return isBand ? BIOME_ROLES.ring : (INLAND_BIOME_BY_TIER[tier] as string);
}

/**
 * Aschenschlund areas (connected inland regions of the volcanic tier) that border neither the
 * Frostkamm nor the Glutsand (§9.2.3 "Aschenschlund angrenzend an Frostkamm- oder Glutsand-Gebirge").
 */
export function isolatedVolcanicAreas(graph: RegionGraph, tier: ArrayLike<number>, isBand: ArrayLike<number>, cluster: Int32Array, queue: Int32Array): number {
  const { offsets, targets } = graph;
  const n = offsets.length - 1;
  cluster.fill(-1);
  let isolated = 0;
  for (let s = 0; s < n; s++) {
    if (cluster[s] !== -1 || isBand[s] === 1 || tier[s] !== VOLCANIC_TIER) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    cluster[s] = s;
    let borders = false;
    while (head < tail) {
      const u = queue[head++] as number;
      for (let j = offsets[u] as number; j < (offsets[u + 1] as number); j++) {
        const v = targets[j] as number;
        if (isBand[v] === 1) continue;
        const tv = tier[v] as number;
        if (tv === COLD_TIER || tv === DRY_TIER) borders = true;
        else if (tv === VOLCANIC_TIER && cluster[v] === -1) {
          cluster[v] = s;
          queue[tail++] = v;
        }
      }
    }
    if (!borders) isolated++;
  }
  return isolated;
}

/** Total cost of a tier vector: soft costs plus `hardCost` per violated rule. Also returns the violation count. */
function evaluate(input: SolverInput, tier: Uint8Array, out: SolverOut): number {
  const { map, climate, isBand, counts } = input;
  const rules = out.rules;
  rules.fill(0);
  const n = map.regions.length;
  let soft = 0;
  counts.fill(0);
  for (let r = 0; r < n; r++) {
    const t = tier[r] as number;
    const d = t - (input.target[r] as number);
    if (input.fixed[r] === -1) soft += BIOME_SOLVER.tierWeight * d * d;
    if (isBand[r] === 1) continue;
    counts[t] = (counts[t] as number) + 1;
    const relief = climate.regionRelief[r] as number;
    const moisture = climate.regionMoisture[r] as number;
    if (t === WET_TIER) {
      soft += BIOME_SOLVER.wetWeight * Math.max(0, BIOME_SOLVER.wetMoisture - moisture) + BIOME_SOLVER.lowlandWeight * relief;
    } else if (t === COLD_TIER) {
      if (input.north[r] === 0 && relief < BIOME_SOLVER.highRelief) rules[RULE_COLD] = (rules[RULE_COLD] as number) + 1;
      soft += BIOME_SOLVER.mountainWeight * (1 - relief);
    } else if (t === DRY_TIER) {
      if (input.southEast[r] === 0 || moisture > BIOME_SOLVER.dryMoisture) rules[RULE_DRY] = (rules[RULE_DRY] as number) + 1;
      for (let j = input.graph.offsets[r] as number; j < (input.graph.offsets[r + 1] as number); j++) {
        const v = input.graph.targets[j] as number;
        if (isBand[v] === 0 && tier[v] === WET_TIER) rules[RULE_DRY_WET] = (rules[RULE_DRY_WET] as number) + 1;
      }
      soft += BIOME_SOLVER.dryWeight * moisture;
    } else if (t === VOLCANIC_TIER) {
      soft += BIOME_SOLVER.mountainWeight * (1 - relief);
    }
  }
  rules[RULE_VOLCANIC] = isolatedVolcanicAreas(input.graph, tier, isBand, input.cluster, input.queue);
  // Every inland biome at least `minRegionsPerBiome` times (Grünhain covers tiers 0 and 1).
  const need = BIOME_SOLVER.minRegionsPerBiome;
  for (let t = 0; t <= FREE_TIER_MAX; t++) {
    // Tiers sharing a biome (Grünhain 0–1) count together, at their first tier.
    if (t > 0 && INLAND_BIOME_BY_TIER[t] === INLAND_BIOME_BY_TIER[t - 1]) continue;
    let c = 0;
    for (let u = t; u <= FREE_TIER_MAX && INLAND_BIOME_BY_TIER[u] === INLAND_BIOME_BY_TIER[t]; u++) c += counts[u] as number;
    if (c < need) rules[RULE_COUNT] = (rules[RULE_COUNT] as number) + need - c;
  }
  rules[RULE_CONNECTED] = unreachableByTier(input.graph, tier, input.start, MAX_TIER, input.scratch);
  rules[RULE_TIERS] = missingTiers(tier, MAX_TIER);
  let hard = 0;
  for (let i = 0; i < rules.length; i++) hard += rules[i] as number;
  out.hard = hard;
  return soft + BIOME_SOLVER.hardCost * hard;
}

/** Continuous target tier per free region from the jittered distance rank. */
function targetTiers(map: RegionMap, dist: Float64Array, fixed: Int8Array, isBand: Uint8Array, rng: Rng): Float64Array {
  const n = map.regions.length;
  const jittered = new Float64Array(n);
  for (let r = 0; r < n; r++) jittered[r] = (dist[r] as number) * (1 + rng.float(-BIOME_SOLVER.distanceJitter, BIOME_SOLVER.distanceJitter));
  const inland: number[] = [];
  for (let r = 0; r < n; r++) if (fixed[r] === -1 && isBand[r] === 0) inland.push(r);
  inland.sort((a, b) => (jittered[a] as number) - (jittered[b] as number) || a - b);
  const shares = TIER_SHARES;
  const tierOfQuantile = (q: number): number => {
    let acc = 0;
    for (let t = 0; t < shares.length; t++) {
      const s = shares[t] as number;
      if (q < acc + s || t === shares.length - 1) return t - 0.5 + Math.min(1, (q - acc) / s);
      acc += s;
    }
    return FREE_TIER_MAX;
  };
  const target = new Float64Array(n);
  const count = inland.length;
  inland.forEach((r, rank) => {
    target[r] = tierOfQuantile((rank + 0.5) / Math.max(1, count));
  });
  for (let r = 0; r < n; r++) {
    if (fixed[r] !== -1) target[r] = fixed[r] as number;
    else if (isBand[r] === 1) {
      // Quantile of the ring segment among the inland distances, capped at the ring's tier range.
      let below = 0;
      for (const q of inland) if ((jittered[q] as number) < (jittered[r] as number)) below++;
      target[r] = Math.min(RING_TIER_MAX, Math.max(RING_TIER_MIN, tierOfQuantile((below + 0.5) / Math.max(1, count))));
    }
  }
  return target;
}

/** Picks the start region: southernmost inland region behind the coastal ring, pulled west by a seeded amount. */
function pickStart(map: RegionMap, rng: Rng): number {
  const main = map.regions.filter((r) => r.landmass === MAIN_LANDMASS);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of main) {
    minX = Math.min(minX, r.centroidX);
    maxX = Math.max(maxX, r.centroidX);
    minY = Math.min(minY, r.centroidY);
    maxY = Math.max(maxY, r.centroidY);
  }
  const pull = rng.float(BIOME_SOLVER.startWestPullMin, BIOME_SOLVER.startWestPullMax);
  let best = -1;
  let bestScore = -Infinity;
  for (const r of main) {
    if (r.kind !== 'interior') continue;
    const ringNeighbour = (map.neighbours[r.id] as readonly number[]).some((v) => map.regions[v]?.kind === 'band');
    if (!ringNeighbour) continue;
    const south = (r.centroidY - minY) / Math.max(1, maxY - minY);
    const west = 1 - (r.centroidX - minX) / Math.max(1, maxX - minX);
    const score = south + pull * west;
    if (score > bestScore) {
      bestScore = score;
      best = r.id;
    }
  }
  if (best < 0) throw new PlanConstraintError('no inland region borders the coastal ring');
  return best;
}

/** Assigns a biome and tier to every region. Throws `PlanConstraintError` when no attempt satisfies all rules. */
export function assignBiomes(worldSeed: number, attempt: number, map: RegionMap, climate: Climate): BiomeAssignment {
  const rng = planRng(worldSeed, attempt, 'biomes');
  const n = map.regions.length;
  const start = pickStart(map, rng);
  const dist = progressionDistance(map, start);
  const isBand = new Uint8Array(n);
  for (const r of map.regions) isBand[r.id] = r.kind === 'band' ? 1 : 0;

  // Core: farthest inland region of the main island that does not touch the ring.
  let core = -1;
  for (const r of map.regions) {
    if (r.kind !== 'interior' || r.landmass !== MAIN_LANDMASS || r.id === start) continue;
    const nb = map.neighbours[r.id] as readonly number[];
    if (nb.length < BIOME_SOLVER.minRegionsPerBiome || nb.includes(start) || nb.some((v) => isBand[v] === 1)) continue;
    if (core < 0 || (dist[r.id] as number) > (dist[core] as number)) core = r.id;
  }
  if (core < 0) throw new PlanConstraintError('no inland region away from the coast can hold the Nachtherz');

  const fixed = new Int8Array(n).fill(-1);
  fixed[start] = 0;
  fixed[core] = CORE_TIER;
  for (const v of map.neighbours[core] as readonly number[]) fixed[v] = CORE_RING_TIER;
  // Pockets only reachable through the Scherbenhain ring belong to the ring.
  const seen = new Uint8Array(n);
  const queue: number[] = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const u = queue.pop() as number;
    for (const v of map.neighbours[u] as readonly number[]) {
      if (seen[v] === 1 || fixed[v] === CORE_RING_TIER || v === core) continue;
      seen[v] = 1;
      queue.push(v);
    }
  }
  for (let r = 0; r < n; r++) {
    if (seen[r] === 1 || fixed[r] !== -1) continue;
    if (isBand[r] === 1) throw new PlanConstraintError('a coastal ring segment lies behind the Scherbenhain');
    fixed[r] = CORE_RING_TIER;
  }

  const north = new Uint8Array(n);
  const southEast = new Uint8Array(n);
  for (const r of map.regions) {
    north[r.id] = r.centroidY < climate.centerY ? 1 : 0;
    southEast[r.id] = r.centroidX > climate.centerX || r.centroidY > climate.centerY ? 1 : 0;
  }
  const free: number[] = [];
  for (let r = 0; r < n; r++) if (fixed[r] === -1) free.push(r);
  const freeBand = free.filter((r) => isBand[r] === 1);
  const freeInland = free.filter((r) => isBand[r] === 0);
  const hi = (r: number): number => (isBand[r] === 1 ? RING_TIER_MAX : FREE_TIER_MAX);
  const lo = (r: number): number => (isBand[r] === 1 ? RING_TIER_MIN : 0);
  const out: SolverOut = { hard: 0, rules: new Int32Array(HARD_RULES.length) };
  const scratch = createTierScratch(n, MAX_TIER);
  const graph = regionGraph(map.neighbours);
  const counts = new Int32Array(MAX_TIER + 1);

  for (let solverAttempt = 1; solverAttempt <= BIOME_SOLVER.attempts; solverAttempt++) {
    const target = targetTiers(map, dist, fixed, isBand, rng);
    const input: SolverInput = { scratch, graph, counts, cluster: new Int32Array(n), queue: new Int32Array(n), map, climate, start, fixed, target, isBand, north, southEast };
    const tier = new Uint8Array(n);
    for (let r = 0; r < n; r++) tier[r] = fixed[r] !== -1 ? (fixed[r] as number) : Math.min(hi(r), Math.max(lo(r), Math.round(target[r] as number)));
    let cost = evaluate(input, tier, out);
    let best = tier.slice();
    let bestCost = cost;
    const iterations = BIOME_SOLVER.iterationsPerRegion * free.length;
    for (let i = 0; i < iterations && free.length > 0; i++) {
      const threshold = BIOME_SOLVER.startThreshold * (1 - i / iterations);
      if (rng.bool(BIOME_SOLVER.swapShare)) {
        const pool = rng.bool(freeInland.length / Math.max(1, free.length)) ? freeInland : freeBand;
        if (pool.length < 2) continue;
        const a = pool[rng.int(0, pool.length)] as number;
        const b = pool[rng.int(0, pool.length)] as number;
        if (tier[a] === tier[b]) continue;
        const ta = tier[a] as number;
        tier[a] = tier[b] as number;
        tier[b] = ta;
        const c = evaluate(input, tier, out);
        if (c <= cost + threshold) cost = c;
        else {
          tier[b] = tier[a] as number;
          tier[a] = ta;
        }
      } else {
        const r = free[rng.int(0, free.length)] as number;
        const old = tier[r] as number;
        const span = hi(r) - lo(r);
        if (span === 0) continue;
        const next = lo(r) + ((old - lo(r) + rng.int(1, span + 1)) % (span + 1));
        tier[r] = next;
        const c = evaluate(input, tier, out);
        if (c <= cost + threshold) cost = c;
        else tier[r] = old;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = tier.slice();
      }
    }
    // Greedy polish of the best state.
    tier.set(best);
    cost = bestCost;
    for (let improved = true; improved; ) {
      improved = false;
      for (const r of free) {
        const old = tier[r] as number;
        for (let t = lo(r); t <= hi(r); t++) {
          if (t === old) continue;
          tier[r] = t;
          const c = evaluate(input, tier, out);
          if (c < cost) {
            cost = c;
            improved = true;
            break;
          }
          tier[r] = old;
        }
      }
    }
    evaluate(input, tier, out);
    // Repair: a rule that needs several regions to change at once is out of reach of single moves.
    // Try every neighbouring pair (e.g. a new Glutsand region and its Nebelmoor neighbour) and
    // every connected same-tier area as a whole (e.g. a volcanic pocket that must become moor).
    for (let round = 0; out.hard > 0 && round < BIOME_SOLVER.pairRepairRounds; round++) {
      let improved = false;
      const areaOf = new Int32Array(n).fill(-1);
      for (const r of free) {
        if (areaOf[r] !== -1 || improved) continue;
        const area = [r];
        areaOf[r] = r;
        for (let i = 0; i < area.length; i++) {
          for (const v of map.neighbours[area[i] as number] as readonly number[]) {
            if (areaOf[v] === -1 && fixed[v] === -1 && isBand[v] === isBand[r] && tier[v] === tier[r]) {
              areaOf[v] = r;
              area.push(v);
            }
          }
        }
        if (area.length < 2) continue;
        const old = tier[r] as number;
        for (let t = lo(r); t <= hi(r) && !improved; t++) {
          if (t === old) continue;
          for (const v of area) tier[v] = t;
          const c = evaluate(input, tier, out);
          if (c < cost) {
            cost = c;
            improved = true;
          } else for (const v of area) tier[v] = old;
        }
      }
      for (const r of free) {
        if (improved) break;
        const oldR = tier[r] as number;
        for (const q of map.neighbours[r] as readonly number[]) {
          if (fixed[q] !== -1) continue;
          const oldQ = tier[q] as number;
          for (let tr = lo(r); tr <= hi(r) && !improved; tr++) {
            for (let tq = lo(q); tq <= hi(q) && !improved; tq++) {
              if (tr === oldR && tq === oldQ) continue;
              tier[r] = tr;
              tier[q] = tq;
              const c = evaluate(input, tier, out);
              if (c < cost) {
                cost = c;
                improved = true;
              } else {
                tier[r] = oldR;
                tier[q] = oldQ;
              }
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      evaluate(input, tier, out);
      if (!improved) break;
    }
    if (out.hard === 0) {
      const biome = map.regions.map((r) => biomeOf(isBand[r.id] === 1, tier[r.id] as number));
      return { biome, tier, distance: dist, start, core, attempts: solverAttempt, cost };
    }
  }
  const broken = HARD_RULES.filter((_, i) => (out.rules[i] as number) > 0).join(', ');
  throw new PlanConstraintError(`biome rules unsatisfiable after ${BIOME_SOLVER.attempts} attempts (${out.hard} violations: ${broken})`);
}
