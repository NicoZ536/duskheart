/**
 * Shared surface context of the world generator (docs/WORLD.md §2): the tile samplers of the
 * (repaired) world plan, the biome dither, and spatial indices of the placed features – location
 * slots, Builder roads and bridges. The plan-time steps (locations, validation, resources) and the
 * chunk generator read tiles through the same functions, so whatever a plan step checked at a tile
 * is exactly what the chunk later shows there.
 *
 * Reservation bits (`RES_*`) mark tiles that belong to a feature: location discs (`TILE_FLAG_PLACE`),
 * road corridors (paved parts `strasse` + `TILE_FLAG_ROAD`; over river water `TILE_FLAG_BRIDGE`),
 * bridge spans (`TILE_FLAG_BRIDGE` over river water) and cave mouths (`TILE_FLAG_STAIRS`). No world
 * object is ever placed on a reserved tile.
 *
 * Determinism: only + − × ÷, `Math.floor`, `Math.sqrt` and seeded noise/hashes; every query is a pure
 * function of the world and the tile, allocation-free per call.
 */
import { createSimplex2, type Noise2 } from '../../engine/noise';
import { hash2, hashCombine, hashString, hashToUnit } from '../../engine/rng';
import { WATER_LAKE, WATER_RIVER, WATER_SEA } from '../model/chunk';
import { BIOME_ROLES, BORDERS, WATER } from './plan/params';
import { cellAtTile, NEIGHBOURS_4, neighbour4, type PlanGrid } from './plan/grid';
import {
  createBiomeSample,
  createBiomeSampler,
  createPlanSampler,
  pickBiome,
  PLAN_BIOME_IDS,
  type BiomeSample,
  type BiomeSampler,
  type PlanSampler,
  type WorldPlan,
} from './plan/index';
import { blueNoiseAt, createBlueNoiseTile, type BlueNoiseTile } from './sampling';

/** Reservation: inside a location disc. */
export const RES_PLACE = 0b1;
/** Reservation: inside a road corridor on the road's level. */
export const RES_ROAD = 0b10;
/** Reservation: inside a bridge span. */
export const RES_BRIDGE = 0b100;
/** Reservation: a cave mouth tile. */
export const RES_CAVE = 0b1000;

/** Seed of a named world generator stream (independent of the plan streams). */
export function genSeed(worldSeed: number, name: string): number {
  return hashCombine(worldSeed >>> 0, hashString(`gen.${name}`));
}

/** Seeded noise of a named world generator stream. */
export function genNoise(worldSeed: number, name: string): Noise2 {
  return createSimplex2(genSeed(worldSeed, name));
}

/** Uniform [0, 1) hash of a tile for a named salt. */
export function tileUnit(tx: number, ty: number, salt: number): number {
  return hashToUnit(hash2(tx, ty, salt));
}

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

