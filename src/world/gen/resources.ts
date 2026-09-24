/**
 * World generation step 7, part 1 (M2-10, MASTERPROMPT §9.2.7, §9.3, §14): resource deposits.
 *
 * Every world object of a surface biome is either scattered per chunk (`vegetation.ts`: forest
 * trees, rocks, common plants, ground scatter) or placed here as a deposit: a cluster of nodes
 * decided at plan time with exact tile positions, so the amounts are known before any chunk exists.
 * Deposits are the ores (`erz_*`), crystals, bushes, the gathered plants and the fruit trees.
 *
 * - "Blue-Noise + Cluster": deposits are drawn per region (density per plan cell of the region);
 *   the nodes of a deposit spread around its centre; the ambient scatter uses blue noise.
 * - "Erze nach Stufe, Höhe und Ebene": an ore occurs in the regions of its biomes (src/content/ores.ts),
 *   so its tier follows the biome's tier; deposit centres prefer the heights of their region
 *   (`heightBias`, relative to the region's lowest level, so flat regions keep their share); the
 *   underground ores are veins of the cave generator (src/world/gen/underground, layer −1 … −3).
 * - Every node sits on a free tile of its deposit's level whose dithered biome lists the object
 *   (what the chunk shows there); blocking nodes keep a ring of open ground around them, so they
 *   never cut a path (`chunkWindow.ts`).
 * - Validation (§9.2.9 "Mindestmengen jeder Ressource pro Stufe, sonst lokal nachstreuen"): for
 *   every tier, every deposit object of a biome present at that tier needs `minPerTier` nodes in the
 *   regions of that tier; missing amounts are re-scattered in those regions (`rescatter`).
 */
import { BIOMES } from '../../content/biomes';
import { WORLD_OBJECTS, worldObjectSchema, type WorldObject } from '../../content/worldObjects';
import { Rng } from '../../engine/rng';
import { CHUNK_SIZE } from '../model/coords';
import { MAX_LEVEL, PLAN_BIOME_IDS, type WorldPlan } from './plan/index';
import { blockingFits, OCC_BLOCK, OCC_LOOSE, OCC_NONE, type TileWindow } from './chunkWindow';
import type { CellInfo } from './locations';
import { genSeed } from './worldContext';

/** Kind of a deposit rule. */
export type DepositKind = 'erz' | 'kristall' | 'busch' | 'pflanze' | 'obstbaum';

/** Parameters of one deposit kind. */
interface DepositRule {
  /** Nodes per deposit [count range]. */
  readonly nodesMin: number;
  readonly nodesMax: number;
  /** Spread of the nodes around the centre [tiles]. */
  readonly radius: number;
  /** Deposits per 1000 plan cells of a region, per object [deposits]. */
  readonly perThousandCells: number;
  /** Nodes every tier needs of each object of this kind [nodes]. */
  readonly minPerTier: number;
  /** Preference of deposit centres for the heights of their region: weight 1 + bias × (level − lowest level of the region) [factor per level]. */
  readonly heightBias: number;
}

