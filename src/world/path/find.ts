/**
 * The pure path function (M6-16, docs/SPIEL.md §12): `findPath(snapshot, context, out)` – the same code runs in the
 * path worker and, when the worker has not answered by the ready tick, in the simulation; both see the same snapshot
 * and give the same result. The `PathContext` holds the per-thread scratch memory and the portal cache, which only
 * saves time.
 *
 * - Start and goal in the same chunk, or nearer than `hierarchyMinTiles`: A* with jump points in the box around start
 *   and goal plus `directMarginTiles`. When the box holds no way: inside one connected area of one chunk the search in
 *   that chunk, else the hierarchy below – it knows without searching the window whether there is a way at all.
 * - Otherwise HPA*: a chain of portals through the portal graph, each leg refined by a jump point search that never
 *   leaves its chunk. When the goal cannot be reached, the chain ends at the portal nearest to it (`partial`); when
 *   the start reaches no portal or light closes a leg, the direct search over the window decides.
 * - The goal may be unreachable or outside the window: the search then returns the path to the reached tile nearest
 *   to it (`partial`); `none` when the start lies in a void chunk or nothing nearer than the start was reached.
 * - The node limit (`maxNodes`) counts every node of every phase: portals and tiles.
 * - A request that avoids light and starts in light may cross the lit area it stands in (`escapeLight`).
 * - Legs between two portals come from a cache per chunk version (`LegCache`) that replays the search's node count
 *   under the request's limit, so a result never depends on what the thread computed before.
 *
 * Job messages (`PathJob`) carry a snapshot to the worker and its answer back in the same typed arrays, moved both ways,
 * never copied by the message; the path service reuses them (`PathJobBuffers`).
 */
import { BALANCE } from '../../content/balance';
import { CHUNK_SHIFT, CHUNK_SIZE, type Layer } from '../model/coords';
import { PATH_INFINITY, PATH_LIGHT, PATH_STATUS_CODES, PATH_VOID_WORD, PathGrid, STEP_STRAIGHT, createPathResult, grow, octile, profileAt, reservePathTiles, reservePathTilesKeep, type PathProfile } from './grid';
import { HierarchicalSearch, PortalCache, ROUTE_FOUND, ROUTE_NONE } from './hierarchy';
import { GridSearch, type SearchEnd } from './search';
import type { PathResult, PathStatus } from './types';

/** Straight-line distance from which the hierarchy is used [fixed point]. */
const HIERARCHY_MIN = BALANCE.ai.path.hierarchyMinTiles * STEP_STRAIGHT;
/** Margin of the direct search's first area around start and goal [tiles]. */
const DIRECT_MARGIN = BALANCE.ai.path.directMarginTiles;
/** How much longer than its straight-line estimate a first or last leg may be before the route is redone exactly [fixed point]. */
const INSERTION_SLACK = BALANCE.ai.path.insertionSlackTiles * STEP_STRAIGHT;

/** A request's snapshot: the window of tiles plus what to search in it. */
export class PathSnapshot {
  readonly grid = new PathGrid();
  fromTx = 0;
  fromTy = 0;
  toTx = 0;
  toTy = 0;
  profile: PathProfile = profileAt(0);
  /** The request avoids light (`PATH_LIGHT` tiles are blocked). */
  light = false;
  /** Node limit of the whole search, all phases together [nodes]. */
  maxNodes = 0;
}

/** Scratch memory and caches of one thread's searches. */
export class PathContext {
  readonly tiles = new GridSearch();
  readonly portals: PortalCache;
  readonly hierarchy: HierarchicalSearch;
  /** Searches that used the hierarchy, and those among them routed a second time with exact start or goal (statistics). */
  hierarchical = 0;
  reroutes = 0;
  /** Nodes the legs of the last portal chain expanded, and whether they reached the goal. */
  legNodes = 0;
  reached = false;
  /** Nodes of the last boxed search (box, then the whole area), and of its two parts. */
  boxNodes = 0;
  boxFirstNodes = 0;
  boxFirstEnd: SearchEnd = 'exhausted';
  boxSecondNodes = -1;
  boxWhole = false;
  /** Nodes a hierarchical search spent before it left the decision to the direct search. */
  routeNodes = 0;
  /** Legs between portals, reused across requests. */
  readonly legs = new LegCache();
  readonly legScratch = createPathResult();
  /** Costs of the first leg (start → first portal) and of the leg into the goal [fixed point]. */
  firstLegCost = 0;
  lastLegCost = 0;
  private stack = new Int32Array(0);

