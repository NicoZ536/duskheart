/**
 * World plan step 4 (M2-07, MASTERPROMPT §9.1/§9.2.4): height field with levels 0–4, cliffs,
 * ramps and stairs.
 *
 * Elevation = blended biome profile (base + relief amplitude × mountain relief; Glutsand beside the
 * Aschenschlund lifted into a range) + local hill noise, rising from sea level over
 * `HEIGHT.coastRiseTiles`; the high mountains are lifted until the main island has a level-4 summit.
 * The hydrology step fills its depressions (priority flood), and the levels are the floor of the
 * filled elevation, so water always flows downhill or level and every basin is a lake or a flat
 * plateau. `finalizeHeight` then removes one- and two-cell plateaus, repairs unreachable plateaus
 * (a cell steps one level towards its neighbour until every level difference on the way is 1) –
 * never touching river cells or letting a lake shore sink below the lake – and places ramps (earth) or stairs
 * (rock biomes) on every border between plateaus one level apart – at least one per border and
 * one per `HEIGHT.rampEveryEdges` of border, on straight cliff stretches. Every other level step
 * is a cliff (16 px wall per level, docs/WORLD.md §7). Temperature falls 3 °C per level (§9.1).
 */
import { BALANCE } from '../../../content/balance';
import { fbm } from '../../../engine/noise';
import type { Rng } from '../../../engine/rng';
import type { BiomeAssignment, Climate } from './biomes';
import { planNoise } from './fields';
import { boxBlur, cellCenterX, cellCenterY, DX4, DY4, neighbour4, NEIGHBOURS_4, type PlanGrid } from './grid';
import { BIOME_ROLES, HEIGHT, type HeightProfile } from './params';
import type { RegionMap } from './regions';

/** Highest surface level (§9.1). */
export const MAX_LEVEL = BALANCE.world.maxHeightLevel;

/** Temperature offset of a height level [°C] (§9.1: −3 °C per level). */
export function heightTemperatureOffsetC(level: number): number {
  return level * BALANCE.world.temperaturePerHeightLevelC;
}

const PROFILES: Readonly<Record<string, HeightProfile>> = HEIGHT.profiles;

function profileOf(biome: string): HeightProfile {
  const p = PROFILES[biome];
  if (p === undefined) throw new Error(`World plan: no height profile for biome "${biome}"`);
  return p;
}

/**
 * Continuous elevation per cell [levels] before depression filling; sea cells are 0.
 */
export function computeElevation(worldSeed: number, attempt: number, map: RegionMap, biomes: BiomeAssignment, climate: Climate): Float32Array {
  const { grid, region, regions, neighbours } = map;
  const base = new Float32Array(grid.count);
  const amp = new Float32Array(grid.count);
  const lift = new Float32Array(regions.length);
  for (const r of regions) {
    if (biomes.biome[r.id] !== BIOME_ROLES.dry) continue;
    if ((neighbours[r.id] as readonly number[]).some((v) => biomes.biome[v] === BIOME_ROLES.volcanic)) lift[r.id] = HEIGHT.volcanicRangeLift;
  }
  for (let c = 0; c < grid.count; c++) {
    const r = region[c] as number;
    if (r < 0) continue;
    const p = profileOf(biomes.biome[r] as string);
    base[c] = p.base + (lift[r] as number);
    amp[c] = p.relief;
  }
  const baseB = boxBlur(grid, base, HEIGHT.blendRadiusCells);
  const ampB = boxBlur(grid, amp, HEIGHT.blendRadiusCells);
  const detail = planNoise(worldSeed, attempt, 'height.detail');
  const detailOpts = { octaves: HEIGHT.detailOctaves, frequency: 1 / HEIGHT.detailWavelengthTiles };
  const elevation = new Float32Array(grid.count);
  const mainland: number[] = [];
  for (let c = 0; c < grid.count; c++) {
    const r = region[c] as number;
    if (r === -1) continue;
    const coast = map.coastDistance[c] as number;
    const rise = coast >= HEIGHT.coastRiseTiles ? 1 : coast <= 0 ? 0 : coast / HEIGHT.coastRiseTiles;
    const e = ((baseB[c] as number) + (ampB[c] as number) * (climate.relief[c] as number) + HEIGHT.detailAmplitude * fbm(detail, cellCenterX(grid, c), cellCenterY(grid, c), detailOpts)) * rise;
    const v = e > 0 ? e : 0;
    elevation[c] = v;
    if (regions[r]?.landmass === 0) mainland.push(v);
  }
  // Lift the high mountains until the main island has a level-4 summit of `peakCells` cells
  // (a single-cell peak would be smoothed away as noise).
  mainland.sort((a, b) => b - a);
  const summit = mainland[Math.min(mainland.length - 1, HEIGHT.peakCells - 1)] ?? 0;
  if (summit < HEIGHT.peakElevation && summit > HEIGHT.peakLiftFrom) {
    const gain = (HEIGHT.peakElevation - summit) / (summit - HEIGHT.peakLiftFrom);
    for (let c = 0; c < grid.count; c++) {
      const e = elevation[c] as number;
      if (e > HEIGHT.peakLiftFrom) elevation[c] = e + (e - HEIGHT.peakLiftFrom) * gain;
    }
  }
  return elevation;
}

