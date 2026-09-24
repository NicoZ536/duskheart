/**
 * World plan step 5 (M2-08, MASTERPROMPT §9.2.5): rivers from the mountains to the coast along the
 * slope, lakes in basins, fords, streams and springs.
 *
 * - A few basins are pressed into the elevation of lake biomes; a priority flood from the sea fills
 *   every depression (a noisy ε-rise per cell lets flats drain along curved paths) and yields one
 *   drainage tree: each land cell flows to the cell it was reached from, so every flow path ends in
 *   the sea and its filled elevation never rises. The deepest part (≤ `WATER.lakeMaxCells`) of every
 *   hollow deeper than `WATER.lakeMinDepth` becomes a lake whose surface level is that of its lowest
 *   shore; land enclosed by a lake joins it.
 * - Rivers start at mountain sources (level ≥ 3, spaced; spacing and level relax until the size's
 *   count is reached) and follow the drainage tree until they reach the sea, a lake or an earlier
 *   river (tributary; a course running alongside a river joins it sideways). A lake that receives a
 *   river drains through an outflow river from its pour point. Streams (1 tile) rise at hill springs.
 * - Levels come from the filled elevation, so along every river path the level never rises.
 *   Polylines: cell centres, Chaikin corner cutting and a tapered meander; width 2–4 from the
 *   catchment (streams 1). Every spring is the first vertex of its river or stream.
 * - Fords (after the height finalisation): river cells whose two bank cells lie on the river's level,
 *   spaced along each river.
 */
import type { WorldSizePreset } from '../../../content/balance';
import { fbm } from '../../../engine/noise';
import type { Rng } from '../../../engine/rng';
import { planNoise } from './fields';
import { cellCenterX, cellCenterY, CellHeap, labelComponents, neighbour4, NEIGHBOURS_4, type PlanGrid } from './grid';
import { MAX_LEVEL } from './height';
import { WATER } from './params';
import type { RegionMap } from './regions';

/** A lake of the plan. */
export interface PlanLake {
  readonly id: number;
  /** Area [cells]. */
  readonly cells: number;
  /** Height level of the lake surface. */
  readonly level: number;
  /** Filled elevation of the surface [levels]. */
  readonly surface: number;
  /** Centre of the lake [tiles]. */
  readonly x: number;
  readonly y: number;
}

/** River kind: a river (2–4 tiles) or a stream (1 tile). */
export type RiverKind = 'fluss' | 'bach';

/** Where a river ends. */
export type RiverEnd = { readonly kind: 'meer' } | { readonly kind: 'see'; readonly lake: number } | { readonly kind: 'fluss'; readonly river: number; readonly vertex: number };

/** A river or stream as a polyline from its source to its mouth. */
export interface PlanRiver {
  readonly id: number;
  readonly kind: RiverKind;
  /** Plan cells of the course, source first; the last cell is the sea, lake or river cell it flows into. */
  readonly cells: Int32Array;
  /** Polyline [tiles]. */
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  /** Width per vertex [tiles]. */
  readonly width: Uint8Array;
  /** Height level per vertex (never rises downstream). */
  readonly level: Uint8Array;
  /** Filled elevation per vertex [levels] (never rises downstream). */
  readonly elevation: Float32Array;
  readonly end: RiverEnd;
  /** Lake this river drains (outflow), or −1 when it rises at a spring. */
  readonly fromLake: number;
}

/** A ford: a shallow crossing of a river. */
export interface PlanFord {
  readonly river: number;
  /** Plan cell of the crossing (on the river's course). */
  readonly cell: number;
  /** Polyline vertex of the ford. */
  readonly vertex: number;
  /** Position [tiles]. */
  readonly x: number;
  readonly y: number;
  /** Height level of the river and both banks. */
  readonly level: number;
}

