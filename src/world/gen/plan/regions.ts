/**
 * World plan step 2 (M2-04, MASTERPROMPT §9.2.2): Poisson regions → Voronoi → region graph.
 *
 * Land splits into two kinds of cells: the coastal band (distance to the sea below the noisy band
 * width, later the Salzküste ring of §9.3; narrow interior tongues and small pieces join it) and the
 * interior. The ring gets evenly spaced seeds by
 * farthest-point sampling along the band (a Poisson-disc set with an exact count), the interior a
 * Bridson Poisson disc whose radius is refined until the total count meets the size target
 * (`BALANCE.world.regionCount`: ≈ 40 / 70 / 110). Cells join the nearest seed of their own kind and
 * piece (Voronoi restricted to the band or interior component), stray fragments join the neighbour
 * they touch most, so every region is one contiguous area; only islets without their own seed are
 * detached parts of the nearest ring region. Adjacent regions share an edge weighted by their
 * common border; sea crossings (raft, §25) join the landmasses into one connected graph.
 */
import { BALANCE, type WorldSizePreset } from '../../../content/balance';
import { createPlanFields, planRng, type PlanFields } from './fields';
import { cellCenterX, cellCenterY, labelComponents, neighbour4, NEIGHBOURS_4, signedDistanceField, type PlanGrid } from './grid';
import { MAIN_LANDMASS, type IslandMask } from './island';
import { REGIONS } from './params';
import { poissonDisc } from '../sampling';

/** Cell kind: sea. */
export const CELL_SEA = 0;
/** Cell kind: coastal band (Salzküste ring). */
export const CELL_BAND = 1;
/** Cell kind: interior. */
export const CELL_INTERIOR = 2;
/** Region id of sea cells. */
export const NO_REGION = -1;

/** Kind of a region: a segment of the coastal ring or an interior region. */
export type RegionKind = 'band' | 'interior';

/** One region of the plan. */
export interface PlanRegion {
  readonly id: number;
  readonly kind: RegionKind;
  /** Voronoi seed [tiles]. */
  readonly seedX: number;
  readonly seedY: number;
  /** Centre of mass of the region's cells [tiles]. */
  readonly centroidX: number;
  readonly centroidY: number;
  /** Area [cells]. */
  readonly cells: number;
  /** Landmass of the seed (0 = main island). */
  readonly landmass: number;
  /** Whether a cell of the region touches the sea. */
  readonly coastal: boolean;
  /** Whether the region owns cells on another landmass (a small islet without its own seed). */
  readonly detached: boolean;
}

/** An edge of the region graph (`a < b`). */
export interface PlanEdge {
  readonly a: number;
  readonly b: number;
  /** Shared border [cell edges]; 0 for sea crossings. */
  readonly border: number;
  /** Whether the regions only meet across the sea (raft crossing). */
  readonly crossing: boolean;
}

/** Result of step 2. */
export interface RegionMap {
  readonly grid: PlanGrid;
  /** Signed distance to the coast per cell [tiles]: positive on land, negative at sea. */
  readonly coastDistance: Float32Array;
  /** Cell kind (`CELL_SEA`, `CELL_BAND`, `CELL_INTERIOR`). */
  readonly cellKind: Uint8Array;
  /** Region per cell, `NO_REGION` at sea. */
  readonly region: Int16Array;
  readonly regions: readonly PlanRegion[];
  readonly edges: readonly PlanEdge[];
  /** Neighbour region ids per region, ascending. */
  readonly neighbours: readonly (readonly number[])[];
  /** Target region count of the world size. */
  readonly target: number;
}