/** Level per cell from a (filled) elevation: ⌊e⌋ clamped to 0…MAX_LEVEL. */
export function quantizeLevels(grid: PlanGrid, elevation: Float32Array, land: Uint8Array): Uint8Array {
  const levels = new Uint8Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    if (land[c] !== 1) continue;
    const l = Math.floor(elevation[c] as number);
    levels[c] = l < 0 ? 0 : l > MAX_LEVEL ? MAX_LEVEL : l;
  }
  return levels;
}

/** Ramp kind: an earth ramp or carved stairs. */
export type RampKind = 'rampe' | 'treppe';

/** A ramp or stairs between two cells one level apart. */
export interface PlanRamp {
  readonly kind: RampKind;
  /** Lower cell. */
  readonly low: number;
  /** Upper cell (edge neighbour of `low`). */
  readonly high: number;
  /** Level of the lower cell; the upper cell is one level higher. */
  readonly level: number;
  /** Direction from the lower to the upper cell (0 east, 1 south, 2 west, 3 north). */
  readonly dir: number;
  /** Tile rectangle of the ramp [tiles], centred on the shared cell edge. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Inputs of `finalizeHeight`. */
export interface HeightInput {
  readonly grid: PlanGrid;
  readonly landmass: Int16Array;
  readonly region: Int16Array;
  readonly regionBiome: readonly string[];
  /** Levels from the filled elevation; modified in place. */
  readonly levels: Uint8Array;
  /** Lake id per cell (−1 none): lakes are not walked on. */
  readonly lake: Int16Array;
  /** 1 on river and stream cells: their levels are never changed (monotone rivers). */
  readonly river: Uint8Array;
}

/** Result of `finalizeHeight`. */
export interface HeightResult {
  readonly ramps: readonly PlanRamp[];
  /** Cells stepped by the reachability repair. */
  readonly repairs: number;
  /** Cells flattened by the plateau cleanup. */
  readonly smoothed: number;
}

/** Whether a cell borders a lake (its level must not sink below the lake surface). */
function shore(input: HeightInput, c: number): boolean {
  for (let d = 0; d < NEIGHBOURS_4; d++) {
    const n = neighbour4(input.grid, c, d);
    if (n >= 0 && (input.lake[n] as number) >= 0) return true;
  }
  return false;
}

/** Walkable for the height graph: land and not lake. */
function walkable(input: HeightInput, c: number): boolean {
  return input.landmass[c] !== -1 && (input.lake[c] as number) < 0;
}

/** Components of walkable cells connected by steps of at most one level. */
function stepComponents(input: HeightInput): Int32Array {
  const { grid, levels } = input;
  const label = new Int32Array(grid.count).fill(-1);
  const queue = new Int32Array(grid.count);
  let next = 0;
  for (let s = 0; s < grid.count; s++) {
    if (label[s] !== -1 || !walkable(input, s)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = next;
    while (head < tail) {
      const c = queue[head++] as number;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || label[n] !== -1 || !walkable(input, n)) continue;
        if (Math.abs((levels[n] as number) - (levels[c] as number)) > 1) continue;
        label[n] = next;
        queue[tail++] = n;
      }
    }
    next++;
  }
  return label;
}