/** Result of the hydrology. */
export interface Hydrology {
  /** Elevation with every depression filled [levels]. */
  readonly filled: Float32Array;
  /** Downstream cell per land cell (−1 at sea). */
  readonly downstream: Int32Array;
  /** Lake id per cell (−1 none). */
  readonly lake: Int16Array;
  readonly lakes: readonly PlanLake[];
  /** 1 on cells a river or stream runs through. */
  readonly riverCell: Uint8Array;
  readonly rivers: readonly PlanRiver[];
}

/** Squared length of (dx, dy). */
function distance2(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

/** 1 for every region whose biome is in `biomes`. */
function regionFlags(regionBiome: readonly string[], biomes: readonly string[]): Uint8Array {
  return Uint8Array.from(regionBiome.map((b) => (biomes.includes(b) ? 1 : 0)));
}

/** Presses lake basins into the elevation (in place). Returns the number of basins. */
function pressBasins(map: RegionMap, regionBiome: readonly string[], elevation: Float32Array, preset: WorldSizePreset, rng: Rng): number {
  const { grid, region } = map;
  const lakeRegion = regionFlags(regionBiome, WATER.lakeBiomes);
  const candidates: number[] = [];
  for (let c = 0; c < grid.count; c++) {
    const r = region[c] as number;
    if (r < 0 || (map.coastDistance[c] as number) < WATER.lakeCoastTiles) continue;
    if (lakeRegion[r] === 1) candidates.push(c);
  }
  rng.shuffle(candidates);
  const sites: number[] = [];
  const spacing2 = WATER.lakeSpacingTiles * WATER.lakeSpacingTiles;
  for (const c of candidates) {
    if (sites.length >= WATER.lakeBasins[preset]) break;
    const x = cellCenterX(grid, c);
    const y = cellCenterY(grid, c);
    if (sites.some((s) => distance2(cellCenterX(grid, s) - x, cellCenterY(grid, s) - y) < spacing2)) continue;
    sites.push(c);
  }
  for (const s of sites) {
    const r = rng.float(WATER.lakeRadiusMinCells, WATER.lakeRadiusMaxCells);
    const sx = s % grid.width;
    const sy = Math.floor(s / grid.width);
    const reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        const c = y * grid.width + x;
        if (region[c] === -1) continue;
        const q = (dx * dx + dy * dy) / (r * r);
        if (q >= 1) continue;
        elevation[c] = Math.max(0, (elevation[c] as number) - WATER.lakeBasinDepth * (1 - q));
      }
    }
  }
  return sites.length;
}

/**
 * Priority flood from the sea: filled elevation, downstream tree and the processing order. The ε
 * rise per cell varies with a smooth noise (`rise`), so the flow across filled flats follows curved
 * least-cost paths instead of the straight lines of a uniform ε.
 */
function priorityFlood(grid: PlanGrid, land: Uint8Array, elevation: Float32Array, rise: Float64Array): { filled: Float64Array; downstream: Int32Array; order: Int32Array } {
  const filled = new Float64Array(grid.count);
  const downstream = new Int32Array(grid.count).fill(-1);
  const done = new Uint8Array(grid.count);
  const order = new Int32Array(grid.count);
  const heap = new CellHeap(grid.count);
  let n = 0;
  for (let c = 0; c < grid.count; c++) {
    if (land[c] === 1) continue;
    done[c] = 1;
    heap.push(c, -1);
  }
  while (heap.size > 0) {
    const c = heap.pop();
    order[n++] = c;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const nb = neighbour4(grid, c, d);
      if (nb < 0 || done[nb] === 1) continue;
      done[nb] = 1;
      const e = elevation[nb] as number;
      const floor = (filled[c] as number) + (rise[nb] as number);
      filled[nb] = e > floor ? e : floor;
      downstream[nb] = c;
      heap.push(nb, filled[nb] as number);
    }
  }
  return { filled, downstream, order };
}