/** Farthest-point sampling of `count` seeds among `candidates` (cell indices) → seed cells. */
function farthestPointSeeds(grid: PlanGrid, candidates: readonly number[], count: number, first: number): number[] {
  const n = candidates.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = cellCenterX(grid, candidates[i] as number);
    ys[i] = cellCenterY(grid, candidates[i] as number);
  }
  const best = new Float64Array(n).fill(Infinity);
  const seeds: number[] = [];
  let next = first;
  while (seeds.length < count && next >= 0) {
    seeds.push(candidates[next] as number);
    const sx = xs[next] as number;
    const sy = ys[next] as number;
    let far = -1;
    let farD = 0;
    for (let i = 0; i < n; i++) {
      const dx = (xs[i] as number) - sx;
      const dy = (ys[i] as number) - sy;
      const d = dx * dx + dy * dy;
      if (d < (best[i] as number)) best[i] = d;
      if ((best[i] as number) > farD) {
        farD = best[i] as number;
        far = i;
      }
    }
    next = far;
  }
  return seeds;
}

interface Seed {
  x: number;
  y: number;
  kind: number;
  cell: number;
}

/** Interior Poisson seeds whose count approaches `target` (radius refinement, deterministic per attempt). */
function interiorSeeds(worldSeed: number, attempt: number, grid: PlanGrid, cellKind: Uint8Array, target: number): Seed[] {
  let interiorCells = 0;
  for (let c = 0; c < grid.count; c++) if (cellKind[c] === CELL_INTERIOR) interiorCells++;
  if (interiorCells === 0 || target <= 0) return [];
  const area = interiorCells * grid.cellTiles * grid.cellTiles;
  const accept = (x: number, y: number): boolean => cellKind[Math.floor(y / grid.cellTiles) * grid.width + Math.floor(x / grid.cellTiles)] === CELL_INTERIOR;
  let r = Math.sqrt((REGIONS.poissonDensity * area) / target);
  let best: { xs: Float64Array; ys: Float64Array; count: number } | null = null;
  for (let it = 0; it < REGIONS.poissonIterations; it++) {
    const pts = poissonDisc(planRng(worldSeed, attempt, 'regions.poisson'), grid.tiles, grid.tiles, r, { accept });
    if (best === null || Math.abs(pts.count - target) < Math.abs(best.count - target)) best = pts;
    if (Math.abs(pts.count - target) <= REGIONS.poissonTolerance * target || pts.count === 0) break;
    r *= Math.sqrt(pts.count / target);
  }
  const seeds: Seed[] = [];
  if (best === null) return seeds;
  for (let i = 0; i < best.count; i++) {
    const x = best.xs[i] as number;
    const y = best.ys[i] as number;
    seeds.push({ x, y, kind: CELL_INTERIOR, cell: Math.floor(y / grid.cellTiles) * grid.width + Math.floor(x / grid.cellTiles) });
  }
  return seeds;
}

/** Classifies land cells into band and interior (interior tongues narrower than 3 cells and small interior pieces join the band). */
function classifyCells(grid: PlanGrid, island: IslandMask, coastDistance: Float32Array, fields: PlanFields): Uint8Array {
  const kind = new Uint8Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    if (island.land[c] !== 1) continue;
    kind[c] = (coastDistance[c] as number) < fields.bandWidthAt(cellCenterX(grid, c), cellCenterY(grid, c)) ? CELL_BAND : CELL_INTERIOR;
  }
  // Morphological opening (3 × 3): tongues of the interior narrower than three cells join the ring,
  // so the ring/inland border has no fingers thinner than its transition strip.
  const { width: w, height: h } = grid;
  const interiorAround = (src: Uint8Array, c: number, all: boolean): boolean => {
    const x = c % w;
    const y = Math.floor(c / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const inside = xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx] === CELL_INTERIOR;
        if (all && !inside) return false;
        if (!all && inside) return true;
      }
    }
    return all;
  };
  const eroded = new Uint8Array(grid.count);
  for (let c = 0; c < grid.count; c++) if (kind[c] === CELL_INTERIOR && interiorAround(kind, c, true)) eroded[c] = CELL_INTERIOR;
  for (let c = 0; c < grid.count; c++) if (kind[c] === CELL_INTERIOR && !interiorAround(eroded, c, false)) kind[c] = CELL_BAND;
  const pieces = labelComponents(grid, (c) => kind[c] === CELL_INTERIOR);
  for (let c = 0; c < grid.count; c++) {
    const id = pieces.label[c] as number;
    if (id >= 0 && (pieces.sizes[id] as number) < REGIONS.minInteriorPieceCells) kind[c] = CELL_BAND;
  }
  return kind;
}