/** Removes plateaus smaller than `HEIGHT.minPlateauCells` (never touching water cells). */
function smoothPlateaus(input: HeightInput): number {
  const { grid, levels } = input;
  let changed = 0;
  for (let pass = 0; pass < HEIGHT.plateauPasses; pass++) {
    const same = labelSameLevel(input);
    const cellsOf = new Map<number, number[]>();
    for (let c = 0; c < grid.count; c++) {
      const p = same[c] as number;
      if (p < 0) continue;
      const list = cellsOf.get(p);
      if (list === undefined) cellsOf.set(p, [c]);
      else list.push(c);
    }
    for (const cells of cellsOf.values()) {
      if (cells.length >= HEIGHT.minPlateauCells) continue;
      if (cells.some((c) => input.river[c] === 1 || shore(input, c))) continue;
      const votes = new Int32Array(MAX_LEVEL + 1);
      const own = levels[cells[0] as number] as number;
      for (const c of cells) {
        for (let d = 0; d < NEIGHBOURS_4; d++) {
          const n = neighbour4(grid, c, d);
          if (n < 0 || !walkable(input, n) || levels[n] === own) continue;
          votes[levels[n] as number] = (votes[levels[n] as number] as number) + 1;
        }
      }
      let bestLevel = -1;
      let bestVotes = 0;
      for (let l = 0; l <= MAX_LEVEL; l++) {
        if ((votes[l] as number) > bestVotes) {
          bestVotes = votes[l] as number;
          bestLevel = l;
        }
      }
      if (bestLevel < 0) continue;
      for (const c of cells) levels[c] = bestLevel;
      changed += cells.length;
    }
  }
  return changed;
}

/** Same-level components of walkable cells (plateaus). */
function labelSameLevel(input: HeightInput): Int32Array {
  const { grid, levels } = input;
  const label = new Int32Array(grid.count).fill(-1);
  const queue = new Int32Array(grid.count);
  let next = 0;
  for (let s = 0; s < grid.count; s++) {
    if (label[s] !== -1 || !walkable(input, s)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = next;
    const lv = levels[s] as number;
    while (head < tail) {
      const c = queue[head++] as number;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || label[n] !== -1 || levels[n] !== lv || !walkable(input, n)) continue;
        label[n] = next;
        queue[tail++] = n;
      }
    }
    next++;
  }
  return label;
}

/** Steps cells until every landmass is one step component (all levels reachable). Returns the stepped cells. */
function repairReachability(input: HeightInput): number {
  const { grid, levels, landmass } = input;
  let repairs = 0;
  for (let round = 0; round < grid.count; round++) {
    const comp = stepComponents(input);
    // Largest component per landmass.
    const size = new Map<number, number>();
    for (let c = 0; c < grid.count; c++) {
      const k = comp[c] as number;
      if (k >= 0) size.set(k, (size.get(k) ?? 0) + 1);
    }
    const main = new Map<number, number>();
    for (let c = 0; c < grid.count; c++) {
      const k = comp[c] as number;
      if (k < 0) continue;
      const lm = landmass[c] as number;
      const cur = main.get(lm);
      if (cur === undefined || (size.get(k) as number) > (size.get(cur) as number) || ((size.get(k) as number) === (size.get(cur) as number) && k < cur)) main.set(lm, k);
    }
    // One step per cut-off component: the pair with the smallest level difference.
    const bestPair = new Map<number, { u: number; v: number; diff: number }>();
    for (let c = 0; c < grid.count; c++) {
      const k = comp[c] as number;
      if (k < 0 || main.get(landmass[c] as number) === k) continue;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || !walkable(input, n) || comp[n] === k) continue;
        const diff = Math.abs((levels[n] as number) - (levels[c] as number));
        if (input.river[c] === 1 && input.river[n] === 1) continue;
        const cur = bestPair.get(k);
        if (cur === undefined || diff < cur.diff) bestPair.set(k, { u: c, v: n, diff });
      }
    }
    if (bestPair.size === 0) return repairs;
    let stepped = 0;
    for (const { u, v } of bestPair.values()) {
      // Step the non-river cell of the pair one level towards the other (lake shores only rise).
      const [a, b] = input.river[u] === 1 || (shore(input, u) && (levels[v] as number) < (levels[u] as number)) ? [v, u] : [u, v];
      if (input.river[a] === 1 || (shore(input, a) && (levels[b] as number) < (levels[a] as number))) continue;
      const la = levels[a] as number;
      const lb = levels[b] as number;
      levels[a] = la + (lb > la ? 1 : -1);
      repairs++;
      stepped++;
    }
    if (stepped === 0) return repairs;
  }
  return repairs;
}