/** Finds the lakes: depressions with enough depth and area; lake-enclosed land joins the lake. */
function findLakes(grid: PlanGrid, land: Uint8Array, landmass: Int16Array, elevation: Float32Array, filled: Float64Array): { lake: Int16Array; lakes: PlanLake[] } {
  const depth = (c: number): number => (filled[c] as number) - (elevation[c] as number);
  const hollows = labelComponents(grid, (c) => land[c] === 1 && depth(c) > WATER.lakeShoreDepth);
  const cellsOf: number[][] = hollows.sizes.map(() => []);
  for (let c = 0; c < grid.count; c++) {
    const h = hollows.label[c] as number;
    if (h >= 0) (cellsOf[h] as number[]).push(c);
  }
  const lake = new Int16Array(grid.count).fill(-1);
  const inSet = new Uint8Array(grid.count);
  let count = 0;
  for (const cells of cellsOf) {
    if (cells.length < WATER.lakeMinCells) continue;
    const byDepth = cells.slice().sort((a, b) => depth(b) - depth(a) || a - b);
    if (depth(byDepth[0] as number) <= WATER.lakeMinDepth) continue;
    // A wide hollow keeps its deepest part as the lake; the rest is flat shore at the lake's level.
    const limit = byDepth.length > WATER.lakeMaxCells ? depth(byDepth[WATER.lakeMaxCells - 1] as number) : -Infinity;
    for (const c of cells) if (depth(c) >= limit) inSet[c] = 1;
    const part = [byDepth[0] as number];
    inSet[part[0] as number] = 2;
    for (let i = 0; i < part.length; i++) {
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const nb = neighbour4(grid, part[i] as number, d);
        if (nb >= 0 && inSet[nb] === 1) {
          inSet[nb] = 2;
          part.push(nb);
        }
      }
    }
    for (const c of cells) inSet[c] = 0;
    if (part.length < WATER.lakeMinCells) continue;
    for (const c of part) lake[c] = count;
    count++;
  }
  // Land cut off by a lake (an island in the lake) joins the lake: the walkable land of each landmass stays one piece.
  const dry = labelComponents(grid, (c) => land[c] === 1 && lake[c] === -1);
  const biggest = new Map<number, number>();
  for (let c = 0; c < grid.count; c++) {
    const k = dry.label[c] as number;
    if (k < 0) continue;
    const lm = landmass[c] as number;
    const cur = biggest.get(lm);
    if (cur === undefined || (dry.sizes[k] as number) > (dry.sizes[cur] as number)) biggest.set(lm, k);
  }
  for (let c = 0; c < grid.count; c++) {
    const k = dry.label[c] as number;
    if (k < 0 || biggest.get(landmass[c] as number) === k) continue;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const nb = neighbour4(grid, c, d);
      if (nb >= 0 && (lake[nb] as number) >= 0) {
        lake[c] = lake[nb] as number;
        break;
      }
    }
  }
  // Second sweep for enclosed land not touching a lake cell directly (inner parts of a lake island).
  for (let changed = true; changed; ) {
    changed = false;
    for (let c = 0; c < grid.count; c++) {
      const k = dry.label[c] as number;
      if (k < 0 || lake[c] !== -1 || biggest.get(landmass[c] as number) === k) continue;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const nb = neighbour4(grid, c, d);
        if (nb >= 0 && (lake[nb] as number) >= 0) {
          lake[c] = lake[nb] as number;
          changed = true;
          break;
        }
      }
    }
  }
  const lakes: PlanLake[] = [];
  for (let id = 0; id < count; id++) lakes.push({ id, cells: 0, level: 0, surface: 0, x: 0, y: 0 });
  const minFilled = new Float64Array(count).fill(Infinity);
  const minRim = new Float64Array(count).fill(Infinity);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const cells = new Int32Array(count);
  for (let c = 0; c < grid.count; c++) {
    const id = lake[c] as number;
    if (id < 0) continue;
    cells[id] = (cells[id] as number) + 1;
    sumX[id] = (sumX[id] as number) + cellCenterX(grid, c);
    sumY[id] = (sumY[id] as number) + cellCenterY(grid, c);
    if ((filled[c] as number) < (minFilled[id] as number)) minFilled[id] = filled[c] as number;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const nb = neighbour4(grid, c, d);
      if (nb >= 0 && land[nb] === 1 && lake[nb] === -1 && (filled[nb] as number) < (minRim[id] as number)) minRim[id] = filled[nb] as number;
    }
  }
  for (let id = 0; id < count; id++) {
    const n = cells[id] as number;
    const surface = minFilled[id] as number;
    // The surface level never lies above the lowest shore (the pour point), so the shore never
    // drops into the lake and the outflow leaves on the lake's level.
    const level = Math.min(MAX_LEVEL, Math.max(0, Math.floor(Math.min(surface, minRim[id] as number))));
    lakes[id] = { id, cells: n, level, surface, x: (sumX[id] as number) / n, y: (sumY[id] as number) / n };
  }
  return { lake, lakes };
}