export const CONTEXT = {
  /**
   * Blue-noise edge used for the biome dither and object scatter [cells]. 64² ranks repeat every
   * 64 tiles (two chunks); the build takes ≈ 0,1 s once per process (src/world/gen/sampling.ts).
   * Every world shifts it by a seeded offset (dither); the object scatter additionally reads it at a
   * seeded offset per 64-tile block and layer (vegetation.ts), so objects do not repeat per block.
   */
  blueNoiseSize: 64,
  /** Seed of the shared blue-noise tile (a constant: the tile is a sampling pattern, the world seed picks its offset). */
  blueNoiseSeed: 20260924,
  /**
   * Plan cells around a lava cell that must be Aschenschlund with one level and no water or ramp
   * [cells, radius]: the pool lies on a flat 24 × 24 tile block, never beside a cliff, ramp or river.
   * Lava tiles must also show the Aschenschlund in the dithered biome (`lavaAt`), so warped biome
   * borders never carry lava.
   */
  lavaClearCells: 1,
  /** Safety factor on the biome warp for the uniform-biome test [factor]. Simplex noise can overshoot ±1 slightly. */
  warpOvershoot: 1.25,
  /** Tile margin inside a lava cell kept free of lava [tiles]. Lava never touches the cell edge, so neighbouring cells stay walkable. */
  lavaMarginTiles: 1,
  /** Lava noise threshold in the middle of a lava cell [noise units]. With the raised rim ≈ a third of the inner tiles form one or two pools. */
  lavaThreshold: 0.1,
  /** Lava noise wavelength [tiles per cycle]. Pools a few tiles across. */
  lavaWavelengthTiles: 9,
  /** Extra lava threshold on the outermost allowed ring of a lava cell, fading out over `lavaEdgeTiles` [noise units]. Rounds the pools off instead of cutting them straight at the cell margin. */
  lavaEdgeRaise: 0.4,
  /** Tiles from the free margin over which the extra threshold fades [tiles]. */
  lavaEdgeTiles: 2,
  /** Share of eligible Aschenschlund cells that hold a lava pool [fraction]. Pools are landmarks, not a sea of lava. */
  lavaCellShare: 0.35,
  /** Road decay noise wavelength [tiles per cycle]. Broken stretches a few tiles long. */
  roadDecayWavelengthTiles: 7,
  /** Road tiles below this noise value lost their pavement [noise units]. ≈ 30 % missing: "zerfallene Erbauer-Straßen". */
  roadDecayThreshold: -0.35,
  /** Chance that a single paved road tile is missing anyway [fraction]. Scattered holes between the broken stretches. */
  roadHoleChance: 0.08,
} as const;

// ---------------------------------------------------------------------------------------------
// Cell buckets
// ---------------------------------------------------------------------------------------------

/** Items indexed by the plan cells their bounding box touches. */
export interface CellBuckets {
  /** Items of cell `c` = `items[offsets[c]] … items[offsets[c + 1] − 1]`. */
  readonly offsets: Int32Array;
  readonly items: Int32Array;
}

/** Fields of a bounding box (x0, y0, x1, y1). */
const BOX_FIELDS = 4;

/** Builds cell buckets from item bounding boxes [tiles]. */
export function buildCellBuckets(grid: PlanGrid, count: number, bbox: (i: number, out: Float64Array) => void): CellBuckets {
  const box = new Float64Array(BOX_FIELDS);
  const counts = new Int32Array(grid.count + 1);
  const visit = (i: number, fn: (cell: number) => void): void => {
    bbox(i, box);
    const x0 = Math.max(0, Math.floor((box[0] as number) / grid.cellTiles));
    const y0 = Math.max(0, Math.floor((box[1] as number) / grid.cellTiles));
    const x1 = Math.min(grid.width - 1, Math.floor((box[2] as number) / grid.cellTiles));
    const y1 = Math.min(grid.height - 1, Math.floor((box[3] as number) / grid.cellTiles));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * grid.width + x);
  };
  for (let i = 0; i < count; i++) {
    visit(i, (c) => {
      counts[c + 1] = (counts[c + 1] as number) + 1;
    });
  }
  const offsets = new Int32Array(grid.count + 1);
  for (let c = 0; c < grid.count; c++) offsets[c + 1] = (offsets[c] as number) + (counts[c + 1] as number);
  const fill = offsets.slice(0, grid.count);
  const items = new Int32Array(offsets[grid.count] as number);
  for (let i = 0; i < count; i++) {
    visit(i, (c) => {
      items[fill[c] as number] = i;
      fill[c] = (fill[c] as number) + 1;
    });
  }
  return { offsets, items };
}

// ---------------------------------------------------------------------------------------------
// Features the context indexes
// ---------------------------------------------------------------------------------------------

/** A disc reserved for a location slot [tiles]. */
export interface ReservedDisc {
  /** Centre tile. */
  readonly x: number;
  readonly y: number;
  /** Radius [tiles]; tiles whose centre lies within it belong to the disc. */
  readonly radius: number;
  /** Whether the disc is a cave mouth (its centre tile leads down). */
  readonly cave: boolean;
}

/** A straight piece of road or bridge [tiles]. */
export interface ReservedSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Half width [tiles]. */
  readonly half: number;
  /** Lowest and highest level the piece runs on (a ramp crossing spans two). Bridges: 0 … MAX. */
  readonly levelMin: number;
  readonly levelMax: number;
}