/** Tile rectangle of a ramp on the edge from `low` towards direction `dir`. */
function rampRect(grid: PlanGrid, low: number, dir: number): { x: number; y: number; w: number; h: number } {
  const cx = low % grid.width;
  const cy = Math.floor(low / grid.width);
  const t = grid.cellTiles;
  const halfDepth = HEIGHT.rampDepthTiles / 2;
  const side = (t - HEIGHT.rampWidthTiles) / 2;
  const dx = DX4[dir] as number;
  const dy = DY4[dir] as number;
  if (dx !== 0) {
    const edgeX = (dx > 0 ? cx + 1 : cx) * t;
    return { x: edgeX - halfDepth, y: cy * t + side, w: HEIGHT.rampDepthTiles, h: HEIGHT.rampWidthTiles };
  }
  const edgeY = (dy > 0 ? cy + 1 : cy) * t;
  return { x: cx * t + side, y: edgeY - halfDepth, w: HEIGHT.rampWidthTiles, h: HEIGHT.rampDepthTiles };
}

/** Places ramps and stairs on every plateau border with a one-level step. */
function placeRamps(input: HeightInput, rng: Rng): PlanRamp[] {
  const { grid, levels } = input;
  const plateau = labelSameLevel(input);
  interface Candidate {
    low: number;
    dir: number;
    score: number;
  }
  const borders = new Map<string, Candidate[]>();
  for (let c = 0; c < grid.count; c++) {
    const pl = plateau[c] as number;
    if (pl < 0) continue;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const n = neighbour4(grid, c, d);
      if (n < 0) continue;
      const pn = plateau[n] as number;
      if (pn < 0 || (levels[n] as number) !== (levels[c] as number) + 1) continue;
      // Straight stretch: the two parallel edges beside this one step between the same plateaus.
      let straight = 0;
      for (const side of [(d + 1) % NEIGHBOURS_4, (d + NEIGHBOURS_4 - 1) % NEIGHBOURS_4]) {
        const a = neighbour4(grid, c, side);
        const b = neighbour4(grid, n, side);
        if (a >= 0 && b >= 0 && plateau[a] === pl && plateau[b] === pn) straight++;
      }
      const wet = input.river[c] === 1 || input.river[n] === 1 ? 1 : 0;
      const key = `${pl}:${pn}`;
      const list = borders.get(key) ?? [];
      list.push({ low: c, dir: d, score: straight * 2 - wet * NEIGHBOURS_4 + rng.next() });
      borders.set(key, list);
    }
  }
  const ramps: PlanRamp[] = [];
  const keys = [...borders.keys()].sort();
  const gap2 = HEIGHT.rampMinGapCells * HEIGHT.rampMinGapCells;
  for (const key of keys) {
    const list = borders.get(key) as Candidate[];
    list.sort((a, b) => b.score - a.score || a.low - b.low || a.dir - b.dir);
    const wanted = Math.min(HEIGHT.maxRampsPerBorder, 1 + Math.floor(list.length / HEIGHT.rampEveryEdges));
    const chosen: Candidate[] = [];
    for (const cand of list) {
      if (chosen.length >= wanted) break;
      const x = cand.low % grid.width;
      const y = Math.floor(cand.low / grid.width);
      const far = chosen.every((o) => {
        const dx = (o.low % grid.width) - x;
        const dy = Math.floor(o.low / grid.width) - y;
        return dx * dx + dy * dy >= gap2;
      });
      if (far) chosen.push(cand);
    }
    for (const cand of chosen) {
      const high = neighbour4(grid, cand.low, cand.dir);
      const biome = input.regionBiome[input.region[high] as number] as string;
      const stairs = (HEIGHT.stairBiomes as readonly string[]).includes(biome);
      ramps.push({ kind: stairs ? 'treppe' : 'rampe', low: cand.low, high, level: levels[cand.low] as number, dir: cand.dir, ...rampRect(grid, cand.low, cand.dir) });
    }
  }
  ramps.sort((a, b) => a.low - b.low || a.dir - b.dir);
  return ramps;
}

/** Cleans the levels, makes every plateau reachable and places ramps and stairs. */
export function finalizeHeight(input: HeightInput, rng: Rng): HeightResult {
  const smoothed = smoothPlateaus(input);
  const repairs = repairReachability(input);
  const ramps = placeRamps(input, rng);
  return { ramps, repairs, smoothed };
}