interface Course {
  cells: number[];
  end: RiverEnd;
  fromLake: number;
  kind: RiverKind;
}

/** Follows the drainage tree from `source` until the sea, a lake (other than `ownLake`) or a river cell. */
/**
 * Follows the drainage tree from `source` until the sea, a lake (other than `ownLake`) or a river
 * cell. A course that runs alongside a river joins it sideways as soon as a neighbouring river cell
 * lies no higher (no parallel channels one cell apart).
 */
function trace(grid: PlanGrid, land: Uint8Array, downstream: Int32Array, lake: Int16Array, riverOf: Int32Array, filled: Float64Array, source: number, ownLake: number): { cells: number[]; end: RiverEnd | null; joinRiver: number } {
  const cells: number[] = [source];
  let c = source;
  for (let guard = 0; guard < grid.count; guard++) {
    const next = downstream[c] as number;
    if (next < 0) return { cells, end: null, joinRiver: -1 };
    cells.push(next);
    if (land[next] === 0) return { cells, end: { kind: 'meer' }, joinRiver: -1 };
    const lk = lake[next] as number;
    if (lk >= 0 && lk !== ownLake) return { cells, end: { kind: 'see', lake: lk }, joinRiver: -1 };
    const rv = riverOf[next] as number;
    if (rv >= 0) return { cells, end: null, joinRiver: rv };
    let side = -1;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const nb = neighbour4(grid, next, d);
      if (nb < 0 || (riverOf[nb] as number) < 0 || (filled[nb] as number) > (filled[next] as number)) continue;
      if (side < 0 || (filled[nb] as number) < (filled[side] as number)) side = nb;
    }
    if (side >= 0) {
      cells.push(side);
      return { cells, end: null, joinRiver: riverOf[side] as number };
    }
    c = next;
  }
  return { cells, end: null, joinRiver: -1 };
}