  constructor(portalCapacity: number = BALANCE.ai.path.abstractCacheEntries) {
    this.portals = new PortalCache(portalCapacity);
    this.hierarchy = new HierarchicalSearch(this.portals);
  }

  /**
   * A shadow brood that stands in light may cross the light it stands in (§12.4: it flees the light, it does not freeze
   * in it): clears `PATH_LIGHT` on the lit tiles joined to window tile (sx, sy), eight-connected. Other lit areas stay
   * blocked.
   */
  escapeLight(grid: PathGrid, sx: number, sy: number): void {
    const { width, height, words } = grid;
    if (this.stack.length < width * height) this.stack = new Int32Array(grow(this.stack.length, width * height));
    const stack = this.stack;
    let top = 0;
    const start = sy * width + sx;
    words[start] = (words[start] as number) & ~PATH_LIGHT;
    stack[top++] = start;
    while (top > 0) {
      const n = stack[--top] as number;
      const y = (n / width) | 0;
      const x = n - y * width;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const m = ny * width + nx;
          const w = words[m] as number;
          if ((w & PATH_LIGHT) === 0) continue;
          words[m] = w & ~PATH_LIGHT;
          stack[top++] = m;
        }
      }
    }
  }
}

/** Searches the path of a snapshot into `out` (see module comment). */
export function findPath(s: PathSnapshot, ctx: PathContext, out: PathResult): void {
  const grid = s.grid;
  const sx = s.fromTx - grid.tx0;
  const sy = s.fromTy - grid.ty0;
  const gx = s.toTx - grid.tx0;
  const gy = s.toTy - grid.ty0;
  out.steps = 0;
  out.expanded = 0;
  if (sx < 0 || sy < 0 || sx >= grid.width || sy >= grid.height || ((grid.words[sy * grid.width + sx] as number) & PATH_VOID_WORD) !== 0) {
    out.status = 'none';
    return;
  }
  if (sx === gx && sy === gy) {
    out.status = 'found';
    return;
  }
  if (s.light && ((grid.words[sy * grid.width + sx] as number) & PATH_LIGHT) !== 0) ctx.escapeLight(grid, sx, sy);
  const tiles = ctx.tiles;
  tiles.bind(grid, s.profile, s.light);
  const goalInside = gx >= 0 && gy >= 0 && gx < grid.width && gy < grid.height;
  const sameChunk = sx >> CHUNK_SHIFT === gx >> CHUNK_SHIFT && sy >> CHUNK_SHIFT === gy >> CHUNK_SHIFT;
  // Every node of every phase counts against the request's limit.
  let expanded = 0;
  if (!goalInside || sameChunk || octile(gx - sx, gy - sy) < HIERARCHY_MIN) {
    // Near: a direct search in the box around start and goal.
    let end = boxedSearch(ctx, sx, sy, gx, gy, 0, 0, grid.width, grid.height, s.maxNodes, false);
    expanded += ctx.boxNodes;
    if (end !== 'exhausted' || ctx.boxWhole || !goalInside) {
      finish(grid, tiles, end, sx, sy, expanded, out);
      return;
    }
    // The box holds no way. Inside one area of one chunk there is one in that chunk; otherwise the portal graph tells
    // whether there is one at all – without searching the whole window when there is none.
    if (sameChunk && ctx.hierarchy.sameArea(grid, s.profile, tiles, sx, sy, gx, gy)) {
      tiles.limitToChunk(sx >> CHUNK_SHIFT, sy >> CHUNK_SHIFT);
      end = tiles.search(sx, sy, gx, gy, s.maxNodes - expanded);
      expanded += tiles.expanded;
      if (end !== 'exhausted') {
        finish(grid, tiles, end, sx, sy, expanded, out);
        return;
      }
    } else {
      const used = routeAndRefine(grid, s, ctx, sx, sy, gx, gy, s.maxNodes - expanded, out);
      if (used >= 0) {
        out.expanded = expanded + used;
        return;
      }
      expanded += ctx.routeNodes;
    }
  } else {
    const used = routeAndRefine(grid, s, ctx, sx, sy, gx, gy, s.maxNodes, out);
    if (used >= 0) {
      out.expanded = used;
      return;
    }
    expanded += ctx.routeNodes;
  }
  // The whole window.
  tiles.unlimit();
  const end = tiles.search(sx, sy, gx, gy, s.maxNodes - expanded);
  finish(grid, tiles, end, sx, sy, expanded + tiles.expanded, out);
}

