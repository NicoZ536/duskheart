/**
 * The chunk hierarchy of the path search (HPA*, M6-16, §19.4 "hierarchisch für weite Strecken"; docs/SPIEL.md §12).
 *
 * - **Portals:** along each border between two chunks, the stretches where a straight step across is legal for the
 *   mover (both tiles pass, levels joined) and that stay in one connected area on either side are entrances; each gets
 *   one portal pair per `portalSpacingTiles`, spread evenly (a door in a wall is an entrance of one tile). A border's
 *   portals depend on its two chunks only. Every way across a border passes an entrance whose portal lies in the same
 *   areas, so the portal graph is complete: when it has no way, the window has none either.
 * - **Abstract graph per layer and mover profile:** the portals of the window's chunks, joined inside a chunk by their
 *   exact distances (a Dijkstra from the portal tile that never leaves the chunk, kept as its distances to every border
 *   tile of the chunk) and across a border by one straight step. Start and goal join the portals of their chunk that
 *   lie in their connected area of the chunk (the chunk's areas are labelled once) at the straight-line distance – a
 *   lower bound, so the search stays admissible without searching inside the chunks per request; when the refined
 *   first or last leg turns out much longer than that (a winding area), the caller routes again with the exact
 *   distances of a Dijkstra inside the chunk for that end (`exactStart`, `exactGoal`).
 * - **Cache:** areas and distance fields per chunk version and mover profile, portals per border and the versions of
 *   its two chunks (`PathGrid.versions`). The main thread gives a chunk a new version when a tile in or next to it
 *   changes (`WorldCollision.addChangeListener`), so exactly the changed chunks are rebuilt; the window of a request
 *   never enters a key. The cache only saves time: the same tile words always give the same portals and distances, in
 *   the worker and in the simulation.
 * - **Path:** A* over the portals yields a chain of portals (to the goal, or – when the goal cannot be reached – to the
 *   expanded portal nearest to it); the caller refines each leg with a jump point search that never leaves its chunk
 *   (src/world/path/find.ts), so no search scans more than one chunk. The path is at most as long as the portal path;
 *   the portals' spacing costs a few per cent against the optimum (tested: ≤ 10 %). Light (shadow brood) is left out
 *   of the cached graph (it changes every tick); the legs respect it and the caller falls back to a direct search when
 *   light closes one.
 */
import { BALANCE } from '../../content/balance';
import { CHUNK_SHIFT, CHUNK_SIZE } from '../model/coords';
import { DOOR_COST, PATH_DOOR, PATH_INFINITY, PATH_LIGHT, STEP_DIAGONAL, STEP_STRAIGHT, grow, octile, type PathGrid, type PathProfile } from './grid';
import { NodeHeap } from './heap';
import type { GridSearch } from './search';

/** Border sides: north, east, south, west. */
const SIDE_N = 0;
const SIDE_E = 1;
const SIDE_S = 2;
const SIDE_W = 3;
const SIDES = 4;
/** Opposite side of each side. */
const OPPOSITE = [SIDE_S, SIDE_W, SIDE_N, SIDE_E] as const;
/** Chunk offset of the neighbour on each side. */
const SIDE_DX = [0, 1, 0, -1] as const;
const SIDE_DY = [-1, 0, 1, 0] as const;
/** Tiles per chunk. */
const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;
/** Last tile index along a border. */
const LAST = CHUNK_SIZE - 1;
/** Most portals on one border (one per tile when every tile is its own entrance). */
export const MAX_BORDER_PORTALS = CHUNK_SIZE;
/** Most portals of one chunk. */
export const MAX_PORTALS = SIDES * MAX_BORDER_PORTALS;
/** Border directions of a `BorderPortals`: the east or the south border of its first chunk. */
export const BORDER_EAST = 0;
export const BORDER_SOUTH = 1;
/** Most connected areas the start or goal tile touches (itself and its eight neighbours). */
const TOUCHED_AREAS = 9;
/** How `route` ended: a portal chain to the goal, one to the portal nearest to it, or none at all. */
export const ROUTE_FOUND = 0;
export const ROUTE_NEAREST = 1;
export const ROUTE_NONE = 2;
/** Largest node stamp of a chunk Dijkstra before its stamp arrays are cleared (fits a Uint32Array). */
const MAX_DIJKSTRA_STAMP = 0xffff_fff0;
/** Neighbour offsets (x, y) of a tile. */
const DIR_X = [1, 0, -1, 0, 1, -1, -1, 1] as const;
const DIR_Y = [0, 1, 0, -1, 1, 1, -1, -1] as const;