/** Polyline of a course: cell centres, Chaikin smoothing with fixed ends, tapered meander. */
function buildPolyline(grid: PlanGrid, course: readonly number[], widths: readonly number[], levels: readonly number[], elevations: readonly number[], meander: (s: number) => number): { xs: number[]; ys: number[]; w: number[]; l: number[]; e: number[] } {
  let xs = course.map((c) => cellCenterX(grid, c));
  let ys = course.map((c) => cellCenterY(grid, c));
  let w = [...widths];
  let l = [...levels];
  let e = [...elevations];
  const q = 0.25;
  for (let pass = 0; pass < WATER.smoothingPasses && xs.length > 2; pass++) {
    const nx = [xs[0] as number];
    const ny = [ys[0] as number];
    const nw = [w[0] as number];
    const nl = [l[0] as number];
    const ne = [e[0] as number];
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i] as number;
      const y0 = ys[i] as number;
      const x1 = xs[i + 1] as number;
      const y1 = ys[i + 1] as number;
      const e0 = e[i] as number;
      const e1 = e[i + 1] as number;
      if (i > 0) {
        nx.push(x0 + (x1 - x0) * q);
        ny.push(y0 + (y1 - y0) * q);
        nw.push(w[i] as number);
        nl.push(l[i] as number);
        ne.push(e0 + (e1 - e0) * q);
      }
      if (i + 2 < xs.length) {
        nx.push(x0 + (x1 - x0) * (1 - q));
        ny.push(y0 + (y1 - y0) * (1 - q));
        nw.push(w[i + 1] as number);
        nl.push(l[i + 1] as number);
        ne.push(e0 + (e1 - e0) * (1 - q));
      }
    }
    nx.push(xs[xs.length - 1] as number);
    ny.push(ys[ys.length - 1] as number);
    nw.push(w[w.length - 1] as number);
    nl.push(l[l.length - 1] as number);
    ne.push(e[e.length - 1] as number);
    xs = nx;
    ys = ny;
    w = nw;
    l = nl;
    e = ne;
  }
  // Meander: sideways offset along the local normal, faded in at both ends.
  const n = xs.length;
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dx = (xs[i] as number) - (xs[i - 1] as number);
    const dy = (ys[i] as number) - (ys[i - 1] as number);
    arc[i] = (arc[i - 1] as number) + Math.sqrt(dx * dx + dy * dy);
  }
  const total = arc[n - 1] as number;
  const outX = xs.slice();
  const outY = ys.slice();
  for (let i = 1; i + 1 < n; i++) {
    const tx = (xs[i + 1] as number) - (xs[i - 1] as number);
    const ty = (ys[i + 1] as number) - (ys[i - 1] as number);
    const len = Math.sqrt(tx * tx + ty * ty);
    if (len === 0) continue;
    const s = arc[i] as number;
    const taper = Math.min(1, s / WATER.meanderTaperTiles, (total - s) / WATER.meanderTaperTiles);
    const off = WATER.meanderTiles * taper * meander(s);
    outX[i] = (xs[i] as number) - (ty / len) * off;
    outY[i] = (ys[i] as number) + (tx / len) * off;
  }
  return { xs: outX, ys: outY, w, l, e };
}

/** Inputs of `generateHydrology`. */
export interface HydrologyInput {
  readonly worldSeed: number;
  readonly attempt: number;
  readonly preset: WorldSizePreset;
  readonly map: RegionMap;
  readonly land: Uint8Array;
  readonly landmass: Int16Array;
  readonly regionBiome: readonly string[];
  /** Unfilled elevation [levels]; the lake basins are pressed into it in place. */
  readonly elevation: Float32Array;
}