/**
 * The hierarchical search: a route through the portal graph, refined leg by leg – at most twice: with the
 * straight-line estimates of start and goal, then, if the first or last leg winds far more than estimated, with the
 * exact distances of that end. Returns the nodes used when it produced the result (`out.status` and `out.steps`
 * set), or −1 when the direct search has to decide (`ctx.routeNodes`: the nodes spent so far).
 */
function routeAndRefine(grid: PathGrid, s: PathSnapshot, ctx: PathContext, sx: number, sy: number, gx: number, gy: number, budget: number, out: PathResult): number {
  const tiles = ctx.tiles;
  ctx.hierarchical++;
  let exactStart = false;
  let exactGoal = false;
  let used = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const route = ctx.hierarchy.route(grid, s.profile, tiles, s.light, sx, sy, gx, gy, budget - used, exactStart, exactGoal);
    used += ctx.hierarchy.expanded;
    tiles.useLight(true);
    if (route === ROUTE_NONE) break;
    const refined = refineChain(grid, ctx, s.profile.index, s.light, sx, sy, gx, gy, route === ROUTE_FOUND, budget - used, out);
    used += ctx.legNodes;
    if (!refined) break;
    const chain = ctx.hierarchy;
    const last = chain.chainLength - 1;
    const redoStart: boolean = !exactStart && ctx.firstLegCost > octile((chain.chainX[0] as number) - sx, (chain.chainY[0] as number) - sy) + INSERTION_SLACK;
    const redoGoal: boolean = !exactGoal && route === ROUTE_FOUND && last >= 0 && ctx.lastLegCost > octile(gx - (chain.chainX[last] as number), gy - (chain.chainY[last] as number)) + INSERTION_SLACK;
    // Only with room for the exact searches (a chunk each): a cut-off search would lose the portals instead.
    const room = budget - used >= CHUNK_SIZE * CHUNK_SIZE * ((redoStart ? 1 : 0) + (redoGoal ? 1 : 0));
    if (attempt === 0 && (redoStart || redoGoal) && room) {
      ctx.reroutes++;
      exactStart = redoStart;
      exactGoal = redoGoal;
      continue;
    }
    out.status = ctx.reached ? 'found' : out.steps > 0 ? 'partial' : 'none';
    return used;
  }
  ctx.routeNodes = used;
  return -1;
}

/**
 * A search that first keeps to the box around start and goal plus `directMarginTiles` inside the area (x0, y0)–(x1,
 * y1) – a jump runs to the edge of its area, so a small area keeps the scans short – and only when that box holds no
 * way takes the whole area (unless `retry` is off). `ctx.boxNodes` counts the nodes of both, `ctx.boxWhole` tells
 * whether the box was the whole area.
 */
function boxedSearch(ctx: PathContext, sx: number, sy: number, gx: number, gy: number, x0: number, y0: number, x1: number, y1: number, maxNodes: number, retry = true): SearchEnd {
  const tiles = ctx.tiles;
  const bx0 = Math.max(x0, Math.min(sx, gx) - DIRECT_MARGIN);
  const by0 = Math.max(y0, Math.min(sy, gy) - DIRECT_MARGIN);
  const bx1 = Math.min(x1, Math.max(sx, gx) + DIRECT_MARGIN + 1);
  const by1 = Math.min(y1, Math.max(sy, gy) + DIRECT_MARGIN + 1);
  tiles.limit(bx0, by0, bx1, by1);
  let end = tiles.search(sx, sy, gx, gy, maxNodes);
  let nodes = tiles.expanded;
  ctx.boxFirstNodes = nodes;
  ctx.boxFirstEnd = end;
  ctx.boxSecondNodes = -1;
  ctx.boxWhole = bx0 === x0 && by0 === y0 && bx1 === x1 && by1 === y1;
  if (retry && end === 'exhausted' && !ctx.boxWhole) {
    tiles.limit(x0, y0, x1, y1);
    end = tiles.search(sx, sy, gx, gy, maxNodes - nodes);
    ctx.boxSecondNodes = tiles.expanded;
    nodes += tiles.expanded;
  }
  ctx.boxNodes = nodes;
  return end;
}