/** Border index of each chunk-local tile (0 … `BORDER_TILES` − 1), −1 inside. */
const BORDER_INDEX = new Int16Array(CHUNK_TILES).fill(-1);
let borderTiles = 0;
for (let i = 0; i < CHUNK_TILES; i++) {
  const x = i & LAST;
  const y = i >> CHUNK_SHIFT;
  if (x === 0 || y === 0 || x === LAST || y === LAST) BORDER_INDEX[i] = borderTiles++;
}
/** Tiles on the border of a chunk. */
export const BORDER_TILES = borderTiles;

/** Border index of a chunk-local tile (−1 inside the chunk). */
export function borderIndex(local: number): number {
  return BORDER_INDEX[local] as number;
}

/** Chunk-local tile at position `pos` of `side`. */
export function borderTile(side: number, pos: number): number {
  switch (side) {
    case SIDE_N:
      return pos;
    case SIDE_S:
      return (LAST << CHUNK_SHIFT) | pos;
    case SIDE_E:
      return (pos << CHUNK_SHIFT) | LAST;
    default:
      return pos << CHUNK_SHIFT;
  }
}

/** Connected areas and portal distance fields of one chunk version for one profile. */
export class ChunkAreas {
  version = 0;
  profile = -1;
  /** Connected area of each tile inside the chunk (1, 2, …; 0 = does not pass). */
  readonly comp = new Uint16Array(CHUNK_TILES);
  /** Legal steps of each tile that stay inside the chunk: bit d for the direction (`DIR_X[d]`, `DIR_Y[d]`), without light. */
  readonly steps = new Uint8Array(CHUNK_TILES);
  /** Distances from a border tile to every border tile inside the chunk, by border index (`null` = not computed). */
  readonly fields: Array<Int32Array | null> = new Array<Int32Array | null>(BORDER_TILES).fill(null);
}

/** Portals of one border (between two chunk versions) for one profile. */
export class BorderPortals {
  /** Version of the west (east border) or north (south border) chunk. */
  first = 0;
  /** Version of the other chunk. */
  second = 0;
  /** `BORDER_EAST` or `BORDER_SOUTH`. */
  dir = 0;
  profile = -1;
  count = 0;
  /** Position of each portal along the border. */
  readonly pos = new Uint8Array(MAX_BORDER_PORTALS);
}

/**
 * Areas, distance fields and border portals, per version – one cache per thread (the simulation's in-thread search
 * and the worker each keep their own). Bounded: when full, the oldest versions are dropped.
 */
export class PortalCache {
  private readonly areas = new Map<number, ChunkAreas[]>();
  private readonly borders = new Map<number, BorderPortals[]>();
  private areaCount = 0;
  private borderCount = 0;
  private readonly spareAreas: ChunkAreas[] = [];
  private readonly spareBorders: BorderPortals[] = [];
  private readonly spareFields: Int32Array[] = [];
  /** Area sets, border portal sets and distance fields built (statistics for tests and the debug view). */
  areasBuilt = 0;
  bordersBuilt = 0;
  fieldsBuilt = 0;