/** Pieces: 4-connected components of land cells of the same kind. */
function labelKindPieces(grid: PlanGrid, cellKind: Uint8Array): { label: Int32Array; count: number } {
  const label = new Int32Array(grid.count).fill(-1);
  const queue = new Int32Array(grid.count);
  let count = 0;
  for (let s = 0; s < grid.count; s++) {
    const k = cellKind[s] as number;
    if (k === CELL_SEA || label[s] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = count;
    while (head < tail) {
      const c = queue[head++] as number;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || label[n] !== -1 || cellKind[n] !== k) continue;
        label[n] = count;
        queue[tail++] = n;
      }
    }
    count++;
  }
  return { label, count };
}

/** Nearest seed of the cell's own kind and piece (Voronoi restricted to the piece; pieces without a seed use all seeds of the kind). */
function assignCells(grid: PlanGrid, cellKind: Uint8Array, seeds: readonly Seed[]): Int16Array {
  const region = new Int16Array(grid.count).fill(NO_REGION);
  const pieces = labelKindPieces(grid, cellKind);
  const perPiece: number[][] = [];
  for (let p = 0; p < pieces.count; p++) perPiece.push([]);
  const perKind: number[][] = [[], [], []];
  seeds.forEach((s, id) => {
    (perPiece[pieces.label[s.cell] as number] as number[]).push(id);
    (perKind[s.kind] as number[]).push(id);
  });
  const sx = Float64Array.from(seeds.map((s) => s.x));
  const sy = Float64Array.from(seeds.map((s) => s.y));
  for (let c = 0; c < grid.count; c++) {
    const k = cellKind[c] as number;
    if (k === CELL_SEA) continue;
    const own = perPiece[pieces.label[c] as number] as number[];
    const candidates = own.length > 0 ? own : (perKind[k] as number[]);
    const x = cellCenterX(grid, c);
    const y = cellCenterY(grid, c);
    let bestId = -1;
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const id = candidates[i] as number;
      const dx = (sx[id] as number) - x;
      const dy = (sy[id] as number) - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestId = id;
      }
    }
    region[c] = bestId;
  }
  return region;
}

/**
 * Closest pair of coast cells per pair of landmasses, by a multi-source breadth-first search over
 * the sea (each sea cell remembers the land cell its front started from).
 */
function landmassGaps(grid: PlanGrid, island: IslandMask): { d: number; a: number; b: number; ca: number; cb: number }[] {
  const source = new Int32Array(grid.count).fill(-1);
  const dist = new Int32Array(grid.count).fill(-1);
  const queue = new Int32Array(grid.count);
  let tail = 0;
  for (let c = 0; c < grid.count; c++) {
    if (island.land[c] !== 1) continue;
    source[c] = c;
    dist[c] = 0;
    queue[tail++] = c;
  }
  const best = new Map<number, { d: number; a: number; b: number; ca: number; cb: number }>();
  const lmCount = island.landmassSizes.length;
  for (let head = 0; head < tail; head++) {
    const c = queue[head] as number;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const n = neighbour4(grid, c, d);
      if (n < 0) continue;
      if (source[n] === -1) {
        source[n] = source[c] as number;
        dist[n] = (dist[c] as number) + 1;
        queue[tail++] = n;
        continue;
      }
      const la = island.landmass[source[c] as number] as number;
      const lb = island.landmass[source[n] as number] as number;
      if (la === lb) continue;
      const gap = (dist[c] as number) + (dist[n] as number) + 1;
      const a = Math.min(la, lb);
      const b = Math.max(la, lb);
      const ca = la < lb ? (source[c] as number) : (source[n] as number);
      const cb = la < lb ? (source[n] as number) : (source[c] as number);
      const key = a * lmCount + b;
      const cur = best.get(key);
      if (cur === undefined || gap < cur.d || (gap === cur.d && (ca < cur.ca || (ca === cur.ca && cb < cur.cb)))) best.set(key, { d: gap, a, b, ca, cb });
    }
  }
  return [...best.values()];
}