/** A leg between two portals of one chunk version, as an unlimited boxed search found it (`LegCache`). */
class CachedLeg {
  /** Nodes of the box search and whether it found the portal. */
  firstNodes = 0;
  firstFound = false;
  /** Nodes of the search in the whole chunk after an empty box (−1: none), and whether it found the portal. */
  secondNodes = -1;
  secondFound = false;
  steps = 0;
  /** Chunk-local tiles of the leg (start excluded). */
  tiles = new Uint16Array(0);
}

/**
 * Legs between portals per chunk version and profile – the same pairs of portals are walked by every long path
 * through a chunk. A cached leg replays exactly what the search would do under the request's node limit (the
 * search's outcome only depends on the limit through where it stops), so results and node counts never depend on
 * the cache. Bounded: when full, the oldest chunk versions are dropped.
 */
export class LegCache {
  private readonly byVersion = new Map<number, Map<number, CachedLeg>>();
  private count = 0;
  /** Legs computed and legs replayed (statistics). */
  built = 0;
  hits = 0;

  constructor(readonly capacity: number = BALANCE.ai.path.legCacheEntries) {}

  get(version: number, key: number): CachedLeg | undefined {
    return this.byVersion.get(version)?.get(key);
  }

  add(version: number, key: number): CachedLeg {
    let legs = this.byVersion.get(version);
    if (legs === undefined) {
      while (this.count >= this.capacity && this.byVersion.size > 0) this.evictOldest();
      legs = new Map<number, CachedLeg>();
      this.byVersion.set(version, legs);
    }
    const leg = new CachedLeg();
    legs.set(key, leg);
    this.count++;
    this.built++;
    return leg;
  }

  /** Number of cached legs. */
  get size(): number {
    return this.count;
  }

  private evictOldest(): void {
    for (const [version, legs] of this.byVersion) {
      this.byVersion.delete(version);
      this.count -= legs.size;
      return;
    }
  }
}

/** Bits of a chunk-local tile index in a leg key. */
const LOCAL_BITS = 2 * CHUNK_SHIFT;

/**
 * A leg from portal (x, y) to portal (tx, ty) inside window chunk (cx, cy), appended to `out` after `steps` steps:
 * from the leg cache, or searched without limit and cached. Applies the node limit `budget` exactly as a limited search
 * would (see `LegCache`). Returns the new step count, or −1 when the leg fails; `ctx.boxNodes` holds its nodes.
 */
function cachedLeg(grid: PathGrid, ctx: PathContext, profile: number, x: number, y: number, tx: number, ty: number, cx: number, cy: number, budget: number, out: PathResult, steps: number): number {
  const version = grid.versions[cy * grid.cw + cx] as number;
  const ox = cx << CHUNK_SHIFT;
  const oy = cy << CHUNK_SHIFT;
  const from = ((y - oy) << CHUNK_SHIFT) | (x - ox);
  const to = ((ty - oy) << CHUNK_SHIFT) | (tx - ox);
  const key = (profile << (2 * LOCAL_BITS)) | (from << LOCAL_BITS) | to;
  let leg = ctx.legs.get(version, key);
  if (leg === undefined) {
    const end = boxedSearch(ctx, x, y, tx, ty, ox, oy, ox + CHUNK_SIZE, oy + CHUNK_SIZE, PATH_INFINITY);
    leg = ctx.legs.add(version, key);
    leg.firstNodes = ctx.boxFirstNodes;
    leg.firstFound = ctx.boxFirstEnd === 'found';
    leg.secondNodes = ctx.boxSecondNodes;
    leg.secondFound = ctx.boxSecondNodes >= 0 && end === 'found';
    if (end === 'found') {
      const scratch = ctx.legScratch;
      const n = ctx.tiles.tracePath(grid, ctx.tiles.end, scratch, 0);
      leg.steps = n;
      leg.tiles = new Uint16Array(n);
      for (let i = 0; i < n; i++) leg.tiles[i] = (((scratch.tiles[2 * i + 1] as number) - grid.ty0 - oy) << CHUNK_SHIFT) | ((scratch.tiles[2 * i] as number) - grid.tx0 - ox);
    }
  } else {
    ctx.legs.hits++;
  }
  // The node limit, as a limited box search (and the search of the whole chunk after it) would meet it.
  if (leg.firstNodes > budget) {
    ctx.boxNodes = budget;
    return -1;
  }
  let used = leg.firstNodes;
  let found = leg.firstFound;
  if (!found && leg.secondNodes >= 0) {
    if (leg.secondNodes > budget - used) {
      ctx.boxNodes = budget;
      return -1;
    }
    used += leg.secondNodes;
    found = leg.secondFound;
  }
  ctx.boxNodes = used;
  if (!found) return -1;
  reservePathTilesKeep(out, steps + leg.steps);
  const wx = grid.tx0 + ox;
  const wy = grid.ty0 + oy;
  for (let i = 0; i < leg.steps; i++) {
    const t = leg.tiles[i] as number;
    out.tiles[2 * (steps + i)] = wx + (t & (CHUNK_SIZE - 1));
    out.tiles[2 * (steps + i) + 1] = wy + (t >> CHUNK_SHIFT);
  }
  return steps + leg.steps;
}