  constructor(readonly capacity: number = BALANCE.ai.path.abstractCacheEntries) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`PortalCache: capacity must be a positive integer, got ${String(capacity)}`);
  }

  /** The cached areas of a chunk version and profile, or `undefined`. */
  areasOf(version: number, profile: number): ChunkAreas | undefined {
    const list = this.areas.get(version);
    if (list === undefined) return undefined;
    for (let i = 0; i < list.length; i++) if ((list[i] as ChunkAreas).profile === profile) return list[i];
    return undefined;
  }

  /** A fresh (cleared) areas entry for a chunk version and profile. */
  addAreas(version: number, profile: number): ChunkAreas {
    let list = this.areas.get(version);
    if (list === undefined) {
      while (this.areaCount >= this.capacity && this.areas.size > 0) this.evictAreas();
      list = [];
      this.areas.set(version, list);
    }
    const e = this.spareAreas.pop() ?? new ChunkAreas();
    e.version = version;
    e.profile = profile;
    e.comp.fill(0);
    list.push(e);
    this.areaCount++;
    this.areasBuilt++;
    return e;
  }

  /** A distance field array for an areas entry. */
  field(): Int32Array {
    this.fieldsBuilt++;
    return this.spareFields.pop() ?? new Int32Array(BORDER_TILES);
  }

  /** The cached portals of a border, or `undefined`. */
  borderOf(first: number, second: number, dir: number, profile: number): BorderPortals | undefined {
    const list = this.borders.get(first);
    if (list === undefined) return undefined;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as BorderPortals;
      if (e.second === second && e.dir === dir && e.profile === profile) return e;
    }
    return undefined;
  }

  /** A fresh (empty) portal set of a border. */
  addBorder(first: number, second: number, dir: number, profile: number): BorderPortals {
    let list = this.borders.get(first);
    if (list === undefined) {
      while (this.borderCount >= this.capacity * SIDES && this.borders.size > 0) this.evictBorders();
      list = [];
      this.borders.set(first, list);
    }
    const e = this.spareBorders.pop() ?? new BorderPortals();
    e.first = first;
    e.second = second;
    e.dir = dir;
    e.profile = profile;
    e.count = 0;
    list.push(e);
    this.borderCount++;
    this.bordersBuilt++;
    return e;
  }

  /** Number of cached area sets. */
  get size(): number {
    return this.areaCount;
  }

  private evictAreas(): void {
    for (const [version, list] of this.areas) {
      this.areas.delete(version);
      this.areaCount -= list.length;
      for (const e of list) {
        for (let i = 0; i < e.fields.length; i++) {
          const f = e.fields[i];
          if (f !== null && f !== undefined) this.spareFields.push(f);
          e.fields[i] = null;
        }
        this.spareAreas.push(e);
      }
      return;
    }
  }

  private evictBorders(): void {
    for (const [first, list] of this.borders) {
      this.borders.delete(first);
      this.borderCount -= list.length;
      for (const e of list) this.spareBorders.push(e);
      return;
    }
  }
}

/**
 * Dijkstra inside one chunk over the cached legal steps of its areas (`ChunkAreas.steps`) – the distance fields of the
 * portals and the exact distances of start and goal. Light (a request's `PATH_LIGHT`) blocks entering a lit tile and
 * cutting past one.
 */
class ChunkDijkstra {
  private words: Uint16Array = new Uint16Array(0);
  private width = 0;
  private base = 0;
  private readonly g = new Int32Array(CHUNK_TILES);
  private readonly f = new Int32Array(CHUNK_TILES);
  private readonly seen = new Uint32Array(CHUNK_TILES);
  private readonly closed = new Uint32Array(CHUNK_TILES);
  private stamp = 0;
  private readonly heap = new NodeHeap();

  /**
   * Distances from chunk-local tile `start` of window chunk (cx, cy) to every tile of the chunk into `out`
   * (`PATH_INFINITY` where unreachable); `reverse` gives the distances to it (a door costs where a step enters it).
   * Stops after `maxNodes` expanded nodes. Returns the nodes it expanded.
   */
  run(grid: PathGrid, areas: ChunkAreas, cx: number, cy: number, start: number, reverse: boolean, light: boolean, opensDoors: boolean, out: Int32Array, maxNodes: number): number {
    out.fill(PATH_INFINITY, 0, CHUNK_TILES);
    this.words = grid.words;
    this.width = grid.width;
    this.base = (cy << CHUNK_SHIFT) * grid.width + (cx << CHUNK_SHIFT);
    const lightBits = light ? PATH_LIGHT : 0;
    const doorBits = opensDoors ? PATH_DOOR : 0;
    // The reverse search needs a goal a mover can stand on.
    if (reverse && (areas.comp[start] === 0 || (this.wordAt(start) & lightBits) !== 0)) return 0;
    if (this.stamp >= MAX_DIJKSTRA_STAMP) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 0;
    }
    const stamp = ++this.stamp;
    this.heap.reset(CHUNK_TILES, this.f, this.g);
    this.seen[start] = stamp;
    this.g[start] = 0;
    this.f[start] = 0;
    this.heap.push(start);
    let pops = 0;
    for (;;) {
      if (pops >= maxNodes) return pops;
      const n = this.heap.pop();
      if (n < 0) return pops;
      this.closed[n] = stamp;
      pops++;
      const gn = this.g[n] as number;
      out[n] = gn;
      const legal = areas.steps[n] as number;
      for (let d = 0; d < DIR_X.length; d++) {
        if ((legal & (1 << d)) === 0) continue;
        const dx = DIR_X[d] as number;
        const dy = DIR_Y[d] as number;
        const m = n + dy * CHUNK_SIZE + dx;
        if (this.closed[m] === stamp) continue;
        const wm = this.wordAt(m);
        if (lightBits !== 0) {
          if ((wm & lightBits) !== 0) continue;
          if (dx !== 0 && dy !== 0 && ((this.wordAt(n + dx) | this.wordAt(n + dy * CHUNK_SIZE)) & lightBits) !== 0) continue;
        }
        // Forward the step enters m; in reverse it runs from m to n and enters n.
        const entered = reverse ? this.wordAt(n) : wm;
        const cost = gn + (dx !== 0 && dy !== 0 ? STEP_DIAGONAL : STEP_STRAIGHT) + ((entered & doorBits) !== 0 ? DOOR_COST : 0);
        if (this.seen[m] === stamp && cost >= (this.g[m] as number)) continue;
        this.seen[m] = stamp;
        this.g[m] = cost;
        this.f[m] = cost;
        this.heap.push(m);
      }
    }
  }

  /** Word of chunk-local tile `local` of the chunk of the current run. */
  private wordAt(local: number): number {
    return this.words[this.base + (local >> CHUNK_SHIFT) * this.width + (local & LAST)] as number;
  }
}