export const RESOURCES = {
  kinds: {
    /** Ore nodes: 3–6 per vein outcrop; ≈ 170 copper nodes in a Mittel Grünhain, at least 24 per tier (a tool set and some bronze). Outcrops in the hills: one level up is 3× as likely. */
    erz: { nodesMin: 3, nodesMax: 6, radius: 5, perThousandCells: 8, minPerTier: 24, heightBias: 2 },
    /** Crystal groups of the high biomes, a little more often on the heights. */
    kristall: { nodesMin: 2, nodesMax: 5, radius: 4, perThousandCells: 7, minPerTier: 12, heightBias: 1 },
    /** Berry and fibre bushes in patches. */
    busch: { nodesMin: 3, nodesMax: 7, radius: 5, perThousandCells: 10, minPerTier: 16, heightBias: 0 },
    /** Herbs, mushrooms, blossoms in patches. */
    pflanze: { nodesMin: 4, nodesMax: 9, radius: 5, perThousandCells: 10, minPerTier: 16, heightBias: 0 },
    /** Fruit tree groves (§14 "Obstbäume"). */
    obstbaum: { nodesMin: 3, nodesMax: 6, radius: 7, perThousandCells: 4, minPerTier: 10, heightBias: 0 },
  } satisfies Record<DepositKind, DepositRule>,
  /** Fruit trees: deposits, not forest (§14 "Obstbäume (Apfel, Kirsche, Birne, Walnuss)"). */
  fruitTrees: ['baum_apfelbaum', 'baum_kirschbaum', 'baum_birnbaum', 'baum_walnussbaum'],
  /** Plants of the ambient scatter (everywhere in their biome, not in patches). */
  ambientPlants: ['pflanze_fasergras', 'pflanze_strandhafer', 'pflanze_schilf', 'pflanze_kaktus'],
  /** Centre positions tried per deposit [attempts]. */
  centreAttempts: 16,
  /** Node positions tried per wanted node [attempts]. */
  nodeAttempts: 6,
  /** Deposits tried per missing node block when re-scattering [attempts per deposit]. */
  rescatterAttemptsPerDeposit: 8,
  /** Window margins around a deposit for the ring and cliff-face rules [tiles]: west/east, south, north. */
  windowMarginSide: 4,
  windowMarginSouth: 3,
  windowMarginNorth: 7,
} as const;

// ---------------------------------------------------------------------------------------------
// Classification of the content
// ---------------------------------------------------------------------------------------------

/** Surface biome ids. */
const SURFACE: ReadonlySet<string> = new Set(BIOMES.filter((b) => b.layer === 0).map((b) => b.id));

/** Parsed world objects by id. */
export const OBJECTS_BY_ID: ReadonlyMap<string, WorldObject> = new Map(WORLD_OBJECTS.map((o) => [o.id, worldObjectSchema.parse(o)]));

/** Deposit kind of a world object, or null when it is scattered per chunk. */
export function depositKind(o: WorldObject): DepositKind | null {
  if (!o.biomes.some((b) => SURFACE.has(b))) return null;
  switch (o.kind) {
    case 'erz':
    case 'kristall':
    case 'busch':
      return o.kind;
    case 'pflanze':
      return (RESOURCES.ambientPlants as readonly string[]).includes(o.id) ? null : 'pflanze';
    case 'baum':
      return (RESOURCES.fruitTrees as readonly string[]).includes(o.id) ? 'obstbaum' : null;
    case 'fels':
    case 'deko':
      return null;
  }
}

/** Deposit objects of the surface, sorted by id. */
export const DEPOSIT_OBJECTS: readonly string[] = [...OBJECTS_BY_ID.values()]
  .filter((o) => depositKind(o) !== null)
  .map((o) => o.id)
  .sort();

// ---------------------------------------------------------------------------------------------
// Plan data
// ---------------------------------------------------------------------------------------------

/** One deposit. */
export interface ResourceDeposit {
  readonly id: number;
  /** Index into `ResourcePlan.objects`. */
  readonly object: number;
  readonly region: number;
  readonly tier: number;
  /** Centre tile. */
  readonly x: number;
  readonly y: number;
  readonly level: number;
  /** Nodes `first … first + count − 1`. */
  readonly first: number;
  readonly count: number;
  /** Whether the validation added it (local re-scatter). */
  readonly rescatter: boolean;
}

/** The deposits of a world with their nodes, bucketed per chunk. */
export interface ResourcePlan {
  /** Object ids (`DEPOSIT_OBJECTS`). */
  readonly objects: readonly string[];
  readonly deposits: readonly ResourceDeposit[];
  /** Node anchor tiles and object (index into `objects`). */
  readonly nodeX: Uint16Array;
  readonly nodeY: Uint16Array;
  readonly nodeObject: Uint16Array;
  /** Chunks per world edge. */
  readonly chunks: number;
  /** Nodes of chunk (cx, cy) = `bucketItems[bucketStart[cy × chunks + cx] … bucketStart[… + 1] − 1]`. */
  readonly bucketStart: Int32Array;
  readonly bucketItems: Int32Array;
}

