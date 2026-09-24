/**
 * Tile-level realisation of the world plan for the chunk generator (docs/WORLD.md §2 step 2):
 * coast, height level with ramps and stairs, and water bits (WORLD.md §3) for any tile, in any
 * order, without allocation per call.
 *
 * - Coast: the plan's coast distance field (bilinear, a smooth curve instead of the cell staircase)
 *   plus a small wobble.
 * - Height: one signed distance field per level threshold 1…4 (nested sets ⇒ nested curves), the
 *   same wobble for all thresholds keeps them nested. Inside a ramp rectangle the level is forced to
 *   the ramp's two levels, split at the plan cell edge, and the tile carries the ramp/stairs flag –
 *   the cliff wobble (≤ 1,5 tiles) stays inside the ramp depth (6 tiles), so every ramp spans its cliff.
 * - Water: sea (shallow near the coast), lakes (distance field of the lake cells, shallow shore),
 *   rivers and streams (distance to the polyline ≤ half the interpolated width, at least half a tile
 *   diagonal so 1-tile streams stay edge-connected; deep channel from 3 tiles), fords (shallow, ford
 *   flag) and springs. Water tiles sit on the water's level: rivers carve their bed, and where
 *   channels overlap at a confluence the lowest one wins.
 */
import { fbm, type Noise2 } from '../../../engine/noise';
import { TILE_FLAG_FORD, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_LAKE, WATER_RIVER, WATER_SEA, WATER_SPRING } from '../../model/chunk';
import { planNoise } from './fields';
import { cellAtTile, DX4, DY4, sampleBilinear, signedDistanceField } from './grid';
import { MAX_LEVEL } from './height';
import type { WorldPlan } from './index';
import { TILE_DETAIL, WATER } from './params';

/** Result of `PlanSampler.sample` (reused by the caller). */
export interface TerrainSample {
  /** Whether the tile is land (not sea). */
  land: boolean;
  /** Height level 0–4 (water tiles: the water's level). */
  level: number;
  /** `TILE_FLAG_*` bits: ramp, stairs, ford. */
  flags: number;
  /** `WATER_*` bits: depth, river, lake, sea, spring. */
  water: number;
}

/** Tile sampler of a plan. */
export interface PlanSampler {
  readonly plan: WorldPlan;
  /** Samples the tile (tx, ty) into `out` and returns it. */
  sample(tx: number, ty: number, out: TerrainSample): TerrainSample;
}

/** New empty sample record. */
export function createTerrainSample(): TerrainSample {
  return { land: false, level: 0, flags: 0, water: 0 };
}

/** Fields of a bounding box (x0, y0, x1, y1). */
const BOX_FIELDS = 4;
/** Largest number of ramps touching one cell (one per edge). */
const RAMPS_PER_CELL = 4;
/** Smallest half width of a river at tile resolution [tiles]: half the tile diagonal (√2 / 2). */
const MIN_HALF_WIDTH = Math.SQRT1_2;
/** Octaves of the tile wobbles [count]. */
const WOBBLE_OCTAVES = 2;

/** Compressed per-cell lists (cell → items), built from item bounding boxes. */
interface CellIndex {
  readonly offsets: Int32Array;
  readonly items: Int32Array;
}