/** Whether `area` is among the first `count` entries of `areas`. */
function hasArea(areas: Int32Array, count: number, area: number): boolean {
  for (let i = 0; i < count; i++) if (areas[i] === area) return true;
  return false;
}

/**
 * HPA* over the window of a `PathGrid` (see module comment). Uses the caller's `GridSearch` (bound to the grid and
 * the request's profile) for the chunk searches.
 */
export class HierarchicalSearch {
  private readonly heap = new NodeHeap();
  private g = new Int32Array(0);
  private f = new Int32Array(0);
  private parent = new Int32Array(0);
  private seen = new Uint8Array(0);
  private closed = new Uint8Array(0);
  // Portals of the window's chunks, assembled per request from the cached borders.
  private ready = new Uint8Array(0);
  private count = new Int32Array(0);
  private sideStart = new Int32Array(0);
  private ptile = new Int32Array(0);
  private pside = new Uint8Array(0);
  private pj = new Uint8Array(0);
  private areasAt: Array<ChunkAreas | null> = [];
  private areasReady = new Uint8Array(0);
  private readonly distScratch = new Int32Array(CHUNK_TILES);
  private readonly stack = new Int32Array(CHUNK_TILES);
  private readonly startAreas = new Int32Array(TOUCHED_AREAS);
  private readonly goalAreas = new Int32Array(TOUCHED_AREAS);
  private readonly startDist = new Int32Array(CHUNK_TILES);
  private readonly goalDist = new Int32Array(CHUNK_TILES);
  private readonly dijkstra = new ChunkDijkstra();
  /** Window tiles of the portal chain of the last `route`, from the first portal after the start on. */
  chainX = new Int32Array(0);
  chainY = new Int32Array(0);
  chainLength = 0;
  /** Nodes expanded by the last `route` (portal pops and the exact chunk searches of start and goal). */
  expanded = 0;

  constructor(readonly cache: PortalCache) {}

