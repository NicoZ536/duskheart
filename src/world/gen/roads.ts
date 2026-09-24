/**
 * World generation step 8, part 2 (M2-11, MASTERPROMPT §9.2.8): decayed Builder roads connecting the
 * beacon sites and the Nachtherz "als Orientierung".
 *
 * - Terminals: the six beacon sites and the Nachtherz site. A minimum spanning tree over their
 *   least-cost distances decides which pairs a road joins; the pairs are routed shortest first, and
 *   later roads prefer cells an earlier road already uses, so roads merge into a network.
 * - Routing (Dijkstra on the plan cells, 8-connected): only dry land of the main island; a level
 *   change only through an existing ramp or stairs (orthogonal step); rivers are crossed straight at
 *   a bridge cost (along a river only where nothing else leads on, at a high extra cost); lava
 *   cells, lakes and the sea are impassable; roads keep away from cliff edges and other places.
 * - Polyline: cell centres, smoothed with Chaikin's corner cutting between pinned points; pinned are
 *   the ramp crossings (the road runs straight through the ramp's centre) and the river crossings.
 *   Every vertex carries the level range it runs on; the chunk generator paves only tiles on that
 *   level, so a road never climbs a cliff beside its ramp.
 * - Tiles within `ROADS.halfWidthTiles` of the polyline form the corridor (no world objects); decay
 *   noise removes part of the pavement (`worldContext.ts`), and corridor tiles over river water are
 *   bridges.
 */
import { cellCenterX, cellCenterY, CellHeap, DX4, DY4, NEIGHBOURS_4, neighbour4, type PlanGrid } from './plan/grid';
import { MAIN_LANDMASS } from './plan/island';
import type { CellInfo, LocationSlot } from './locations';
import type { ReservedSegment, SurfaceContext } from './worldContext';

/** A road between two sites. */
export interface Road {
  readonly id: number;
  /** Slot ids of the two sites. */
  readonly from: number;
  readonly to: number;
  /** Plan cells of the route. */
  readonly cells: Int32Array;
  /** Polyline [tiles]. */
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  /** Level range per vertex (a ramp crossing spans two levels). */
  readonly levelMin: Uint8Array;
  readonly levelMax: Uint8Array;
}

/** Where a road crosses a river (the corridor tiles over the water become a bridge). */
export interface RoadCrossing {
  readonly road: number;
  /** River cell of the crossing. */
  readonly cell: number;
  /** Cell centre [tiles]. */
  readonly x: number;
  readonly y: number;
}

/** The road network. */
export interface RoadNetwork {
  readonly roads: readonly Road[];
  readonly crossings: readonly RoadCrossing[];
  /** Slot ids of the connected sites. */
  readonly terminals: readonly number[];
  /** Whether the roads join every terminal. */
  readonly connected: boolean;
  /** Total length [tiles]. */
  readonly lengthTiles: number;
}

export const ROADS = {
  /** Half width of the road corridor [tiles]. 3 tiles wide: two carts pass (§25). */
  halfWidthTiles: 1.5,
  /** Cost of a step onto a river cell (bridge) [cell steps]. Roads cross rivers, but not at every bend. */
  bridgeCost: 25,
  /**
   * Extra cost of a step from one river cell to the next [cell steps]. A road follows a river only
   * where no other way exists – out of a valley whose only exit is the river's gorge (≈ 1 in 300
   * worlds); there the corridor over the water becomes a boardwalk (bridge tiles).
   */
  alongRiverCost: 40,
  /** Cost of a ramp or stairs step [cell steps]. Roads prefer staying on one level. */
  rampCost: 3,
  /** Extra cost of a cell beside a cliff, lake or the sea [cell steps]. Roads run in the middle of plateaus. */
  edgeCost: 0.6,
  /** Extra cost of a cell inside another place [cell steps]. Roads pass by, not through. */
  placeCost: 30,
  /** Cost factor of a cell an earlier road already uses [factor]. Roads merge into a network. */
  reuseFactor: 0.35,
  /** Chaikin passes of the polyline between pinned points [passes]. Two passes round the 45° steps of the cell route. */
  smoothingPasses: 2,
} as const;

/** Chaikin cut position [fraction of a segment]. */
const CHAIKIN_CUT = 0.25;
/** 8-neighbour offsets. */
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1] as const;
/** Number of 8-neighbours. */
const NEIGHBOURS_8 = 8;