function buildCellIndex(plan: WorldPlan, count: number, bbox: (i: number, out: Float64Array) => void): CellIndex {
  const { grid } = plan;
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

/** Builds the tile sampler of a plan (derived fields and indices, ≈ 1 MB for Groß). */
export function createPlanSampler(plan: WorldPlan): PlanSampler {
  const { grid, level, lake } = plan;
  const levelSdf: Float32Array[] = [];
  for (let k = 1; k <= MAX_LEVEL; k++) levelSdf.push(signedDistanceField(grid, (c) => plan.land[c] === 1 && (level[c] as number) >= k));
  const lakeSdf = signedDistanceField(grid, (c) => (lake[c] as number) >= 0);
  const coastNoise = planNoise(plan.seed, plan.attempt, 'tile.coast');
  const cliffNoise = planNoise(plan.seed, plan.attempt, 'tile.cliff');
  const lakeNoise = planNoise(plan.seed, plan.attempt, 'tile.lake');
  const coastOpts = { octaves: WOBBLE_OCTAVES, frequency: 1 / TILE_DETAIL.coastWavelengthTiles };
  const cliffOpts = { octaves: WOBBLE_OCTAVES, frequency: 1 / TILE_DETAIL.cliffWavelengthTiles };
  const lakeOpts = { octaves: WOBBLE_OCTAVES, frequency: 1 / TILE_DETAIL.lakeWavelengthTiles };

  // Ramps per cell (low and high cell of each ramp).
  const cellRamps = new Int32Array(grid.count * RAMPS_PER_CELL).fill(-1);
  plan.ramps.forEach((r, i) => {
    for (const c of [r.low, r.high]) {
      for (let k = 0; k < RAMPS_PER_CELL; k++) {
        if (cellRamps[c * RAMPS_PER_CELL + k] === -1) {
          cellRamps[c * RAMPS_PER_CELL + k] = i;
          break;
        }
      }
    }
  });

  // River segments.
  let segCount = 0;
  for (const r of plan.rivers) segCount += Math.max(0, r.xs.length - 1);
  const segX0 = new Float64Array(segCount);
  const segY0 = new Float64Array(segCount);
  const segX1 = new Float64Array(segCount);
  const segY1 = new Float64Array(segCount);
  const segW0 = new Float64Array(segCount);
  const segW1 = new Float64Array(segCount);
  const segLevel = new Uint8Array(segCount);
  const segRiver = new Int32Array(segCount);
  let s = 0;
  for (const r of plan.rivers) {
    for (let i = 0; i + 1 < r.xs.length; i++) {
      segX0[s] = r.xs[i] as number;
      segY0[s] = r.ys[i] as number;
      segX1[s] = r.xs[i + 1] as number;
      segY1[s] = r.ys[i + 1] as number;
      segW0[s] = r.width[i] as number;
      segW1[s] = r.width[i + 1] as number;
      segLevel[s] = Math.min(r.level[i] as number, r.level[i + 1] as number);
      segRiver[s] = r.id;
      s++;
    }
  }
  const segIndex = buildCellIndex(plan, segCount, (i, out) => {
    const pad = Math.max(segW0[i] as number, segW1[i] as number) / 2 + 1;
    out[0] = Math.min(segX0[i] as number, segX1[i] as number) - pad;
    out[1] = Math.min(segY0[i] as number, segY1[i] as number) - pad;
    out[2] = Math.max(segX0[i] as number, segX1[i] as number) + pad;
    out[3] = Math.max(segY0[i] as number, segY1[i] as number) + pad;
  });
  const fordIndex = buildCellIndex(plan, plan.fords.length, (i, out) => {
    const f = plan.fords[i];
    const r = WATER.fordRadiusTiles;
    out[0] = (f?.x ?? 0) - r;
    out[1] = (f?.y ?? 0) - r;
    out[2] = (f?.x ?? 0) + r;
    out[3] = (f?.y ?? 0) + r;
  });
  const springs = plan.rivers.filter((r) => r.fromLake < 0);
  const springX = Float64Array.from(springs.map((r) => r.xs[0] as number));
  const springY = Float64Array.from(springs.map((r) => r.ys[0] as number));
  const springIndex = buildCellIndex(plan, springs.length, (i, out) => {
    const r = WATER.springRadiusTiles + 1;
    out[0] = (springX[i] as number) - r;
    out[1] = (springY[i] as number) - r;
    out[2] = (springX[i] as number) + r;
    out[3] = (springY[i] as number) + r;
  });
  const fordR2 = WATER.fordRadiusTiles * WATER.fordRadiusTiles;
  const springR2 = WATER.springRadiusTiles * WATER.springRadiusTiles;

  const wobble = (noise: Noise2, x: number, y: number, opts: { octaves: number; frequency: number }, amp: number): number => amp * fbm(noise, x, y, opts);

  return {
    plan,
    sample(tx: number, ty: number, out: TerrainSample): TerrainSample {
      const x = tx + 0.5;
      const y = ty + 0.5;
      out.flags = 0;
      out.water = 0;
      out.level = 0;
      const coast = sampleBilinear(grid, plan.coastDistance, x, y) + wobble(coastNoise, x, y, coastOpts, TILE_DETAIL.coastAmplitude);
      out.land = coast > 0;
      if (!out.land) {
        out.water = WATER_SEA | (coast > -WATER.seaShallowTiles ? WATER_DEPTH_SHALLOW : WATER_DEPTH_DEEP);
        return out;
      }
      // Height level from the nested level fields.
      const cliff = wobble(cliffNoise, x, y, cliffOpts, TILE_DETAIL.cliffAmplitude);
      let lv = 0;
      for (let k = 0; k < levelSdf.length; k++) if (sampleBilinear(grid, levelSdf[k] as Float32Array, x, y) + cliff > 0) lv = k + 1;
      // Ramps and stairs override the level inside their rectangle.
      const cell = cellAtTile(grid, x, y);
      for (let k = 0; k < RAMPS_PER_CELL; k++) {
        const ri = cellRamps[cell * RAMPS_PER_CELL + k] as number;
        if (ri < 0) break;
        const r = plan.ramps[ri];
        if (r === undefined || tx < r.x || ty < r.y || tx >= r.x + r.w || ty >= r.y + r.h) continue;
        const dx = DX4[r.dir] as number;
        const dy = DY4[r.dir] as number;
        const lowX = ((r.low % grid.width) + 0.5) * grid.cellTiles;
        const lowY = (Math.floor(r.low / grid.width) + 0.5) * grid.cellTiles;
        // Beyond half a cell from the low cell centre, along the ramp direction, lies the upper cell.
        const along = (x - lowX) * dx + (y - lowY) * dy;
        lv = along < grid.cellTiles / 2 ? r.level : r.level + 1;
        out.flags |= r.kind === 'treppe' ? TILE_FLAG_STAIRS : TILE_FLAG_RAMP;
        break;
      }
      out.level = lv;
      // Lakes.
      const lakeValue = sampleBilinear(grid, lakeSdf, x, y) + wobble(lakeNoise, x, y, lakeOpts, TILE_DETAIL.lakeAmplitude);
      if (lakeValue > 0) {
        const id = lake[cell] as number;
        out.water = WATER_LAKE | (lakeValue < WATER.lakeShallowTiles ? WATER_DEPTH_SHALLOW : WATER_DEPTH_DEEP);
        if (id >= 0) out.level = (plan.lakes[id]?.level ?? out.level) as number;
        return out;
      }
      // Rivers and streams.
      const s0 = segIndex.offsets[cell] as number;
      const s1 = segIndex.offsets[cell + 1] as number;
      let bestExcess = Infinity;
      let bestSeg = -1;
      let bestHalf = 0;
      let bestD = 0;
      // Where channels overlap (confluences), the bed lies on the lowest of them.
      let bedLevel = MAX_LEVEL + 1;
      for (let j = s0; j < s1; j++) {
        const i = segIndex.items[j] as number;
        const ax = segX0[i] as number;
        const ay = segY0[i] as number;
        const bx = segX1[i] as number;
        const by = segY1[i] as number;
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy;
        let t = len2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + vx * t - x;
        const py = ay + vy * t - y;
        const d = Math.sqrt(px * px + py * py);
        const width = (segW0[i] as number) + ((segW1[i] as number) - (segW0[i] as number)) * t;
        // Half a tile diagonal at least: a 1-tile stream stays edge-connected on diagonal runs.
        const half = width / 2 > MIN_HALF_WIDTH ? width / 2 : MIN_HALF_WIDTH;
        const excess = d - half;
        if (excess <= 0 && (segLevel[i] as number) < bedLevel) bedLevel = segLevel[i] as number;
        if (excess < bestExcess) {
          bestExcess = excess;
          bestSeg = i;
          bestHalf = half;
          bestD = d;
        }
      }
      if (bestSeg >= 0 && bestExcess <= 0) {
        const deep = bestHalf * 2 >= WATER.deepRiverWidth && bestD <= bestHalf - 1;
        out.water = WATER_RIVER | (deep ? WATER_DEPTH_DEEP : WATER_DEPTH_SHALLOW);
        out.level = bedLevel;
        const river = segRiver[bestSeg] as number;
        for (let j = fordIndex.offsets[cell] as number; j < (fordIndex.offsets[cell + 1] as number); j++) {
          const f = plan.fords[fordIndex.items[j] as number];
          if (f === undefined || f.river !== river) continue;
          const fx = f.x - x;
          const fy = f.y - y;
          if (fx * fx + fy * fy <= fordR2) {
            out.water = WATER_RIVER | WATER_DEPTH_SHALLOW;
            out.flags |= TILE_FLAG_FORD;
            break;
          }
        }
        for (let j = springIndex.offsets[cell] as number; j < (springIndex.offsets[cell + 1] as number); j++) {
          const i = springIndex.items[j] as number;
          const sx = (springX[i] as number) - x;
          const sy = (springY[i] as number) - y;
          if (sx * sx + sy * sy <= springR2) out.water |= WATER_SPRING;
        }
      }
      return out;
    },
  };
}