  /**
   * Finds a chain of portals from window tile (sx, sy) to (gx, gy): `ROUTE_FOUND` (the chain ends in the goal's
   * chunk), `ROUTE_NEAREST` (no way, or the node limit ran out: the chain ends at the expanded portal nearest to the
   * goal) or `ROUTE_NONE` (the start reaches no portal). `chainX`/`chainY`/`chainLength` and `expanded` hold the
   * outcome. `tiles` is bound to the grid and the request's profile; the cached portal graph ignores the request's light,
   * the exact searches of start (`exactStart`) and goal (`exactGoal`) see it.
   */
  route(grid: PathGrid, profile: PathProfile, tiles: GridSearch, lit: boolean, sx: number, sy: number, gx: number, gy: number, maxNodes: number, exactStart = false, exactGoal = false): number {
    const cw = grid.cw;
    const chunks = cw * grid.ch;
    const nodes = chunks * MAX_PORTALS + 2;
    this.ensure(chunks, nodes);
    this.ready.fill(0, 0, chunks);
    this.areasReady.fill(0, 0, chunks);
    this.chainLength = 0;
    this.seen.fill(0, 0, nodes);
    this.closed.fill(0, 0, nodes);
    this.expanded = 0;
    const scx = sx >> CHUNK_SHIFT;
    const scy = sy >> CHUNK_SHIFT;
    const gcx = gx >> CHUNK_SHIFT;
    const gcy = gy >> CHUNK_SHIFT;
    const sChunk = scy * cw + scx;
    const gChunk = gcy * cw + gcx;
    tiles.useLight(false);
    this.assemble(grid, profile, tiles, sChunk);
    this.assemble(grid, profile, tiles, gChunk);
    const sArea = this.areasAt[sChunk] ?? null;
    const gArea = this.areasAt[gChunk] ?? null;
    const sAreas = sArea === null ? 0 : this.touchedAreas(tiles, sArea, scx, scy, sx, sy, this.startAreas);
    const gAreas = gArea === null ? 0 : this.touchedAreas(tiles, gArea, gcx, gcy, gx, gy, this.goalAreas);
    tiles.unlimit();
    if (sArea === null || sAreas === 0 || this.count[sChunk] === 0) {
      tiles.useLight(true);
      return ROUTE_NONE;
    }
    if (exactStart) this.expanded += this.dijkstra.run(grid, sArea, scx, scy, ((sy & LAST) << CHUNK_SHIFT) | (sx & LAST), false, lit, profile.opensDoors, this.startDist, maxNodes);
    if (exactGoal && gArea !== null) this.expanded += this.dijkstra.run(grid, gArea, gcx, gcy, ((gy & LAST) << CHUNK_SHIFT) | (gx & LAST), true, lit, profile.opensDoors, this.goalDist, maxNodes - this.expanded);
    const budget = maxNodes - this.expanded;
    const S = chunks * MAX_PORTALS;
    const G = S + 1;
    this.heap.reset(nodes, this.f, this.g);
    this.open(S, 0, octile(gx - sx, gy - sy), -1);
    let found = false;
    let pops = 0;
    let best = -1;
    let bestH = 0;
    for (;;) {
      const n = this.heap.pop();
      if (n < 0) break;
      if (n === G) {
        found = true;
        break;
      }
      if (pops >= budget) break;
      pops++;
      this.closed[n] = 1;
      const gn = this.g[n] as number;
      if (n !== S) {
        const h = (this.f[n] as number) - gn;
        if (best < 0 || h < bestH || (h === bestH && gn < (this.g[best] as number))) {
          best = n;
          bestH = h;
        }
      }
      if (n === S) {
        const base = sChunk * MAX_PORTALS;
        for (let p = 0; p < (this.count[sChunk] as number); p++) {
          const t = this.ptile[base + p] as number;
          if (exactStart) {
            const d = this.startDist[t] as number;
            if (d < PATH_INFINITY) this.relaxPortal(grid, sChunk, p, gn + d, n, gx, gy);
            continue;
          }
          if (!hasArea(this.startAreas, sAreas, sArea.comp[t] as number)) continue;
          this.relaxPortal(grid, sChunk, p, gn + octile((scx << CHUNK_SHIFT) + (t & LAST) - sx, (scy << CHUNK_SHIFT) + (t >> CHUNK_SHIFT) - sy), n, gx, gy);
        }
        continue;
      }
      const c = (n / MAX_PORTALS) | 0;
      const p = n - c * MAX_PORTALS;
      const base = c * MAX_PORTALS;
      const t = this.ptile[n] as number;
      const areas = this.areasAt[c] as ChunkAreas;
      const ccx = c % cw;
      const ccy = (c - ccx) / cw;
      if (c === gChunk && exactGoal && gArea !== null) {
        const dg = this.goalDist[t] as number;
        if (dg < PATH_INFINITY) this.relaxNode(G, gn + dg, 0, n);
      } else if (c === gChunk && gArea !== null && hasArea(this.goalAreas, gAreas, areas.comp[t] as number)) {
        this.relaxNode(G, gn + octile(gx - (ccx << CHUNK_SHIFT) - (t & LAST), gy - (ccy << CHUNK_SHIFT) - (t >> CHUNK_SHIFT)), 0, n);
      }
      // Inside the chunk: the portal tile's distance field.
      const field = this.fieldOf(grid, areas, t, profile, ccx, ccy);
      for (let q = 0; q < (this.count[c] as number); q++) {
        if (q === p) continue;
        const d = field[BORDER_INDEX[this.ptile[base + q] as number] as number] as number;
        if (d < PATH_INFINITY) this.relaxPortal(grid, c, q, gn + d, n, gx, gy);
      }
      // Across the border: one straight step to the partner portal (the same position of the same border).
      const side = this.pside[n] as number;
      const d = c + (SIDE_DY[side] as number) * cw + (SIDE_DX[side] as number);
      this.assemble(grid, profile, tiles, d);
      const q = (this.sideStart[d * SIDES + (OPPOSITE[side] as number)] as number) + (this.pj[n] as number);
      const dcx = ccx + (SIDE_DX[side] as number);
      const dcy = ccy + (SIDE_DY[side] as number);
      const tq = this.ptile[d * MAX_PORTALS + q] as number;
      const qx = (dcx << CHUNK_SHIFT) | (tq & LAST);
      const qy = (dcy << CHUNK_SHIFT) | (tq >> CHUNK_SHIFT);
      this.relaxPortal(grid, d, q, gn + tiles.stepCost(qy * grid.width + qx, false), n, gx, gy);
    }
    this.expanded += pops;
    tiles.useLight(true);
    const last = found ? (this.parent[G] as number) : best;
    if (last < 0) return ROUTE_NONE;
    // The chain, back to front.
    let length = 0;
    for (let n = last; n >= 0 && n !== S; n = this.parent[n] as number) length++;
    let k = length;
    for (let n = last; n >= 0 && n !== S; n = this.parent[n] as number) {
      k--;
      const c = (n / MAX_PORTALS) | 0;
      const t = this.ptile[n] as number;
      this.chainX[k] = ((c % cw) << CHUNK_SHIFT) | (t & LAST);
      this.chainY[k] = (((c / cw) | 0) << CHUNK_SHIFT) | (t >> CHUNK_SHIFT);
    }
    this.chainLength = length;
    return found ? ROUTE_FOUND : ROUTE_NEAREST;
  }