/**
 * Walks the portal chain of the last `route`: from the start through every portal and on to the goal (`toGoal`) –
 * or, when the goal cannot be reached, from the last portal as near to the goal as its chunk allows – with a jump
 * point search inside the chunk for each leg and a single step for each border crossing. Returns false when a leg to a
 * portal finds no way (light, or the node limit) – the caller then searches directly. `ctx.legNodes` counts the nodes
 * used, `ctx.reached` tells whether the path ends at the goal.
 */
function refineChain(grid: PathGrid, ctx: PathContext, profile: number, light: boolean, sx: number, sy: number, gx: number, gy: number, toGoal: boolean, budget: number, out: PathResult): boolean {
  const tiles = ctx.tiles;
  const chain = ctx.hierarchy;
  const legs = chain.chainLength + (toGoal ? 1 : 0);
  let x = sx;
  let y = sy;
  let steps = 0;
  ctx.legNodes = 0;
  ctx.firstLegCost = 0;
  ctx.lastLegCost = 0;
  for (let k = 0; k < legs; k++) {
    const tx = k < chain.chainLength ? (chain.chainX[k] as number) : gx;
    const ty = k < chain.chainLength ? (chain.chainY[k] as number) : gy;
    if (tx === x && ty === y) continue;
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    if (tx >> CHUNK_SHIFT !== cx || ty >> CHUNK_SHIFT !== cy) {
      // A border crossing between partner portals: one straight step.
      reservePathTilesKeep(out, steps + 1);
      out.tiles[2 * steps] = grid.tx0 + tx;
      out.tiles[2 * steps + 1] = grid.ty0 + ty;
      steps++;
    } else if (k > 0 && k < chain.chainLength && !light) {
      // Between two portals: the same leg for every path through the chunk.
      steps = cachedLeg(grid, ctx, profile, x, y, tx, ty, cx, cy, budget - ctx.legNodes, out, steps);
      ctx.legNodes += ctx.boxNodes;
      if (steps < 0) return false;
    } else {
      const end = boxedSearch(ctx, x, y, tx, ty, cx << CHUNK_SHIFT, cy << CHUNK_SHIFT, (cx + 1) << CHUNK_SHIFT, (cy + 1) << CHUNK_SHIFT, budget - ctx.legNodes);
      ctx.legNodes += ctx.boxNodes;
      if (end !== 'found') return false;
      if (k === 0) ctx.firstLegCost = tiles.endCost;
      if (toGoal && k === legs - 1) ctx.lastLegCost = tiles.endCost;
      steps = tiles.tracePath(grid, tiles.end, out, steps);
    }
    x = tx;
    y = ty;
  }
  ctx.reached = toGoal;
  if (!toGoal) {
    // As near to the goal as the last portal's chunk allows (the goal itself when only the node limit stopped the route).
    tiles.limitToChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    const end = tiles.search(x, y, gx, gy, budget - ctx.legNodes);
    ctx.legNodes += tiles.expanded;
    ctx.reached = end === 'found';
    if (tiles.end !== y * grid.width + x) steps = tiles.tracePath(grid, tiles.end, out, steps);
  }
  out.steps = steps;
  return true;
}

/** Writes the outcome of the last tile search. */
function finish(grid: PathGrid, tiles: GridSearch, end: SearchEnd, sx: number, sy: number, expanded: number, out: PathResult): void {
  out.expanded = expanded;
  if (end === 'found') {
    out.status = 'found';
    out.steps = tiles.tracePath(grid, tiles.end, out);
  } else if (tiles.end === sy * grid.width + sx) {
    out.status = 'none';
    out.steps = 0;
  } else {
    out.status = 'partial';
    out.steps = tiles.tracePath(grid, tiles.end, out);
  }
}