/** Everything the reservation index needs. */
export interface ReservationInput {
  readonly discs: readonly ReservedDisc[];
  readonly roads: readonly ReservedSegment[];
  readonly bridges: readonly ReservedSegment[];
}

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + vx * t - px;
  const dy = ay + vy * t - py;
  return dx * dx + dy * dy;
}

/** Tile queries of the reserved features. */
export interface Reservations {
  /** `RES_*` bits of the tile (x, y) on height level `level`. */
  at(tx: number, ty: number, level: number): number;
  /** Whether a road tile keeps its Builder pavement (decay noise). */
  paved(tx: number, ty: number): boolean;
}

/** Builds the reservation index of the given features. */
export function createReservations(worldSeed: number, grid: PlanGrid, input: ReservationInput): Reservations {
  const { discs, roads, bridges } = input;
  const discIndex = buildCellBuckets(grid, discs.length, (i, out) => {
    const d = discs[i] as ReservedDisc;
    out[0] = d.x - d.radius - 1;
    out[1] = d.y - d.radius - 1;
    out[2] = d.x + d.radius + 1;
    out[3] = d.y + d.radius + 1;
  });
  const segBox = (list: readonly ReservedSegment[]) => (i: number, out: Float64Array): void => {
    const s = list[i] as ReservedSegment;
    out[0] = Math.min(s.x0, s.x1) - s.half - 1;
    out[1] = Math.min(s.y0, s.y1) - s.half - 1;
    out[2] = Math.max(s.x0, s.x1) + s.half + 1;
    out[3] = Math.max(s.y0, s.y1) + s.half + 1;
  };
  const roadIndex = buildCellBuckets(grid, roads.length, segBox(roads));
  const bridgeIndex = buildCellBuckets(grid, bridges.length, segBox(bridges));
  const decay = genNoise(worldSeed, 'strassenzerfall');
  const holeSalt = genSeed(worldSeed, 'strassenloecher');
  const inSegment = (list: readonly ReservedSegment[], index: CellBuckets, cell: number, x: number, y: number, level: number): boolean => {
    for (let j = index.offsets[cell] as number; j < (index.offsets[cell + 1] as number); j++) {
      const s = list[index.items[j] as number] as ReservedSegment;
      if (level < s.levelMin || level > s.levelMax) continue;
      if (segmentDistance2(x, y, s.x0, s.y0, s.x1, s.y1) <= s.half * s.half) return true;
    }
    return false;
  };
  return {
    at(tx: number, ty: number, level: number): number {
      const x = tx + 0.5;
      const y = ty + 0.5;
      const cell = cellAtTile(grid, x, y);
      let bits = 0;
      for (let j = discIndex.offsets[cell] as number; j < (discIndex.offsets[cell + 1] as number); j++) {
        const d = discs[discIndex.items[j] as number] as ReservedDisc;
        const dx = tx - d.x;
        const dy = ty - d.y;
        if (dx * dx + dy * dy <= d.radius * d.radius) {
          bits |= RES_PLACE;
          if (d.cave && dx === 0 && dy === 0) bits |= RES_CAVE;
        }
      }
      if (inSegment(roads, roadIndex, cell, x, y, level)) bits |= RES_ROAD;
      if (inSegment(bridges, bridgeIndex, cell, x, y, level)) bits |= RES_BRIDGE;
      return bits;
    },
    paved(tx: number, ty: number): boolean {
      const n = decay(tx / CONTEXT.roadDecayWavelengthTiles, ty / CONTEXT.roadDecayWavelengthTiles);
      return n > CONTEXT.roadDecayThreshold && tileUnit(tx, ty, holeSalt) >= CONTEXT.roadHoleChance;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Surface context
// ---------------------------------------------------------------------------------------------

/** Tile samplers and derived cell data of one (repaired) world plan. */
export interface SurfaceContext {
  readonly plan: WorldPlan;
  readonly grid: PlanGrid;
  readonly terrain: PlanSampler;
  readonly biomes: BiomeSampler;
  /** Blue-noise tile shared by the biome dither and the object scatter (layers use offsets). */
  readonly blue: BlueNoiseTile;
  /** Seeded offset of this world into the blue-noise tile [cells]. */
  readonly blueX: number;
  readonly blueY: number;
  /** Region biome index (`PLAN_BIOME_IDS`) per region. */
  readonly regionBiome: Uint8Array;
  /** 1 on cells whose inner tiles may hold lava pools (Aschenschlund, see `CONTEXT`). */
  readonly lavaCell: Uint8Array;
  /** Dithered biome index of a tile (what the chunk's `biome` field shows). */
  biomeAt(tx: number, ty: number): number;
  /** Whether a tile is lava (Aschenschlund pools). */
  lavaAt(tx: number, ty: number): boolean;
  /**
   * The biome index every tile of the rectangle [x0, x1) × [y0, y1) has, or −1 when borders or
   * transition strips may reach into it (all regions within the warp and candidate reach share one
   * biome, open sea counting as the coastal ring's biome).
   */
  uniformBiome(x0: number, y0: number, x1: number, y1: number): number;
}

/** Water bits that mean "not dry land". */
export const WET_BITS = WATER_SEA | WATER_LAKE | WATER_RIVER;

let sharedBlue: BlueNoiseTile | null = null;

/** The blue-noise tile of the world generator (built once per process, ≈ 0,1 s). */
export function worldBlueNoise(): BlueNoiseTile {
  sharedBlue ??= createBlueNoiseTile(CONTEXT.blueNoiseSeed, CONTEXT.blueNoiseSize);
  return sharedBlue;
}

/** Builds the surface context of a plan (samplers ≈ 60 ms for Mittel). */
export function createSurfaceContext(plan: WorldPlan): SurfaceContext {
  const { grid } = plan;
  const terrain = createPlanSampler(plan);
  const biomes = createBiomeSampler(plan);
  const blue = worldBlueNoise();
  const shift = genSeed(plan.seed, 'blaurauschen.versatz');
  const blueX = shift % CONTEXT.blueNoiseSize;
  const blueY = Math.floor(shift / CONTEXT.blueNoiseSize) % CONTEXT.blueNoiseSize;
  const regionBiome = Uint8Array.from(plan.regions.map((r) => PLAN_BIOME_IDS.indexOf(r.biome)));
  const lavaCell = computeLavaCells(plan, regionBiome);
  const lavaNoise = genNoise(plan.seed, 'lava');
  const sample: BiomeSample = createBiomeSample();
  const lavaInner = grid.cellTiles - CONTEXT.lavaMarginTiles;
  const ringBiome = PLAN_BIOME_IDS.indexOf(BIOME_ROLES.ring);
  // Reach of the biome sampler around a tile [cells]: the warp (with margin for noise overshoot),
  // the 3 × 3 candidate cells and the cell rounding.
  const reach = Math.ceil((BORDERS.warpTiles * CONTEXT.warpOvershoot) / grid.cellTiles) + 2;
  const volcanic = PLAN_BIOME_IDS.indexOf('aschenschlund');
  const biomeAt = (tx: number, ty: number): number => {
    biomes.sample(tx, ty, sample);
    return pickBiome(sample, blueNoiseAt(blue, tx + blueX, ty + blueY));
  };
  return {
    plan,
    grid,
    terrain,
    biomes,
    blue,
    blueX,
    blueY,
    regionBiome,
    lavaCell,
    biomeAt,
    lavaAt(tx: number, ty: number): boolean {
      if (tx < 0 || ty < 0 || tx >= grid.tiles || ty >= grid.tiles) return false;
      const cx = Math.floor(tx / grid.cellTiles);
      const cy = Math.floor(ty / grid.cellTiles);
      if (lavaCell[cy * grid.width + cx] !== 1) return false;
      const lx = tx - cx * grid.cellTiles;
      const ly = ty - cy * grid.cellTiles;
      if (lx < CONTEXT.lavaMarginTiles || ly < CONTEXT.lavaMarginTiles || lx >= lavaInner || ly >= lavaInner) return false;
      // Distance to the free margin [tiles, 0 on the outermost allowed ring]; the threshold rises towards it.
      const edge = Math.min(lx - CONTEXT.lavaMarginTiles, ly - CONTEXT.lavaMarginTiles, lavaInner - 1 - lx, lavaInner - 1 - ly);
      const raise = edge >= CONTEXT.lavaEdgeTiles ? 0 : (CONTEXT.lavaEdgeRaise * (CONTEXT.lavaEdgeTiles - edge)) / CONTEXT.lavaEdgeTiles;
      return lavaNoise(tx / CONTEXT.lavaWavelengthTiles, ty / CONTEXT.lavaWavelengthTiles) > CONTEXT.lavaThreshold + raise && biomeAt(tx, ty) === volcanic;
    },
    uniformBiome(x0: number, y0: number, x1: number, y1: number): number {
      const cx0 = Math.max(0, Math.floor(x0 / grid.cellTiles) - reach);
      const cy0 = Math.max(0, Math.floor(y0 / grid.cellTiles) - reach);
      const cx1 = Math.min(grid.width - 1, Math.floor((x1 - 1) / grid.cellTiles) + reach);
      const cy1 = Math.min(grid.height - 1, Math.floor((y1 - 1) / grid.cellTiles) + reach);
      let biome = -1;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const r = plan.region[cy * grid.width + cx] as number;
          const b = r >= 0 ? (regionBiome[r] as number) : ringBiome;
          if (biome < 0) biome = b;
          else if (b !== biome) return -1;
        }
      }
      return biome;
    },
  };
}

/** Lava cells: Aschenschlund cells whose surroundings are Aschenschlund, flat and dry (a seeded share of them). */
function computeLavaCells(plan: WorldPlan, regionBiome: Uint8Array): Uint8Array {
  const { grid } = plan;
  const volcanic = PLAN_BIOME_IDS.indexOf('aschenschlund');
  const out = new Uint8Array(grid.count);
  if (volcanic < 0) return out;
  const r = CONTEXT.lavaClearCells;
  const salt = genSeed(plan.seed, 'lavazellen');
  const ramp = new Uint8Array(grid.count);
  for (const rp of plan.ramps) {
    ramp[rp.low] = 1;
    ramp[rp.high] = 1;
  }
  for (let c = 0; c < grid.count; c++) {
    const reg = plan.region[c] as number;
    if (reg < 0 || regionBiome[reg] !== volcanic) continue;
    if (tileUnit(c % grid.width, Math.floor(c / grid.width), salt) >= CONTEXT.lavaCellShare) continue;
    const cx = c % grid.width;
    const cy = Math.floor(c / grid.width);
    const lv = plan.level[c] as number;
    let ok = true;
    for (let y = cy - r; y <= cy + r && ok; y++) {
      for (let x = cx - r; x <= cx + r && ok; x++) {
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
          ok = false;
          break;
        }
        const n = y * grid.width + x;
        const nr = plan.region[n] as number;
        ok = nr >= 0 && regionBiome[nr] === volcanic && plan.level[n] === lv && (plan.lake[n] as number) < 0 && plan.riverCell[n] === 0 && ramp[n] === 0;
      }
    }
    if (ok) out[c] = 1;
  }
  return out;
}

/** Whether cell `c` has a 4-neighbour satisfying `test`. */
export function hasNeighbour4(grid: PlanGrid, c: number, test: (n: number) => boolean): boolean {
  for (let d = 0; d < NEIGHBOURS_4; d++) {
    const n = neighbour4(grid, c, d);
    if (n >= 0 && test(n)) return true;
  }
  return false;
}

/** Cells holding a vertex of a deep river (width ≥ `WATER.deepRiverWidth`: a deep channel) on land. */
export function deepRiverCells(plan: WorldPlan): Uint8Array {
  const { grid } = plan;
  const out = new Uint8Array(grid.count);
  for (const r of plan.rivers) {
    for (let i = 0; i < r.xs.length; i++) {
      if ((r.width[i] as number) < WATER.deepRiverWidth) continue;
      const c = cellAtTile(grid, r.xs[i] as number, r.ys[i] as number);
      if (plan.land[c] === 1 && (plan.lake[c] as number) < 0) out[c] = 1;
    }
  }
  return out;
}