/** Routing data of one world. */
interface RouteGraph {
  readonly grid: PlanGrid;
  /** 1 = a road may use the cell. */
  readonly open: Uint8Array;
  /** Bit d set: a ramp or stairs connects the cell with its neighbour in direction d (0 E, 1 S, 2 W, 3 N). */
  readonly rampDir: Uint8Array;
  /** Base cost of entering a cell [cell steps]. */
  readonly enterCost: Float64Array;
  readonly level: Uint8Array;
  readonly river: Uint8Array;
}

/** Ramp direction bits per cell (both ends of every ramp). */
export function rampDirections(ctx: SurfaceContext): Uint8Array {
  const { plan, grid } = ctx;
  const bits = new Uint8Array(grid.count);
  for (const r of plan.ramps) {
    bits[r.low] = (bits[r.low] as number) | (1 << r.dir);
    bits[r.high] = (bits[r.high] as number) | (1 << ((r.dir + 2) % NEIGHBOURS_4));
  }
  return bits;
}

function buildGraph(ctx: SurfaceContext, cells: CellInfo, slotCells: Uint8Array): RouteGraph {
  const { plan, grid } = ctx;
  const open = new Uint8Array(grid.count);
  const enterCost = new Float64Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    if (cells.walk[c] !== 1 || plan.landmass[c] !== MAIN_LANDMASS) continue;
    open[c] = 1;
    let cost = 0;
    const lv = plan.level[c] as number;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const n = neighbour4(grid, c, d);
      if (n < 0 || cells.walk[n] !== 1 || plan.level[n] !== lv) {
        cost += ROADS.edgeCost;
        break;
      }
    }
    if (plan.riverCell[c] === 1) cost += ROADS.bridgeCost;
    if (slotCells[c] === 1) cost += ROADS.placeCost;
    enterCost[c] = cost;
  }
  return { grid, open, rampDir: rampDirections(ctx), enterCost, level: plan.level, river: plan.riverCell };
}

/** Direction index 0…3 of an orthogonal step, or −1. */
function orthogonalDir(dx: number, dy: number): number {
  for (let d = 0; d < NEIGHBOURS_4; d++) if (DX4[d] === dx && DY4[d] === dy) return d;
  return -1;
}

/** Whether a step u → v (offset dx, dy) is allowed and its cost; returns −1 when not allowed. */
function stepCost(g: RouteGraph, u: number, v: number, dx: number, dy: number, reuse: Uint8Array): number {
  if (g.open[v] !== 1) return -1;
  const lu = g.level[u] as number;
  const lv = g.level[v] as number;
  const riverU = g.river[u] === 1;
  const riverV = g.river[v] === 1;
  let base = riverU && riverV ? 1 + ROADS.alongRiverCost : 1;
  if (dx !== 0 && dy !== 0) {
    // Diagonal: both corner cells open, one level, no river involved.
    if (lu !== lv || riverU || riverV) return -1;
    const a = u + dx;
    const b = u + dy * g.grid.width;
    if (g.open[a] !== 1 || g.open[b] !== 1 || g.level[a] !== lu || g.level[b] !== lu || g.river[a] === 1 || g.river[b] === 1) return -1;
    base = Math.SQRT2;
  } else if (lu !== lv) {
    const d = orthogonalDir(dx, dy);
    if (Math.abs(lu - lv) !== 1 || d < 0 || (((g.rampDir[u] as number) >> d) & 1) === 0) return -1;
    base += ROADS.rampCost;
  }
  const cost = base + (g.enterCost[v] as number);
  return reuse[v] === 1 ? cost * ROADS.reuseFactor : cost;
}