/** Joins every fragment that is cut off from its seed to the reached neighbour it borders most. */
function mergeFragments(grid: PlanGrid, cellKind: Uint8Array, region: Int16Array, seeds: readonly Seed[]): void {
  const queue = new Int32Array(grid.count);
  const reached = new Uint8Array(grid.count);
  for (let round = 0; round < grid.count; round++) {
    reached.fill(0);
    let tail = 0;
    seeds.forEach((s, id) => {
      if (region[s.cell] === id) {
        reached[s.cell] = 1;
        queue[tail++] = s.cell;
      }
    });
    let head = 0;
    while (head < tail) {
      const c = queue[head++] as number;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || reached[n] === 1 || region[n] !== region[c]) continue;
        reached[n] = 1;
        queue[tail++] = n;
      }
    }
    const blobs = labelComponents(grid, (c) => region[c] !== NO_REGION && reached[c] === 0);
    if (blobs.sizes.length === 0) return;
    // Border tally per blob: prefer neighbours of the same kind, then the longest border.
    const tally = blobs.sizes.map(() => new Map<number, number>());
    for (let c = 0; c < grid.count; c++) {
      const b = blobs.label[c] as number;
      if (b < 0) continue;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || reached[n] === 0) continue;
        const r = region[n] as number;
        const t = tally[b] as Map<number, number>;
        const sameKind = cellKind[n] === cellKind[c] ? grid.count : 1;
        t.set(r, (t.get(r) ?? 0) + sameKind);
      }
    }
    const target = blobs.sizes.map((_, b) => {
      let best = -1;
      let bestScore = 0;
      for (const [r, score] of tally[b] as Map<number, number>) {
        if (score > bestScore || (score === bestScore && r < best)) {
          bestScore = score;
          best = r;
        }
      }
      return best;
    });
    let changed = false;
    for (let c = 0; c < grid.count; c++) {
      const b = blobs.label[c] as number;
      if (b < 0) continue;
      const r = target[b] as number;
      if (r < 0) continue;
      region[c] = r;
      cellKind[c] = (seeds[r] as Seed).kind;
      changed = true;
    }
    if (!changed) return;
  }
}