  private relaxPortal(grid: PathGrid, c: number, p: number, cost: number, from: number, gx: number, gy: number): void {
    const n = c * MAX_PORTALS + p;
    const cx = c % grid.cw;
    const cy = (c - cx) / grid.cw;
    const t = this.ptile[n] as number;
    this.relaxNode(n, cost, octile(gx - ((cx << CHUNK_SHIFT) | (t & LAST)), gy - ((cy << CHUNK_SHIFT) | (t >> CHUNK_SHIFT))), from);
  }

  private relaxNode(n: number, cost: number, h: number, from: number): void {
    if (this.closed[n] === 1) return;
    if (this.seen[n] === 1 && cost >= (this.g[n] as number)) return;
    this.open(n, cost, h, from);
  }

  private open(n: number, cost: number, h: number, from: number): void {
    this.seen[n] = 1;
    this.g[n] = cost;
    this.f[n] = cost + h;
    this.parent[n] = from;
    this.heap.push(n);
  }

  /** Assembles the portals of window chunk `c` from its borders inside the window (once per request). */
  private assemble(grid: PathGrid, profile: PathProfile, tiles: GridSearch, c: number): void {
    if (this.ready[c] === 1) return;
    this.ready[c] = 1;
    const cw = grid.cw;
    const cx = c % cw;
    const cy = (c - cx) / cw;
    this.count[c] = 0;
    for (let s = 0; s < SIDES; s++) this.sideStart[c * SIDES + s] = 0;
    const areas = this.areasFor(grid, profile, tiles, c);
    if (areas === null) return;
    let count = 0;
    const base = c * MAX_PORTALS;
    for (let s = 0; s < SIDES; s++) {
      this.sideStart[c * SIDES + s] = count;
      const nx = cx + (SIDE_DX[s] as number);
      const ny = cy + (SIDE_DY[s] as number);
      if (nx < 0 || ny < 0 || nx >= cw || ny >= grid.ch) continue;
      const other = grid.versions[ny * cw + nx] as number;
      if (other === 0) continue;
      const otherAreas = this.areasFor(grid, profile, tiles, ny * cw + nx) as ChunkAreas;
      // The border belongs to its west or north chunk.
      const own = s === SIDE_E || s === SIDE_S;
      const dir = s === SIDE_E || s === SIDE_W ? BORDER_EAST : BORDER_SOUTH;
      const border = own ? this.borderOf(tiles, profile, cx, cy, areas, otherAreas, dir) : this.borderOf(tiles, profile, nx, ny, otherAreas, areas, dir);
      for (let j = 0; j < border.count; j++) {
        this.ptile[base + count] = borderTile(s, border.pos[j] as number);
        this.pside[base + count] = s;
        this.pj[base + count] = j;
        count++;
      }
    }
    this.count[c] = count;
  }