// ---------------------------------------------------------------------------------------------
// Worker messages
// ---------------------------------------------------------------------------------------------

/** Header fields of a job: the window and the search … */
const HEAD_LAYER = 0;
const HEAD_CX0 = 1;
const HEAD_CY0 = 2;
const HEAD_CW = 3;
const HEAD_CH = 4;
const HEAD_FROM_X = 5;
const HEAD_FROM_Y = 6;
const HEAD_TO_X = 7;
const HEAD_TO_Y = 8;
const HEAD_PROFILE = 9;
const HEAD_LIGHT = 10;
const HEAD_MAX_NODES = 11;
/** … and the answer the worker writes back into the same header. */
const HEAD_STATUS = 12;
const HEAD_STEPS = 13;
const HEAD_EXPANDED = 14;
const HEAD_LENGTH = 15;
/** Places of a message's buffers in its transfer list. */
const TRANSFER_HEAD = 0;
const TRANSFER_VERSIONS = 1;
const TRANSFER_SPECIAL = 2;
const TRANSFER_WORDS = 3;
const TRANSFER_TILES = 4;

/**
 * A job message: the snapshot to the worker and, in the same arrays, its answer back (the header's answer fields and the
 * path in `tiles`). The arrays are moved both ways, never copied by the message: the path service keeps them in a pool
 * (`PathJobBuffers`), copies each snapshot into them and takes them back with the answer. Arrays may be longer than their
 * used part (the window in the header says how much is used).
 */
export interface PathJob {
  head: Int32Array<ArrayBuffer>;
  versions: Int32Array<ArrayBuffer>;
  special: Uint8Array<ArrayBuffer>;
  words: Uint16Array<ArrayBuffer>;
  /** The answer's path: `2 × steps` tile coordinates (the worker grows the array when a path does not fit). */
  tiles: Int32Array<ArrayBuffer>;
}

/**
 * The arrays of one job message, reused from request to request (M6 review perf:path-worker-message-alloc): a snapshot is
 * copied in whole (`set`, no sub-array views), the arrays move to the worker, and its answer brings them back
 * (`adopt`). In the steady state a request allocates no array and no backing store; only a bigger window or a longer path
 * grows them once.
 */
export class PathJobBuffers {
  job: PathJob = { head: new Int32Array(HEAD_LENGTH), versions: new Int32Array(0), special: new Uint8Array(0), words: new Uint16Array(0), tiles: new Int32Array(0) };
  /** The buffers of `job` to move, in step with it. */
  readonly transfer: ArrayBuffer[] = [];

  constructor() {
    this.listBuffers();
  }

  /** Writes snapshot `s` into the arrays (grown to the snapshot's when smaller) and returns the message. */
  encode(s: PathSnapshot): PathJob {
    const g = s.grid;
    const m = this.job;
    let grown = false;
    if (m.words.length < g.words.length) {
      m.words = new Uint16Array(g.words.length);
      grown = true;
    }
    if (m.versions.length < g.versions.length) {
      m.versions = new Int32Array(g.versions.length);
      grown = true;
    }
    if (m.special.length < g.special.length) {
      m.special = new Uint8Array(g.special.length);
      grown = true;
    }
    if (grown) this.listBuffers();
    // Whole arrays: a copy of the unused rest is cheaper than a sub-array view per request.
    m.words.set(g.words);
    m.versions.set(g.versions);
    m.special.set(g.special);
    const head = m.head;
    head[HEAD_LAYER] = g.layer;
    head[HEAD_CX0] = g.cx0;
    head[HEAD_CY0] = g.cy0;
    head[HEAD_CW] = g.cw;
    head[HEAD_CH] = g.ch;
    head[HEAD_FROM_X] = s.fromTx;
    head[HEAD_FROM_Y] = s.fromTy;
    head[HEAD_TO_X] = s.toTx;
    head[HEAD_TO_Y] = s.toTy;
    head[HEAD_PROFILE] = s.profile.index;
    head[HEAD_LIGHT] = s.light ? 1 : 0;
    head[HEAD_MAX_NODES] = s.maxNodes;
    head[HEAD_STATUS] = -1;
    head[HEAD_STEPS] = 0;
    head[HEAD_EXPANDED] = 0;
    return m;
  }