/** Generates regions and the region graph for an island. */
export function generateRegions(worldSeed: number, attempt: number, preset: WorldSizePreset, island: IslandMask): RegionMap {
  const grid = island.grid;
  const fields = createPlanFields(worldSeed, attempt, preset, grid.tiles);
  const coastDistance = signedDistanceField(grid, (c) => island.land[c] === 1);
  const cellKind = classifyCells(grid, island, coastDistance, fields);
  const target = BALANCE.world.regionCount[preset];

  // Ring seeds: farthest-point sampling on the band of the main island and of islets large enough for a region.
  const bandCandidates: number[] = [];
  for (let c = 0; c < grid.count; c++) {
    if (cellKind[c] !== CELL_BAND) continue;
    const lm = island.landmass[c] as number;
    if (lm === MAIN_LANDMASS || (island.landmassSizes[lm] as number) >= REGIONS.minSeededIsletCells) bandCandidates.push(c);
  }
  const rng = planRng(worldSeed, attempt, 'regions');
  const bandCount = Math.min(bandCandidates.length, Math.max(1, Math.round(target * REGIONS.bandShare)));
  const bandCells = bandCandidates.length > 0 ? farthestPointSeeds(grid, bandCandidates, bandCount, rng.int(0, bandCandidates.length)) : [];
  const seeds: Seed[] = bandCells.map((cell) => ({ x: cellCenterX(grid, cell), y: cellCenterY(grid, cell), kind: CELL_BAND, cell }));

  // Interior seeds: Poisson disc tuned to the remaining count; every interior piece gets at least one seed.
  const inner = interiorSeeds(worldSeed, attempt, grid, cellKind, target - seeds.length);
  const pieces = labelComponents(grid, (c) => cellKind[c] === CELL_INTERIOR);
  const seeded = new Uint8Array(pieces.sizes.length);
  for (const s of inner) seeded[pieces.label[s.cell] as number] = 1;
  const deepest = new Int32Array(pieces.sizes.length).fill(-1);
  for (let c = 0; c < grid.count; c++) {
    const p = pieces.label[c] as number;
    if (p < 0 || seeded[p] === 1) continue;
    const cur = deepest[p] as number;
    if (cur < 0 || (coastDistance[c] as number) > (coastDistance[cur] as number)) deepest[p] = c;
  }
  for (let p = 0; p < pieces.sizes.length; p++) {
    const c = deepest[p] as number;
    if (c >= 0) inner.push({ x: cellCenterX(grid, c), y: cellCenterY(grid, c), kind: CELL_INTERIOR, cell: c });
  }
  seeds.push(...inner);

  const region = assignCells(grid, cellKind, seeds);
  mergeFragments(grid, cellKind, region, seeds);

  // Region statistics.
  const n = seeds.length;
  const cells = new Float64Array(n);
  const sumX = new Float64Array(n);
  const sumY = new Float64Array(n);
  const coastal = new Uint8Array(n);
  const detached = new Uint8Array(n);
  const borders = new Int32Array(n * n);
  for (let c = 0; c < grid.count; c++) {
    const r = region[c] as number;
    if (r < 0) continue;
    cells[r] = (cells[r] as number) + 1;
    sumX[r] = (sumX[r] as number) + cellCenterX(grid, c);
    sumY[r] = (sumY[r] as number) + cellCenterY(grid, c);
    if (island.landmass[c] !== island.landmass[(seeds[r] as Seed).cell]) detached[r] = 1;
    for (let d = 0; d < 2; d++) {
      const nb = neighbour4(grid, c, d);
      if (nb < 0) continue;
      const q = region[nb] as number;
      if (q < 0 || q === r) continue;
      const a = Math.min(r, q);
      const b = Math.max(r, q);
      borders[a * n + b] = (borders[a * n + b] as number) + 1;
    }
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const nb = neighbour4(grid, c, d);
      if (nb >= 0 && island.land[nb] === 0) coastal[r] = 1;
    }
  }
  const edges: PlanEdge[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const border = borders[a * n + b] as number;
      if (border > 0) edges.push({ a, b, border, crossing: false });
    }
  }

  // Sea crossings: minimum spanning tree over the landmasses (closest coast cells).
  const pairs = landmassGaps(grid, island);
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  const parent = island.landmassSizes.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (const p of pairs) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    const r1 = region[p.ca] as number;
    const r2 = region[p.cb] as number;
    if (r1 === r2) continue;
    const a = Math.min(r1, r2);
    const b = Math.max(r1, r2);
    if (borders[a * n + b] === 0) {
      borders[a * n + b] = -1;
      edges.push({ a, b, border: 0, crossing: true });
    }
  }
  edges.sort((p, q) => p.a - q.a || p.b - q.b);
  const neighbours: number[][] = seeds.map(() => []);
  for (const e of edges) {
    (neighbours[e.a] as number[]).push(e.b);
    (neighbours[e.b] as number[]).push(e.a);
  }
  for (const list of neighbours) list.sort((p, q) => p - q);

  const regions: PlanRegion[] = seeds.map((s, id) => {
    const count = cells[id] as number;
    return {
      id,
      kind: s.kind === CELL_BAND ? 'band' : 'interior',
      seedX: s.x,
      seedY: s.y,
      centroidX: count > 0 ? (sumX[id] as number) / count : s.x,
      centroidY: count > 0 ? (sumY[id] as number) / count : s.y,
      cells: count,
      landmass: island.landmass[s.cell] as number,
      coastal: coastal[id] === 1,
      detached: detached[id] === 1,
    };
  });
  return { grid, coastDistance, cellKind, region, regions, edges, neighbours, target };
}