  /** The areas of window chunk `c` (cached by version; `null` for a void chunk), remembered for this request. */
  private areasFor(grid: PathGrid, profile: PathProfile, tiles: GridSearch, c: number): ChunkAreas | null {
    if (this.areasReady[c] === 1) return this.areasAt[c] ?? null;
    this.areasReady[c] = 1;
    const areas = this.lookupAreas(grid, profile, tiles, c);
    this.areasAt[c] = areas;
    return areas;
  }

  /** The areas of window chunk `c` from the cache, labelled on first use; `null` for a void chunk. */
  private lookupAreas(grid: PathGrid, profile: PathProfile, tiles: GridSearch, c: number): ChunkAreas | null {
    const version = grid.versions[c] as number;
    if (version === 0) return null;
    let areas = this.cache.areasOf(version, profile.index) ?? null;
    if (areas === null) {
      areas = this.cache.addAreas(version, profile.index);
      const cx = c % grid.cw;
      this.labelAreas(tiles, cx, (c - cx) / grid.cw, areas);
    }
    return areas;
  }

  /**
   * Whether window tiles (sx, sy) and (gx, gy) of one chunk share a connected area of it (then a way inside the chunk
   * joins them). The request's light is not part of the areas.
   */
  sameArea(grid: PathGrid, profile: PathProfile, tiles: GridSearch, sx: number, sy: number, gx: number, gy: number): boolean {
    const cx = sx >> CHUNK_SHIFT;
    const cy = sy >> CHUNK_SHIFT;
    tiles.useLight(false);
    const areas = this.lookupAreas(grid, profile, tiles, cy * grid.cw + cx);
    let shared = false;
    if (areas !== null) {
      const ns = this.touchedAreas(tiles, areas, cx, cy, sx, sy, this.startAreas);
      const ng = this.touchedAreas(tiles, areas, cx, cy, gx, gy, this.goalAreas);
      for (let i = 0; i < ng && !shared; i++) shared = hasArea(this.startAreas, ns, this.goalAreas[i] as number);
    }
    tiles.useLight(true);
    tiles.unlimit();
    return shared;
  }

  /**
   * The portals of the east or south border of window chunk (cx, cy) (cached by the two versions). A stretch of legal
   * crossings ends where the area changes on either side.
   */
  private borderOf(tiles: GridSearch, profile: PathProfile, cx: number, cy: number, first: ChunkAreas, second: ChunkAreas, dir: number): BorderPortals {
    const known = this.cache.borderOf(first.version, second.version, dir, profile.index);
    if (known !== undefined) return known;
    const e = this.cache.addBorder(first.version, second.version, dir, profile.index);
    tiles.unlimit();
    const side = dir === BORDER_EAST ? SIDE_E : SIDE_S;
    const dx = SIDE_DX[side] as number;
    const dy = SIDE_DY[side] as number;
    const spacing = BALANCE.ai.path.portalSpacingTiles;
    const x0 = cx << CHUNK_SHIFT;
    const y0 = cy << CHUNK_SHIFT;
    const opposite = OPPOSITE[side] as number;
    let runStart = -1;
    let runA = 0;
    let runB = 0;
    for (let pos = 0; pos <= CHUNK_SIZE; pos++) {
      let legal = false;
      let areaA = 0;
      let areaB = 0;
      if (pos < CHUNK_SIZE) {
        const t = borderTile(side, pos);
        const x = x0 + (t & LAST);
        const y = y0 + (t >> CHUNK_SHIFT);
        // An entrance needs the step both ways: the border tile itself must pass as well.
        legal = tiles.pass(x, y) && tiles.legalStep(x, y, dx, dy);
        areaA = first.comp[t] as number;
        areaB = second.comp[borderTile(opposite, pos)] as number;
      }
      if (legal && runStart >= 0 && areaA === runA && areaB === runB) continue;
      if (runStart >= 0) {
        const length = pos - runStart;
        const n = Math.ceil(length / spacing);
        for (let j = 0; j < n; j++) e.pos[e.count++] = runStart + Math.floor(((2 * j + 1) * length) / (2 * n));
      }
      runStart = legal ? pos : -1;
      runA = areaA;
      runB = areaB;
    }
    return e;
  }