  /** Takes the arrays of an answer to this message (they came back moved) for the next request. */
  adopt(answer: PathJob): void {
    this.job = answer;
    this.listBuffers();
  }

  /** Lists the buffers of `job` in `transfer` (the same five places every time: no array store is made anew). */
  private listBuffers(): void {
    const m = this.job;
    const t = this.transfer;
    t[TRANSFER_HEAD] = m.head.buffer;
    t[TRANSFER_VERSIONS] = m.versions.buffer;
    t[TRANSFER_SPECIAL] = m.special.buffer;
    t[TRANSFER_WORDS] = m.words.buffer;
    t[TRANSFER_TILES] = m.tiles.buffer;
  }
}

/** Reads a job message into a snapshot (the worker side; the arrays are adopted, not copied). */
export function decodeJob(job: PathJob, into: PathSnapshot): PathSnapshot {
  const h = job.head;
  if (h.length < HEAD_LENGTH) throw new RangeError('Pfad: Auftrag ohne vollständigen Kopf');
  const g = into.grid;
  g.layer = h[HEAD_LAYER] as Layer;
  g.cx0 = h[HEAD_CX0] as number;
  g.cy0 = h[HEAD_CY0] as number;
  g.cw = h[HEAD_CW] as number;
  g.ch = h[HEAD_CH] as number;
  g.width = g.cw << CHUNK_SHIFT;
  g.height = g.ch << CHUNK_SHIFT;
  if (job.words.length < g.width * g.height || job.versions.length < g.cw * g.ch || job.special.length < g.cw * g.ch) throw new RangeError('Pfad: Auftrag passt nicht zu seinem Fenster');
  g.words = job.words;
  g.versions = job.versions;
  g.special = job.special;
  into.fromTx = h[HEAD_FROM_X] as number;
  into.fromTy = h[HEAD_FROM_Y] as number;
  into.toTx = h[HEAD_TO_X] as number;
  into.toTy = h[HEAD_TO_Y] as number;
  into.profile = profileAt(h[HEAD_PROFILE] as number);
  into.light = h[HEAD_LIGHT] === 1;
  into.maxNodes = h[HEAD_MAX_NODES] as number;
  return into;
}

/** Copies the answer in a job message into a result. */
export function decodeAnswer(m: PathJob, out: PathResult): void {
  const h = m.head;
  const status: PathStatus | undefined = PATH_STATUS_CODES[h[HEAD_STATUS] as number];
  const steps = h[HEAD_STEPS] as number;
  if (status === undefined || !(steps >= 0) || m.tiles.length < steps * 2) throw new RangeError('Pfad: ungültige Antwort des Workers');
  reservePathTiles(out, steps);
  out.status = status;
  out.steps = steps;
  out.expanded = h[HEAD_EXPANDED] as number;
  const tiles = m.tiles;
  const into = out.tiles;
  for (let i = 0; i < steps * 2; i++) into[i] = tiles[i] as number;
}

/**
 * The worker's handler state: one snapshot and result reused for every job. It searches on the message's arrays and
 * writes the answer into them – the path into `tiles` (grown here when too short) – and returns the message with its
 * buffers to move back.
 */
export class PathJobRunner {
  private readonly snapshot = new PathSnapshot();
  private readonly result = createPathResult();
  constructor(readonly context: PathContext = new PathContext()) {}

  /** The job's answer, written into its own arrays: the message itself. */
  answer(job: PathJob): PathJob {
    const r = this.result;
    r.tiles = job.tiles;
    findPath(decodeJob(job, this.snapshot), this.context, r);
    job.tiles = r.tiles as Int32Array<ArrayBuffer>;
    const h = job.head;
    h[HEAD_STATUS] = PATH_STATUS_CODES.indexOf(r.status);
    h[HEAD_STEPS] = r.steps;
    h[HEAD_EXPANDED] = r.expanded;
    return job;
  }

  /** `answer` with the buffers to move back (a list of its own per answer: replies of the RPC server wait a microtask). */
  run(job: PathJob): { result: PathJob; transfer: ArrayBuffer[] } {
    const m = this.answer(job);
    return { result: m, transfer: [m.head.buffer, m.versions.buffer, m.special.buffer, m.words.buffer, m.tiles.buffer] };
  }
}