/** Lakes, rivers and streams; levels are ⌊filled elevation⌋ (see `quantizeLevels`). */
export function generateHydrology(input: HydrologyInput, rng: Rng): Hydrology {
  const { map, land, landmass, regionBiome, elevation, preset } = input;
  const grid = map.grid;
  pressBasins(map, regionBiome, elevation, preset, rng);
  const wander = planNoise(input.worldSeed, input.attempt, 'water.flat');
  const rise = new Float64Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    const n = wander(cellCenterX(grid, c) / WATER.flatWanderWavelengthTiles, cellCenterY(grid, c) / WATER.flatWanderWavelengthTiles);
    rise[c] = WATER.floodEpsilon * (1 + WATER.flatWanderStrength * (n * 0.5 + 0.5));
  }
  const { filled, downstream, order } = priorityFlood(grid, land, elevation, rise);
  const { lake, lakes } = findLakes(grid, land, landmass, elevation, filled);
  const levelOf = (c: number): number => {
    const lk = lake[c] as number;
    if (lk >= 0) return (lakes[lk] as PlanLake).level;
    if (land[c] !== 1) return 0;
    return Math.min(MAX_LEVEL, Math.max(0, Math.floor(filled[c] as number)));
  };

  // Catchment per cell: upstream cells, accumulated from the highest cell down.
  const catchment = new Int32Array(grid.count);
  for (let i = grid.count - 1; i >= 0; i--) {
    const c = order[i] as number;
    if (land[c] !== 1) continue;
    catchment[c] = (catchment[c] as number) + 1;
    const d = downstream[c] as number;
    if (d >= 0) catchment[d] = (catchment[d] as number) + (catchment[c] as number);
  }

  const riverOf = new Int32Array(grid.count).fill(-1);
  const courses: Course[] = [];
  const sources: number[] = [];
  const pendingLakes: number[] = [];
  const drained = new Uint8Array(lakes.length);
  /** Marks the cells of a course as river cells (not its mouth, which belongs to the sea, lake or main river). */
  const claim = (cells: readonly number[], id: number): void => {
    for (let i = 0; i < cells.length - 1; i++) {
      const c = cells[i] as number;
      if (land[c] === 1 && lake[c] === -1 && riverOf[c] === -1) riverOf[c] = id;
    }
  };
  const tooClose = (c: number, spacing: number): boolean => {
    const x = cellCenterX(grid, c);
    const y = cellCenterY(grid, c);
    const s2 = spacing * spacing;
    return sources.some((s) => distance2(cellCenterX(grid, s) - x, cellCenterY(grid, s) - y) < s2);
  };
  const addCourse = (cells: number[], end: RiverEnd | null, joinRiver: number, kind: RiverKind, fromLake: number): void => {
    const id = courses.length;
    const resolved: RiverEnd = end ?? { kind: 'fluss', river: joinRiver, vertex: -1 };
    courses.push({ cells, end: resolved, fromLake, kind });
    claim(cells, id);
    if (resolved.kind === 'see' && kind === 'fluss' && drained[resolved.lake] === 0) {
      drained[resolved.lake] = 1;
      pendingLakes.push(resolved.lake);
    }
  };
  const lakeCell = new Int32Array(lakes.length).fill(-1);
  for (let c = 0; c < grid.count; c++) {
    const lk = lake[c] as number;
    if (lk >= 0 && lakeCell[lk] === -1) lakeCell[lk] = c;
  }
  const drainLakes = (): void => {
    while (pendingLakes.length > 0) {
      const lk = pendingLakes.shift() as number;
      // Pour point: follow the drainage from any lake cell until it leaves the lake.
      let c = lakeCell[lk] as number;
      let last = c;
      for (let guard = 0; guard < grid.count && c >= 0 && lake[c] === lk; guard++) {
        last = c;
        c = downstream[c] as number;
      }
      if (c < 0) continue;
      const t = trace(grid, land, downstream, lake, riverOf, filled, c, lk);
      if (t.end === null && t.joinRiver < 0) continue;
      addCourse([last, ...t.cells], t.end, t.joinRiver, 'fluss', lk);
    }
  };

  // Rivers from the mountains.
  const riverless = regionFlags(regionBiome, WATER.riverlessBiomes);
  const streamRegion = regionFlags(regionBiome, WATER.streamBiomes);
  const riverTarget = WATER.rivers[preset];
  let sprung = 0;
  // Relax step by step until the target count is reached: mountain sources first, then closer
  // spacing, then hill sources.
  const passes: [number, number][] = [];
  for (const minLevel of [WATER.riverSourceLevel, WATER.riverSourceFallbackLevel]) for (const spacing of Object.values(WATER.riverSpacingSteps)) passes.push([minLevel, spacing]);
  for (const [minLevel, spacingFactor] of passes) {
    if (sprung >= riverTarget) break;
    const candidates: { c: number; key: number }[] = [];
    for (let c = 0; c < grid.count; c++) {
      const r = map.region[c] as number;
      if (r < 0 || lake[c] !== -1 || riverOf[c] !== -1 || levelOf(c) < minLevel) continue;
      if (riverless[r] === 1) continue;
      candidates.push({ c, key: (filled[c] as number) + rng.next() });
    }
    candidates.sort((a, b) => b.key - a.key || a.c - b.c);
    for (const { c } of candidates) {
      if (sprung >= riverTarget) break;
      if (riverOf[c] !== -1 || tooClose(c, WATER.riverSourceSpacingTiles * spacingFactor)) continue;
      const t = trace(grid, land, downstream, lake, riverOf, filled, c, -1);
      if ((t.end === null && t.joinRiver < 0) || t.cells.length < WATER.riverMinCells) continue;
      sources.push(c);
      addCourse(t.cells, t.end, t.joinRiver, 'fluss', -1);
      sprung++;
      drainLakes();
    }
  }

  // Streams from hill springs.
  const streamCandidates: number[] = [];
  for (let c = 0; c < grid.count; c++) {
    const r = map.region[c] as number;
    if (r < 0 || lake[c] !== -1 || riverOf[c] !== -1) continue;
    const lv = levelOf(c);
    if (lv < (WATER.streamLevels[0] as number) || lv > (WATER.streamLevels[1] as number)) continue;
    if (streamRegion[r] === 1) streamCandidates.push(c);
  }
  rng.shuffle(streamCandidates);
  let streams = 0;
  for (const spacingFactor of Object.values(WATER.riverSpacingSteps)) {
    for (const c of streamCandidates) {
      if (streams >= WATER.streams[preset]) break;
      if (riverOf[c] !== -1 || tooClose(c, WATER.streamSpacingTiles * spacingFactor)) continue;
      const t = trace(grid, land, downstream, lake, riverOf, filled, c, -1);
      if ((t.end === null && t.joinRiver < 0) || t.cells.length < WATER.streamMinCells) continue;
      sources.push(c);
      addCourse(t.cells, t.end, t.joinRiver, 'bach', -1);
      streams++;
    }
  }

  // Polylines in creation order (tributaries join earlier courses, whose polylines already exist).
  const meanderNoise = planNoise(input.worldSeed, input.attempt, 'water.meander');
  const meanderOpts = { octaves: 1, frequency: 1 / WATER.meanderWavelengthTiles };
  const rivers: PlanRiver[] = [];
  const riverCell = new Uint8Array(grid.count);
  courses.forEach((course, id) => {
    const cells = course.cells;
    const last = cells[cells.length - 1] as number;
    const widths = cells.map((c) => {
      if (course.kind === 'bach') return WATER.streamWidth;
      const extra = Math.floor((catchment[c] as number) / WATER.widthStepCells);
      return Math.min(WATER.riverMaxWidth, WATER.riverMinWidth + extra);
    });
    // The mouth keeps the width of the last river cell (the sea, lake or main river cell has its own catchment).
    if (widths.length > 1) widths[widths.length - 1] = widths[widths.length - 2] as number;
    const levels = cells.map((c) => levelOf(c));
    const elevations = cells.map((c) => {
      const lk = lake[c] as number;
      return lk >= 0 ? (lakes[lk] as PlanLake).surface : land[c] === 1 ? (filled[c] as number) : 0;
    });
    // The outflow of a lake starts on the lake surface.
    if (course.fromLake >= 0) {
      levels[0] = (lakes[course.fromLake] as PlanLake).level;
      elevations[0] = (lakes[course.fromLake] as PlanLake).surface;
    }
    for (let i = 1; i < levels.length; i++) {
      // Guard against ε-rounding: never rise downstream.
      if ((levels[i] as number) > (levels[i - 1] as number)) levels[i] = levels[i - 1] as number;
      if ((elevations[i] as number) > (elevations[i - 1] as number)) elevations[i] = elevations[i - 1] as number;
    }
    const offset = id * WATER.meanderTaperTiles;
    const poly = buildPolyline(grid, cells, widths, levels, elevations, (s) => fbm(meanderNoise, s + offset, offset, meanderOpts));
    let end = course.end;
    if (end.kind === 'fluss') {
      // Snap the mouth onto the main river: the nearest vertex at or below the tributary's last level and elevation.
      const main = rivers[end.river] as PlanRiver;
      const lx = cellCenterX(grid, last);
      const ly = cellCenterY(grid, last);
      let nearest = 0;
      let bestD = Infinity;
      for (let i = 0; i < main.xs.length; i++) {
        const dx = (main.xs[i] as number) - lx;
        const dy = (main.ys[i] as number) - ly;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          nearest = i;
        }
      }
      const k = poly.xs.length - 1;
      const prevLevel = poly.l[k - 1] as number;
      const prevElev = poly.e[k - 1] as number;
      let v = nearest;
      while (v < main.xs.length - 1 && ((main.level[v] as number) > prevLevel || (main.elevation[v] as number) > prevElev)) v++;
      poly.xs[k] = main.xs[v] as number;
      poly.ys[k] = main.ys[v] as number;
      poly.l[k] = main.level[v] as number;
      poly.e[k] = main.elevation[v] as number;
      end = { kind: 'fluss', river: end.river, vertex: v };
    }
    for (let i = 0; i < cells.length - 1; i++) {
      const c = cells[i] as number;
      if (land[c] === 1 && lake[c] === -1) riverCell[c] = 1;
    }
    rivers.push({
      id,
      kind: course.kind,
      cells: Int32Array.from(cells),
      xs: Float32Array.from(poly.xs),
      ys: Float32Array.from(poly.ys),
      width: Uint8Array.from(poly.w),
      level: Uint8Array.from(poly.l),
      elevation: Float32Array.from(poly.e),
      end,
      fromLake: course.fromLake,
    });
  });
  const filled32 = Float32Array.from(filled);
  return { filled: filled32, downstream, lake, lakes, riverCell, rivers };
}