/** A minimum amount the validation checks. */
export interface ResourceRequirement {
  readonly object: string;
  readonly tier: number;
  readonly min: number;
}

/** Amount of a requirement before and after re-scattering. */
export interface ResourceTally extends ResourceRequirement {
  readonly before: number;
  readonly after: number;
}

/** Result of the resource step. */
export interface ResourceResult {
  readonly plan: ResourcePlan;
  readonly tallies: readonly ResourceTally[];
  /** Deposits added by the re-scatter. */
  readonly rescattered: number;
}

/** Minimum amounts per tier: every deposit object of a biome that has a region of that tier. */
export function resourceRequirements(plan: WorldPlan): ResourceRequirement[] {
  const byTier = new Map<number, Set<string>>();
  for (const r of plan.regions) {
    const set = byTier.get(r.tier) ?? new Set<string>();
    set.add(r.biome);
    byTier.set(r.tier, set);
  }
  const out: ResourceRequirement[] = [];
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const biomes = byTier.get(tier) as Set<string>;
    for (const id of DEPOSIT_OBJECTS) {
      const o = OBJECTS_BY_ID.get(id) as WorldObject;
      if (!o.biomes.some((b) => biomes.has(b))) continue;
      out.push({ object: id, tier, min: RESOURCES.kinds[depositKind(o) as DepositKind].minPerTier });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

interface Draft {
  object: number;
  region: number;
  tier: number;
  x: number;
  y: number;
  level: number;
  nodes: number[];
  rescatter: boolean;
}

/** Resolved object data for placement. */
interface ObjectInfo {
  readonly id: string;
  readonly rule: DepositRule;
  readonly blocking: boolean;
  readonly fw: number;
  readonly fh: number;
  /** 1 per plan biome index the object grows in. */
  readonly biomeMask: Uint8Array;
}

/** Deposit placer over a tile window. */
class DepositPlacer {
  readonly drafts: Draft[] = [];
  /** Occupancy of tiles by deposit nodes (key ty × tiles + tx). */
  readonly occupied = new Map<number, number>();
  private readonly infos: ObjectInfo[];
  private readonly regionCells: Int32Array[];
  /** Lowest and highest level of the walkable cells per region. */
  private readonly regionMin: Uint8Array;
  private readonly regionMax: Uint8Array;
  private readonly tiles: number;

  constructor(
    readonly plan: WorldPlan,
    readonly cells: CellInfo,
    readonly win: TileWindow,
  ) {
    this.tiles = plan.grid.tiles;
    this.infos = DEPOSIT_OBJECTS.map((id) => {
      const o = OBJECTS_BY_ID.get(id) as WorldObject;
      const biomeMask = new Uint8Array(PLAN_BIOME_IDS.length);
      for (const b of o.biomes) {
        const i = PLAN_BIOME_IDS.indexOf(b);
        if (i >= 0) biomeMask[i] = 1;
      }
      return { id, rule: RESOURCES.kinds[depositKind(o) as DepositKind], blocking: o.blocking, fw: o.footprint.w, fh: o.footprint.h, biomeMask };
    });
    const lists: number[][] = plan.regions.map(() => []);
    for (let c = 0; c < plan.grid.count; c++) {
      const r = plan.region[c] as number;
      if (r >= 0 && cells.walk[c] === 1) (lists[r] as number[]).push(c);
    }
    this.regionCells = lists.map((l) => Int32Array.from(l));
    this.regionMin = Uint8Array.from(lists.map((l) => l.reduce((m, c) => Math.min(m, plan.level[c] as number), MAX_LEVEL)));
    this.regionMax = Uint8Array.from(lists.map((l) => l.reduce((m, c) => Math.max(m, plan.level[c] as number), 0)));
  }

  objectIndex(id: string): number {
    return DEPOSIT_OBJECTS.indexOf(id);
  }

  info(object: number): ObjectInfo {
    return this.infos[object] as ObjectInfo;
  }

  private occ(x: number, y: number): number {
    return this.occupied.get(y * this.tiles + x) ?? OCC_NONE;
  }

  /** Tries to place one deposit of `object` in `region`; returns its node count (0 = failed). */
  tryDeposit(object: number, region: number, rng: Rng, rescatter: boolean): number {
    const info = this.info(object);
    const { rule } = info;
    const regionCells = this.regionCells[region] as Int32Array;
    if (regionCells.length === 0) return 0;
    const { grid } = this.plan;
    const win = this.win;
    const low = this.regionMin[region] as number;
    const maxWeight = 1 + rule.heightBias * ((this.regionMax[region] as number) - low);
    const occ = (x: number, y: number): number => this.occ(x, y);
    for (let attempt = 0; attempt < RESOURCES.centreAttempts; attempt++) {
      const c = regionCells[rng.int(0, regionCells.length)] as number;
      const lv = this.plan.level[c] as number;
      if (rng.next() * maxWeight > 1 + rule.heightBias * (lv - low)) continue;
      const tx = (c % grid.width) * grid.cellTiles + rng.int(0, grid.cellTiles);
      const ty = Math.floor(c / grid.width) * grid.cellTiles + rng.int(0, grid.cellTiles);
      const R = rule.radius;
      win.reset(tx - R - RESOURCES.windowMarginSide, ty - R - RESOURCES.windowMarginNorth, 2 * R + 2 * RESOURCES.windowMarginSide + 1, 2 * R + RESOURCES.windowMarginNorth + RESOURCES.windowMarginSouth + 1);
      if (!win.land(tx, ty)) continue;
      const level = win.level(tx, ty);
      const target = rng.int(rule.nodesMin, rule.nodesMax + 1);
      const nodes: number[] = [];
      const tries = target * RESOURCES.nodeAttempts;
      for (let k = 0; k < tries && nodes.length < target; k++) {
        let x = tx;
        let y = ty;
        if (k > 0) {
          const dx = rng.int(-R, R + 1);
          const dy = rng.int(-R, R + 1);
          if (dx * dx + dy * dy > R * R) continue;
          x += dx;
          y += dy;
        }
        if (info.biomeMask[win.biomeOf(x, y)] !== 1) continue;
        if (info.blocking) {
          if (!blockingFits(win, x, y, info.fw, info.fh, level, occ)) continue;
          for (let fy = y - info.fh + 1; fy <= y; fy++) for (let fx = x; fx < x + info.fw; fx++) this.occupied.set(fy * this.tiles + fx, OCC_BLOCK);
        } else {
          if (!win.free(x, y, level) || this.occ(x, y) !== OCC_NONE) continue;
          this.occupied.set(y * this.tiles + x, OCC_LOOSE);
        }
        nodes.push(y * this.tiles + x);
      }
      if (nodes.length >= rule.nodesMin) {
        const r = this.plan.regions[region];
        this.drafts.push({ object, region, tier: r?.tier ?? 0, x: tx, y: ty, level, nodes, rescatter });
        return nodes.length;
      }
      // Too few nodes: release them and try elsewhere.
      for (const key of nodes) {
        if (!info.blocking) {
          this.occupied.delete(key);
          continue;
        }
        const x = key % this.tiles;
        const y = Math.floor(key / this.tiles);
        for (let fy = y - info.fh + 1; fy <= y; fy++) for (let fx = x; fx < x + info.fw; fx++) this.occupied.delete(fy * this.tiles + fx);
      }
    }
    return 0;
  }
}

/** Node count per `object@tier`. */
function tally(drafts: readonly Draft[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of drafts) {
    const key = `${DEPOSIT_OBJECTS[d.object] as string}@${d.tier}`;
    m.set(key, (m.get(key) ?? 0) + d.nodes.length);
  }
  return m;
}

/**
 * Places the deposits of a world (plan-time, deterministic): regular deposits per region, then the
 * local re-scatter of every tier below its minimum. `win` must use the final reservations.
 */
export function placeResources(plan: WorldPlan, cells: CellInfo, win: TileWindow): ResourceResult {
  const placer = new DepositPlacer(plan, cells, win);
  const rng = new Rng(genSeed(plan.seed, 'ressourcen'));
  for (let o = 0; o < DEPOSIT_OBJECTS.length; o++) {
    const info = placer.info(o);
    for (const region of plan.regions) {
      const b = PLAN_BIOME_IDS.indexOf(region.biome);
      if (b < 0 || info.biomeMask[b] !== 1) continue;
      const expected = (region.cells * info.rule.perThousandCells) / 1000;
      let n = Math.floor(expected);
      if (rng.next() < expected - n) n++;
      for (let k = 0; k < n; k++) placer.tryDeposit(o, region.id, rng, false);
    }
  }
  // Validation: minimum amounts per tier, else local re-scatter.
  const requirements = resourceRequirements(plan);
  const before = tally(placer.drafts);
  const rescatterRng = new Rng(genSeed(plan.seed, 'nachstreuen'));
  let rescattered = 0;
  for (const req of requirements) {
    const o = placer.objectIndex(req.object);
    const info = placer.info(o);
    const regions = plan.regions.filter((r) => r.tier === req.tier && info.biomeMask[PLAN_BIOME_IDS.indexOf(r.biome)] === 1).map((r) => r.id);
    if (regions.length === 0) continue;
    let have = before.get(`${req.object}@${req.tier}`) ?? 0;
    const perDeposit = Math.max(1, info.rule.nodesMin);
    const attempts = Math.ceil((req.min - have) / perDeposit) * RESOURCES.rescatterAttemptsPerDeposit * regions.length;
    for (let a = 0; a < attempts && have < req.min; a++) {
      const got = placer.tryDeposit(o, regions[a % regions.length] as number, rescatterRng, true);
      if (got > 0) {
        have += got;
        rescattered++;
      }
    }
  }
  const after = tally(placer.drafts);
  const tallies = requirements.map((r) => ({ ...r, before: before.get(`${r.object}@${r.tier}`) ?? 0, after: after.get(`${r.object}@${r.tier}`) ?? 0 }));
  return { plan: buildResourcePlan(plan, placer.drafts), tallies, rescattered };
}

/** Packs the drafts into the plan arrays and chunk buckets. */
function buildResourcePlan(plan: WorldPlan, drafts: readonly Draft[]): ResourcePlan {
  const tiles = plan.grid.tiles;
  const chunks = tiles / CHUNK_SIZE;
  let total = 0;
  for (const d of drafts) total += d.nodes.length;
  const nodeX = new Uint16Array(total);
  const nodeY = new Uint16Array(total);
  const nodeObject = new Uint16Array(total);
  const deposits: ResourceDeposit[] = [];
  let k = 0;
  drafts.forEach((d, id) => {
    deposits.push({ id, object: d.object, region: d.region, tier: d.tier, x: d.x, y: d.y, level: d.level, first: k, count: d.nodes.length, rescatter: d.rescatter });
    for (const key of d.nodes) {
      nodeX[k] = key % tiles;
      nodeY[k] = Math.floor(key / tiles);
      nodeObject[k] = d.object;
      k++;
    }
  });
  const counts = new Int32Array(chunks * chunks + 1);
  const chunkOf = (i: number): number => Math.floor((nodeY[i] as number) / CHUNK_SIZE) * chunks + Math.floor((nodeX[i] as number) / CHUNK_SIZE);
  for (let i = 0; i < total; i++) counts[chunkOf(i) + 1] = (counts[chunkOf(i) + 1] as number) + 1;
  const bucketStart = new Int32Array(chunks * chunks + 1);
  for (let c = 0; c < chunks * chunks; c++) bucketStart[c + 1] = (bucketStart[c] as number) + (counts[c + 1] as number);
  const fill = bucketStart.slice(0, chunks * chunks);
  const bucketItems = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const c = chunkOf(i);
    bucketItems[fill[c] as number] = i;
    fill[c] = (fill[c] as number) + 1;
  }
  return { objects: DEPOSIT_OBJECTS, deposits, nodeX, nodeY, nodeObject, chunks, bucketStart, bucketItems };
}