  /** Distances from border tile `t` of window chunk (cx, cy) to its border tiles (computed once per chunk version). */
  private fieldOf(grid: PathGrid, areas: ChunkAreas, t: number, profile: PathProfile, cx: number, cy: number): Int32Array {
    const b = BORDER_INDEX[t] as number;
    const known = areas.fields[b];
    if (known !== null && known !== undefined) return known;
    this.dijkstra.run(grid, areas, cx, cy, t, false, false, profile.opensDoors, this.distScratch, PATH_INFINITY);
    const field = this.cache.field();
    for (let i = 0; i < CHUNK_TILES; i++) {
      const k = BORDER_INDEX[i] as number;
      if (k >= 0) field[k] = this.distScratch[i] as number;
    }
    areas.fields[b] = field;
    return field;
  }

  /** Records the legal steps and labels the connected areas of window chunk (cx, cy) (steps that stay inside it). */
  private labelAreas(tiles: GridSearch, cx: number, cy: number, e: ChunkAreas): void {
    tiles.limitToChunk(cx, cy);
    const x0 = cx << CHUNK_SHIFT;
    const y0 = cy << CHUNK_SHIFT;
    for (let i = 0; i < CHUNK_TILES; i++) {
      const x = x0 + (i & LAST);
      const y = y0 + (i >> CHUNK_SHIFT);
      let bits = 0;
      for (let d = 0; d < DIR_X.length; d++) if (tiles.legalStep(x, y, DIR_X[d] as number, DIR_Y[d] as number)) bits |= 1 << d;
      e.steps[i] = bits;
    }
    const stack = this.stack;
    let label = 0;
    for (let i = 0; i < CHUNK_TILES; i++) {
      if (e.comp[i] !== 0 || !tiles.pass(x0 + (i & LAST), y0 + (i >> CHUNK_SHIFT))) continue;
      label++;
      e.comp[i] = label;
      let top = 0;
      stack[top++] = i;
      while (top > 0) {
        const n = stack[--top] as number;
        const legal = e.steps[n] as number;
        for (let d = 0; d < DIR_X.length; d++) {
          if ((legal & (1 << d)) === 0) continue;
          const dx = DIR_X[d] as number;
          const dy = DIR_Y[d] as number;
          const m = n + dy * CHUNK_SIZE + dx;
          if (e.comp[m] !== 0) continue;
          e.comp[m] = label;
          stack[top++] = m;
        }
      }
    }
  }

  /**
   * The connected areas of its chunk a tile belongs to or steps into (a start may stand where it cannot pass: in light
   * or on a broken door). Returns their number (written to `out`).
   */
  private touchedAreas(tiles: GridSearch, e: ChunkAreas, cx: number, cy: number, x: number, y: number, out: Int32Array): number {
    tiles.limitToChunk(cx, cy);
    const local = ((y - (cy << CHUNK_SHIFT)) << CHUNK_SHIFT) | (x - (cx << CHUNK_SHIFT));
    let count = 0;
    const own = e.comp[local] as number;
    if (own !== 0) out[count++] = own;
    for (let d = 0; d < DIR_X.length; d++) {
      const dx = DIR_X[d] as number;
      const dy = DIR_Y[d] as number;
      if (!tiles.legalStep(x, y, dx, dy)) continue;
      const a = e.comp[local + dy * CHUNK_SIZE + dx] as number;
      if (a !== 0 && !hasArea(out, count, a)) out[count++] = a;
    }
    return count;
  }

  private ensure(chunks: number, nodes: number): void {
    if (this.g.length < nodes) {
      const n = grow(this.g.length, nodes);
      this.g = new Int32Array(n);
      this.f = new Int32Array(n);
      this.parent = new Int32Array(n);
      this.seen = new Uint8Array(n);
      this.closed = new Uint8Array(n);
      this.ptile = new Int32Array(n);
      this.pside = new Uint8Array(n);
      this.pj = new Uint8Array(n);
      this.chainX = new Int32Array(n);
      this.chainY = new Int32Array(n);
    }
    if (this.ready.length < chunks) {
      const n = grow(this.ready.length, chunks);
      this.ready = new Uint8Array(n);
      this.areasReady = new Uint8Array(n);
      this.count = new Int32Array(n);
      this.sideStart = new Int32Array(n * SIDES);
    }
    while (this.areasAt.length < chunks) this.areasAt.push(null);
  }
}