/** Dijkstra from `source`; returns distances and predecessors. */
function dijkstra(g: RouteGraph, source: number, reuse: Uint8Array): { dist: Float64Array; prev: Int32Array } {
  const { grid } = g;
  const dist = new Float64Array(grid.count).fill(Infinity);
  const prev = new Int32Array(grid.count).fill(-1);
  const heap = new CellHeap(grid.count * NEIGHBOURS_8 + 1);
  dist[source] = 0;
  heap.push(source, 0);
  while (heap.size > 0) {
    const key = heap.peekKey();
    const u = heap.pop();
    if (key > (dist[u] as number)) continue;
    const ux = u % grid.width;
    const uy = Math.floor(u / grid.width);
    for (let k = 0; k < NEIGHBOURS_8; k++) {
      const dx = DX8[k] as number;
      const dy = DY8[k] as number;
      const vx = ux + dx;
      const vy = uy + dy;
      if (vx < 0 || vy < 0 || vx >= grid.width || vy >= grid.height) continue;
      const v = vy * grid.width + vx;
      const c = stepCost(g, u, v, dx, dy, reuse);
      if (c < 0) continue;
      const nd = key + c;
      if (nd < (dist[v] as number)) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd);
      }
    }
  }
  return { dist, prev };
}

/** A polyline point while building. */
interface Point {
  x: number;
  y: number;
  lmin: number;
  lmax: number;
  pinned: boolean;
}

/** Chaikin smoothing of one run with fixed ends. */
function chaikin(run: readonly Point[], passes: number): Point[] {
  let pts = run.slice();
  for (let pass = 0; pass < passes && pts.length > 2; pass++) {
    const out: Point[] = [pts[0] as Point];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i] as Point;
      const q = pts[i + 1] as Point;
      const lmin = Math.min(p.lmin, q.lmin);
      const lmax = Math.max(p.lmax, q.lmax);
      if (i > 0) out.push({ x: p.x + (q.x - p.x) * CHAIKIN_CUT, y: p.y + (q.y - p.y) * CHAIKIN_CUT, lmin, lmax, pinned: false });
      if (i + 2 < pts.length) out.push({ x: p.x + (q.x - p.x) * (1 - CHAIKIN_CUT), y: p.y + (q.y - p.y) * (1 - CHAIKIN_CUT), lmin, lmax, pinned: false });
    }
    out.push(pts[pts.length - 1] as Point);
    pts = out;
  }
  return pts;
}

/** Polyline of a route: cell centres, pinned ramp and river crossings, Chaikin between the pins. */
function routePolyline(ctx: SurfaceContext, path: readonly number[], rampHalfDepth: number): Point[] {
  const { plan, grid } = ctx;
  const pts: Point[] = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const c = path[i] as number;
    const lv = plan.level[c] as number;
    if (i > 0) {
      const p = path[i - 1] as number;
      const lp = plan.level[p] as number;
      if (lp !== lv) {
        // Ramp crossing: straight through the ramp's centre on the shared cell edge.
        const px = cellCenterX(grid, p);
        const py = cellCenterY(grid, p);
        const cx = cellCenterX(grid, c);
        const cy = cellCenterY(grid, c);
        const ux = (cx - px) / grid.cellTiles;
        const uy = (cy - py) / grid.cellTiles;
        const mx = (px + cx) / 2;
        const my = (py + cy) / 2;
        pts.push({ x: mx - ux * rampHalfDepth, y: my - uy * rampHalfDepth, lmin: lp, lmax: lp, pinned: true });
        pts.push({ x: mx + ux * rampHalfDepth, y: my + uy * rampHalfDepth, lmin: lv, lmax: lv, pinned: true });
      }
    }
    const nearRiver = plan.riverCell[c] === 1 || (i > 0 && plan.riverCell[path[i - 1] as number] === 1) || (i + 1 < n && plan.riverCell[path[i + 1] as number] === 1);
    pts.push({ x: cellCenterX(grid, c), y: cellCenterY(grid, c), lmin: lv, lmax: lv, pinned: i === 0 || i === n - 1 || nearRiver });
  }
  // Smooth each run between pinned points.
  const out: Point[] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!(pts[i] as Point).pinned && i < pts.length - 1) continue;
    const run = chaikin(pts.slice(start, i + 1), ROADS.smoothingPasses);
    if (out.length > 0) run.shift();
    out.push(...run);
    start = i;
  }
  if (out.length === 0 && pts.length > 0) out.push(pts[0] as Point);
  return out;
}

/** Union-find root. */
function root(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r] as number;
  let k = i;
  while (parent[k] !== r) {
    const next = parent[k] as number;
    parent[k] = r;
    k = next;
  }
  return r;
}

/** Cell of a slot centre. */
function slotCell(grid: PlanGrid, s: LocationSlot): number {
  return Math.floor(s.y / grid.cellTiles) * grid.width + Math.floor(s.x / grid.cellTiles);
}