/** Places fords on every river where both banks lie on the river's level. */
export function placeFords(grid: PlanGrid, rivers: readonly PlanRiver[], levels: Uint8Array, land: Uint8Array, lake: Int16Array, riverCell: Uint8Array): PlanFord[] {
  const fords: PlanFord[] = [];
  for (const river of rivers) {
    if (river.kind !== 'fluss') continue;
    const cells = river.cells;
    let lastFord = -Infinity;
    for (let i = WATER.fordEndMarginCells; i < cells.length - WATER.fordEndMarginCells; i++) {
      if (i - lastFord < WATER.fordSpacingCells) continue;
      const c = cells[i] as number;
      const next = cells[i + 1] as number;
      if (land[c] !== 1 || lake[c] !== -1) continue;
      const lv = levels[c] as number;
      if (levels[next] !== lv && land[next] === 1) continue;
      // Flow direction → the two bank cells perpendicular to it.
      let dir = 0;
      for (let d = 0; d < NEIGHBOURS_4; d++) if (neighbour4(grid, c, d) === next) dir = d;
      const left = neighbour4(grid, c, (dir + 1) % NEIGHBOURS_4);
      const right = neighbour4(grid, c, (dir + NEIGHBOURS_4 - 1) % NEIGHBOURS_4);
      const bank = (b: number): boolean => b >= 0 && land[b] === 1 && lake[b] === -1 && riverCell[b] === 0 && levels[b] === lv;
      if (!bank(left) || !bank(right)) continue;
      // Nearest polyline vertex to the cell centre.
      const cx = cellCenterX(grid, c);
      const cy = cellCenterY(grid, c);
      let vertex = 0;
      let bestD = Infinity;
      for (let v = 0; v < river.xs.length; v++) {
        const dx = (river.xs[v] as number) - cx;
        const dy = (river.ys[v] as number) - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          vertex = v;
        }
      }
      fords.push({ river: river.id, cell: c, vertex, x: river.xs[vertex] as number, y: river.ys[vertex] as number, level: lv });
      lastFord = i;
    }
  }
  return fords;
}