/**
 * Builds the road network between the given sites (beacon sites and Nachtherz). `slotCells` marks
 * cells covered by places (roads avoid them); `rampHalfDepth` is half the ramp depth [tiles].
 */
export function buildRoads(ctx: SurfaceContext, cells: CellInfo, sites: readonly LocationSlot[], slotCells: Uint8Array, rampHalfDepth: number): RoadNetwork {
  const { plan, grid } = ctx;
  const g = buildGraph(ctx, cells, slotCells);
  const terminals = sites.map((s) => slotCell(grid, s));
  const none = new Uint8Array(grid.count);
  // Sites are always enterable (their own disc is a place).
  for (const t of terminals) {
    g.open[t] = 1;
    g.enterCost[t] = 0;
  }
  // Pairwise least costs → minimum spanning tree (Prim).
  const n = terminals.length;
  const pair = new Float64Array(n * n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const { dist } = dijkstra(g, terminals[i] as number, none);
    for (let j = 0; j < n; j++) pair[i * n + j] = dist[terminals[j] as number] as number;
  }
  const inTree = new Uint8Array(n);
  const edges: [number, number, number][] = [];
  if (n > 0) inTree[0] = 1;
  for (let added = 1; added < n; added++) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < n; i++) {
      if (inTree[i] !== 1) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j] === 1) continue;
        const c = pair[i * n + j] as number;
        if (c < Infinity && (best === null || c < best[2])) best = [i, j, c];
      }
    }
    if (best === null) break;
    inTree[best[1]] = 1;
    edges.push(best);
  }
  edges.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  // Route shortest first; later roads prefer cells already used.
  const reuse = new Uint8Array(grid.count);
  const roads: Road[] = [];
  const crossings: RoadCrossing[] = [];
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  let length = 0;
  for (const [i, j] of edges) {
    const a = terminals[i] as number;
    const b = terminals[j] as number;
    const { prev, dist } = dijkstra(g, a, reuse);
    if (!Number.isFinite(dist[b] as number)) continue;
    const path: number[] = [];
    for (let c = b; c >= 0; c = prev[c] as number) path.push(c);
    path.reverse();
    const id = roads.length;
    const pts = routePolyline(ctx, path, rampHalfDepth);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1] as Point;
      const q = pts[k] as Point;
      length += Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
    }
    for (const c of path) {
      reuse[c] = 1;
      if (plan.riverCell[c] === 1) crossings.push({ road: id, cell: c, x: cellCenterX(grid, c), y: cellCenterY(grid, c) });
    }
    roads.push({
      id,
      from: (sites[i] as LocationSlot).id,
      to: (sites[j] as LocationSlot).id,
      cells: Int32Array.from(path),
      xs: Float32Array.from(pts.map((p) => p.x)),
      ys: Float32Array.from(pts.map((p) => p.y)),
      levelMin: Uint8Array.from(pts.map((p) => p.lmin)),
      levelMax: Uint8Array.from(pts.map((p) => p.lmax)),
    });
    parent[root(parent, i)] = root(parent, j);
  }
  let connected = true;
  for (let i = 1; i < n; i++) if (root(parent, i) !== root(parent, 0)) connected = false;
  return { roads, crossings, terminals: sites.map((s) => s.id), connected, lengthTiles: length };
}

/** Corridor segments of the network (reservations). */
export function roadSegments(net: RoadNetwork): ReservedSegment[] {
  const out: ReservedSegment[] = [];
  for (const r of net.roads) {
    for (let i = 0; i + 1 < r.xs.length; i++) {
      out.push({
        x0: r.xs[i] as number,
        y0: r.ys[i] as number,
        x1: r.xs[i + 1] as number,
        y1: r.ys[i + 1] as number,
        half: ROADS.halfWidthTiles,
        levelMin: Math.min(r.levelMin[i] as number, r.levelMin[i + 1] as number),
        levelMax: Math.max(r.levelMax[i] as number, r.levelMax[i + 1] as number),
      });
    }
  }
  return out;
}

/** Plan cells a road runs through (1). */
export function roadCellMask(grid: PlanGrid, net: RoadNetwork): Uint8Array {
  const mask = new Uint8Array(grid.count);
  for (const r of net.roads) for (const c of r.cells) mask[c] = 1;
  return mask;
}
