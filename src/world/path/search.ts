/**
 * The tile search on the words of a `PathGrid` (M6-16, docs/SPIEL.md §12): A* with Jump Point Search inside a
 * rectangle of the window (the whole window, a box around start and goal, one chunk), and the path trace.
 *
 * **JPS on a grid with levels and doors.** Jump Point Search needs uniform steps between neighbouring open tiles.
 * Three things break that here: level changes (a walker changes level only between two connectors one level apart),
 * the extra cost of a closed door, and the corner rule of diagonal steps. The search therefore splits the tiles:
 * - **plain** tiles – passable, not special: a jump on level L only runs over plain tiles of level L; every other
 *   tile counts as blocked for its pruning rules (the variant without corner cutting: a straight jump stops where a
 *   tile beside it is open while the one behind that is not, a diagonal jump stops where a straight jump from it
 *   finds something);
 * - **special** tiles – level links (`PATH_LINK`, walkers) and closed doors (`PATH_DOOR`, door openers): a jump never
 *   enters them. A jump stops on every tile next to one (`specialNear`), and such a tile, a special tile and the
 *   start are expanded in all eight directions with the exact step rules (`legalStep`) and costs – that is plain A*
 *   where the grid is not uniform, JPS everywhere else.
 * Stopping more often and expanding more directions only adds edges of exact cost, so the search stays optimal; the
 * tests compare it with Dijkstra on random grids with levels, ramps and doors.
 *
 * All state lives in reused typed arrays (node stamps instead of clearing): no allocation per search once the
 * arrays have grown to the window size.
 */
import { CHUNK_SHIFT as CHUNK_SHIFT_IMPORT } from '../model/coords';
import {
  DOOR_COST as DOOR_COST_IMPORT,
  PATH_DOOR as PATH_DOOR_IMPORT,
  PATH_INFINITY as PATH_INFINITY_IMPORT,
  PATH_LEVEL_BITS as PATH_LEVEL_BITS_IMPORT,
  PATH_LIGHT as PATH_LIGHT_IMPORT,
  STEP_DIAGONAL as STEP_DIAGONAL_IMPORT,
  STEP_STRAIGHT as STEP_STRAIGHT_IMPORT,
  grow,
  levelsJoin as levelsJoinImport,
  reservePathTilesKeep,
  type PathGrid,
  type PathProfile,
} from './grid';
import { NodeHeap } from './heap';
import type { PathResult } from './types';

// Module-local copies of imported constants and functions: the hot loops read them per tile, and module wrappers of
// tsx and vite-node turn every access to an imported binding into a getter call (like src/world/collision/tiles.ts).
const CHUNK_SHIFT = CHUNK_SHIFT_IMPORT;
const DOOR_COST = DOOR_COST_IMPORT;
const PATH_DOOR = PATH_DOOR_IMPORT;
const PATH_INFINITY = PATH_INFINITY_IMPORT;
const PATH_LEVEL_BITS = PATH_LEVEL_BITS_IMPORT;
const PATH_LIGHT = PATH_LIGHT_IMPORT;
const STEP_DIAGONAL = STEP_DIAGONAL_IMPORT;
const STEP_STRAIGHT = STEP_STRAIGHT_IMPORT;
const levelsJoin = levelsJoinImport;
/** Octile distance [fixed point] (as `octile` in grid.ts, local for the hot loops). */
const DIAGONAL_EXTRA = STEP_DIAGONAL - STEP_STRAIGHT;
function octile(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return ax > ay ? STEP_STRAIGHT * ax + DIAGONAL_EXTRA * ay : STEP_STRAIGHT * ay + DIAGONAL_EXTRA * ax;
}

/** Neighbour offsets (x, y) in a fixed order: the four straight directions, then the diagonals. */
const DIR_X = [1, 0, -1, 0, 1, -1, -1, 1] as const;
const DIR_Y = [0, 1, 0, -1, 1, 1, -1, -1] as const;
/** Number of neighbours of a tile. */
const NEIGHBOURS = 8;
/** Largest node stamp before the stamp arrays are cleared (fits a Uint32Array). */
const MAX_STAMP = 0xffff_fff0;

/** How a tile search ended. */
export type SearchEnd = 'found' | 'limit' | 'exhausted';

/** A* with jump points over one `PathGrid` (see module comment). */
export class GridSearch {
  // Bound grid and rules.
  private words: Uint16Array = new Uint16Array(0);
  private width = 0;
  private height = 0;
  private cw = 0;
  private chunkSpecial: Uint8Array = new Uint8Array(0);
  private baseMask = 0;
  private lightWanted = false;
  private passMask = 0;
  private passValue = 0;
  private specialBits = 0;
  private walk = true;
  private opensDoors = false;
  // Tiles a search may use: a rectangle (window-local, x1/y1 exclusive).
  private rx0 = 0;
  private ry0 = 0;
  private rx1 = 0;
  private ry1 = 0;
  // The jump of the moment: open = plain tile on its level.
  private openMask = 0;
  private openValue = 0;
  // Goal (window-local; `goal` −1 when it lies outside the window).
  private goal = -1;
  private goalX = 0;
  private goalY = 0;
  // Node state.
  private g = new Int32Array(0);
  private f = new Int32Array(0);
  private parent = new Int32Array(0);
  private seen = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private stamp = 0;
  private readonly heap = new NodeHeap();
  private trace = new Int32Array(0);
  /**
   * Jump over plain tiles (default). Off, every node is expanded in all eight directions by single steps – plain A*
   * with the same rules and costs (tests compare both; it is also what the search does around special tiles).
   */
  jumps = true;
  /** Nodes expanded by the last search. */
  expanded = 0;
  /** Tiles the jumps of the searches scanned (statistics: the work of a search beside its nodes). */
  scannedTiles = 0;
  /** Node where the last tile search ended: the goal, or the reached tile nearest to it. */
  end = -1;
  // The scanned tile nearest to the goal (jumps pass tiles that never become nodes): the node whose jump passed it and
  // the diagonal tile the straight part of that jump started from (−1 for a straight or diagonal line from the node).
  private scanFrom = -1;
  private scanCorner = -1;
  private scanBestH = 0;
  private scanBestCell = -1;
  private scanBestNode = -1;
  private scanBestCorner = -1;

  /**
   * Binds a grid and a mover profile; `light` blocks the `PATH_LIGHT` tiles. The search may use the whole window
   * until `limit`/`limitToChunk` narrows it.
   */
  bind(grid: PathGrid, profile: PathProfile, light: boolean): void {
    this.words = grid.words;
    this.width = grid.width;
    this.height = grid.height;
    this.cw = grid.cw;
    this.chunkSpecial = grid.special;
    this.baseMask = profile.blocked | profile.required;
    this.lightWanted = light;
    this.passMask = this.baseMask | (light ? PATH_LIGHT : 0);
    this.passValue = profile.required;
    this.specialBits = profile.special;
    this.walk = profile.walk;
    this.opensDoors = profile.opensDoors;
    this.limit(0, 0, grid.width, grid.height);
    const nodes = grid.width * grid.height;
    if (this.g.length < nodes) {
      const n = grow(this.g.length, nodes);
      this.g = new Int32Array(n);
      this.f = new Int32Array(n);
      this.parent = new Int32Array(n);
      this.seen = new Uint32Array(n);
      this.closed = new Uint32Array(n);
      this.stamp = 0;
    }
  }

  /**
   * Switches the request's light rule off (`false`) or back on: the cached portal graph is built without light (it
   * changes every tick), the searches of the request itself see it.
   */
  useLight(on: boolean): void {
    this.passMask = this.baseMask | (on && this.lightWanted ? PATH_LIGHT : 0);
  }

  /** Restricts the search to a rectangle of the window (x1, y1 exclusive). */
  limit(x0: number, y0: number, x1: number, y1: number): void {
    this.rx0 = x0;
    this.ry0 = y0;
    this.rx1 = x1;
    this.ry1 = y1;
  }

  /** Restricts the search to one window chunk. */
  limitToChunk(cx: number, cy: number): void {
    this.limit(cx << CHUNK_SHIFT, cy << CHUNK_SHIFT, (cx + 1) << CHUNK_SHIFT, (cy + 1) << CHUNK_SHIFT);
  }

  /** Lets the search use the whole window again. */
  unlimit(): void {
    this.limit(0, 0, this.width, this.height);
  }

  /** Whether window tile (x, y) lies in the search area and passes the profile. */
  pass(x: number, y: number): boolean {
    if (x < this.rx0 || y < this.ry0 || x >= this.rx1 || y >= this.ry1) return false;
    return ((this.words[y * this.width + x] as number) & this.passMask) === this.passValue;
  }

  /**
   * Whether a mover on window tile (x, y) may step by (dx, dy): the target passes, walkers join its level, and a
   * diagonal step needs both tiles beside it passable, no closed door, and (walkers) on levels joined with both ends.
   * The tile the mover stands on need not pass (it may start in light or on a door it broke).
   */
  legalStep(x: number, y: number, dx: number, dy: number): boolean {
    const bx = x + dx;
    const by = y + dy;
    if (!this.pass(bx, by)) return false;
    const words = this.words;
    const w = this.width;
    const a = words[y * w + x] as number;
    const b = words[by * w + bx] as number;
    if (this.walk && !levelsJoin(a, b)) return false;
    if (dx === 0 || dy === 0) return true;
    if (!this.pass(bx, y) || !this.pass(x, by)) return false;
    const o1 = words[y * w + bx] as number;
    const o2 = words[by * w + x] as number;
    if (((o1 | o2) & PATH_DOOR) !== 0) return false;
    return !this.walk || (levelsJoin(a, o1) && levelsJoin(a, o2) && levelsJoin(b, o1) && levelsJoin(b, o2));
  }

  /** Cost of entering window tile `i` by a straight or diagonal step. */
  stepCost(i: number, diagonal: boolean): number {
    const door = this.opensDoors && ((this.words[i] as number) & PATH_DOOR) !== 0;
    return (diagonal ? STEP_DIAGONAL : STEP_STRAIGHT) + (door ? DOOR_COST : 0);
  }

  // ---------------------------------------------------------------------------------------------
  // A* with jump points
  // ---------------------------------------------------------------------------------------------

  /**
   * Searches from window tile (sx, sy) towards (gx, gy) (window-local; the goal may lie outside the window, then the
   * search only gets as near as it can). Expands at most `maxNodes` nodes. Returns how it ended; `end` is the goal or
   * the reached tile nearest to it – an expanded node (smallest heuristic, then smallest cost) or a tile a jump passed
   * that lies strictly nearer.
   */
  search(sx: number, sy: number, gx: number, gy: number, maxNodes: number): SearchEnd {
    this.newStamp();
    const w = this.width;
    this.goalX = gx;
    this.goalY = gy;
    this.goal = gx >= 0 && gy >= 0 && gx < w && gy < this.height ? gy * w + gx : -1;
    this.heap.reset(w * this.height, this.f, this.g);
    const start = sy * w + sx;
    this.seen[start] = this.stamp;
    this.g[start] = 0;
    this.f[start] = octile(gx - sx, gy - sy);
    this.parent[start] = -1;
    this.heap.push(start);
    this.expanded = 0;
    let best = start;
    let bestH = this.f[start] as number;
    this.scanBestH = bestH;
    this.scanBestCell = -1;
    for (;;) {
      const n = this.heap.pop();
      if (n < 0) {
        this.end = this.nearest(best, bestH);
        return 'exhausted';
      }
      if (n === this.goal) {
        this.end = n;
        return 'found';
      }
      if (this.expanded >= maxNodes) {
        this.end = this.nearest(best, bestH);
        return 'limit';
      }
      this.closed[n] = this.stamp;
      this.expanded++;
      const gn = this.g[n] as number;
      const hn = (this.f[n] as number) - gn;
      if (hn < bestH || (hn === bestH && gn < (this.g[best] as number))) {
        best = n;
        bestH = hn;
      }
      this.expand(n);
    }
  }

  /**
   * The end of a search that missed the goal: the best expanded node, or the scanned tile when it lies strictly
   * nearer – then linked to the node whose jump passed it (via the jump's diagonal tile) so that `tracePath` reaches it.
   */
  private nearest(best: number, bestH: number): number {
    const cell = this.scanBestCell;
    if (cell < 0 || this.scanBestH >= bestH) return best;
    if (this.seen[cell] === this.stamp) return cell;
    let from = this.scanBestNode;
    const corner = this.scanBestCorner;
    if (corner >= 0 && corner !== from) {
      if (this.seen[corner] !== this.stamp) {
        this.seen[corner] = this.stamp;
        this.parent[corner] = from;
      }
      from = corner;
    }
    this.seen[cell] = this.stamp;
    this.parent[cell] = from;
    return cell;
  }

  /** Remembers a scanned tile if it is the nearest to the goal so far. */
  private scanned(i: number, x: number, y: number): void {
    this.scannedTiles++;
    const h = octile(this.goalX - x, this.goalY - y);
    if (h >= this.scanBestH) return;
    this.scanBestH = h;
    this.scanBestCell = i;
    this.scanBestNode = this.scanFrom;
    this.scanBestCorner = this.scanCorner;
  }

  /** Cost of the node where the last search ended. */
  get endCost(): number {
    return this.g[this.end] as number;
  }

  private expand(n: number): void {
    const w = this.width;
    const y = (n / w) | 0;
    const x = n - y * w;
    const p = this.parent[n] as number;
    if (!this.jumps) {
      for (let d = 0; d < NEIGHBOURS; d++) this.step(n, x, y, DIR_X[d] as number, DIR_Y[d] as number);
      return;
    }
    if (p < 0 || ((this.words[n] as number) & this.specialBits) !== 0 || this.specialNear(x, y)) {
      for (let d = 0; d < NEIGHBOURS; d++) this.tryDir(n, x, y, DIR_X[d] as number, DIR_Y[d] as number);
      return;
    }
    const py = (p / w) | 0;
    const dx = Math.sign(x - (p - py * w));
    const dy = Math.sign(y - py);
    if (dx !== 0 && dy !== 0) {
      this.tryDir(n, x, y, dx, dy);
      this.tryDir(n, x, y, dx, 0);
      this.tryDir(n, x, y, 0, dy);
    } else if (dx !== 0) {
      this.tryDir(n, x, y, dx, 0);
      this.tryDir(n, x, y, 0, 1);
      this.tryDir(n, x, y, 0, -1);
      this.tryDir(n, x, y, dx, 1);
      this.tryDir(n, x, y, dx, -1);
    } else {
      this.tryDir(n, x, y, 0, dy);
      this.tryDir(n, x, y, 1, 0);
      this.tryDir(n, x, y, -1, 0);
      this.tryDir(n, x, y, 1, dy);
      this.tryDir(n, x, y, -1, dy);
    }
  }

  /** Plain A* successor: the neighbour in direction (dx, dy) by one step. */
  private step(n: number, x: number, y: number, dx: number, dy: number): void {
    if (!this.legalStep(x, y, dx, dy)) return;
    const m = (y + dy) * this.width + x + dx;
    this.relax(m, (this.g[n] as number) + this.stepCost(m, dx !== 0 && dy !== 0), n);
  }

  /** Successor of node n = (x, y) in direction (dx, dy): the neighbour itself if special, else where a jump ends. */
  private tryDir(n: number, x: number, y: number, dx: number, dy: number): void {
    if (!this.legalStep(x, y, dx, dy)) return;
    const w = this.width;
    const mx = x + dx;
    const my = y + dy;
    const m = my * w + mx;
    const wm = this.words[m] as number;
    const diagonal = dx !== 0 && dy !== 0;
    if ((wm & this.specialBits) !== 0) {
      this.relax(m, (this.g[n] as number) + this.stepCost(m, diagonal), n);
      return;
    }
    this.openMask = this.passMask | this.specialBits | (this.walk ? PATH_LEVEL_BITS : 0);
    this.openValue = this.passValue | (this.walk ? wm & PATH_LEVEL_BITS : 0);
    this.scanFrom = n;
    this.scanCorner = -1;
    const j = diagonal ? this.jumpDiagonal(mx, my, dx, dy) : this.jumpStraight(mx, my, dx, dy);
    if (j < 0) return;
    const jy = (j / w) | 0;
    const jx = j - jy * w;
    const steps = Math.max(Math.abs(jx - x), Math.abs(jy - y));
    this.relax(j, (this.g[n] as number) + steps * (diagonal ? STEP_DIAGONAL : STEP_STRAIGHT), n);
  }

  private relax(m: number, cost: number, from: number): void {
    if (this.seen[m] !== this.stamp) {
      this.seen[m] = this.stamp;
      this.g[m] = PATH_INFINITY;
    } else if (this.closed[m] === this.stamp) {
      return;
    }
    if (cost >= (this.g[m] as number)) return;
    const w = this.width;
    const my = (m / w) | 0;
    this.g[m] = cost;
    this.f[m] = cost + octile(this.goalX - (m - my * w), this.goalY - my);
    this.parent[m] = from;
    this.heap.push(m);
  }

  /** Plain tile on the level of the jump. */
  private isOpen(x: number, y: number): boolean {
    if (x < this.rx0 || y < this.ry0 || x >= this.rx1 || y >= this.ry1) return false;
    return ((this.words[y * this.width + x] as number) & this.openMask) === this.openValue;
  }

  /** Whether one of the eight neighbours of window tile (x, y) is special (only in chunks marked for it). */
  private specialNear(x: number, y: number): boolean {
    const bits = this.specialBits;
    if (bits === 0 || this.chunkSpecial[(y >> CHUNK_SHIFT) * this.cw + (x >> CHUNK_SHIFT)] === 0) return false;
    const words = this.words;
    const w = this.width;
    const x0 = x > 0 ? x - 1 : x;
    const x1 = x < w - 1 ? x + 1 : x;
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < this.height - 1 ? y + 1 : y;
    for (let yy = y0; yy <= y1; yy++) {
      const row = yy * w;
      for (let xx = x0; xx <= x1; xx++) if ((xx !== x || yy !== y) && ((words[row + xx] as number) & bits) !== 0) return true;
    }
    return false;
  }

  /**
   * Straight jump from the open tile (x, y) (see module comment): the hot loop of the search, written out with local
   * copies – the tile behind a scanned tile is always inside the area (the jump came from there).
   */
  private jumpStraight(x: number, y: number, dx: number, dy: number): number {
    const words = this.words;
    const w = this.width;
    const mask = this.openMask;
    const value = this.openValue;
    const goal = this.goal;
    const specials = this.specialBits !== 0;
    let i = y * w + x;
    if (dy === 0) {
      const x0 = this.rx0;
      const x1 = this.rx1;
      const up = y - 1 >= this.ry0;
      const down = y + 1 < this.ry1;
      for (;;) {
        if (i === goal || (specials && this.specialNear(x, y))) return i;
        this.scanned(i, x, y);
        if (up && ((words[i - w] as number) & mask) === value && ((words[i - w - dx] as number) & mask) !== value) return i;
        if (down && ((words[i + w] as number) & mask) === value && ((words[i + w - dx] as number) & mask) !== value) return i;
        x += dx;
        i += dx;
        if (x < x0 || x >= x1 || ((words[i] as number) & mask) !== value) return -1;
      }
    }
    const y0 = this.ry0;
    const y1 = this.ry1;
    const left = x - 1 >= this.rx0;
    const right = x + 1 < this.rx1;
    const step = dy * w;
    for (;;) {
      if (i === goal || (specials && this.specialNear(x, y))) return i;
      this.scanned(i, x, y);
      if (left && ((words[i - 1] as number) & mask) === value && ((words[i - 1 - step] as number) & mask) !== value) return i;
      if (right && ((words[i + 1] as number) & mask) === value && ((words[i + 1 - step] as number) & mask) !== value) return i;
      y += dy;
      i += step;
      if (y < y0 || y >= y1 || ((words[i] as number) & mask) !== value) return -1;
    }
  }

  private jumpDiagonal(x: number, y: number, dx: number, dy: number): number {
    const w = this.width;
    for (;;) {
      const i = y * w + x;
      if (i === this.goal || this.specialNear(x, y)) return i;
      this.scanned(i, x, y);
      const h = this.isOpen(x + dx, y);
      const v = this.isOpen(x, y + dy);
      this.scanCorner = i;
      const found = (h && this.jumpStraight(x + dx, y, dx, 0) >= 0) || (v && this.jumpStraight(x, y + dy, 0, dy) >= 0);
      this.scanCorner = -1;
      if (found) return i;
      if (!h || !v || !this.isOpen(x + dx, y + dy)) return -1;
      x += dx;
      y += dy;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------------------------------

  /**
   * Writes the tiles from the start of the last `search` to `end` (start excluded) into `out` as world tile pairs –
   * the jump points joined by their straight or diagonal lines – after the first `from` steps already there. Returns
   * the number of steps in `out` then.
   */
  tracePath(grid: PathGrid, end: number, out: PathResult, from = 0): number {
    const w = this.width;
    let count = 0;
    for (let n = end; n >= 0; n = this.parent[n] as number) {
      if (count >= this.trace.length) {
        const bigger = new Int32Array(grow(this.trace.length, count + 1));
        bigger.set(this.trace);
        this.trace = bigger;
      }
      this.trace[count++] = n;
    }
    let steps = 0;
    for (let k = count - 1; k > 0; k--) {
      const a = this.trace[k] as number;
      const b = this.trace[k - 1] as number;
      const ay = (a / w) | 0;
      const by = (b / w) | 0;
      steps += Math.max(Math.abs(b - by * w - (a - ay * w)), Math.abs(by - ay));
    }
    reservePathTilesKeep(out, from + steps);
    const tx0 = grid.tx0;
    const ty0 = grid.ty0;
    let o = 2 * from;
    for (let k = count - 1; k > 0; k--) {
      const a = this.trace[k] as number;
      const b = this.trace[k - 1] as number;
      const ay = (a / w) | 0;
      const ax = a - ay * w;
      const by = (b / w) | 0;
      const bx = b - by * w;
      const dx = Math.sign(bx - ax);
      const dy = Math.sign(by - ay);
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let s = 1; s <= n; s++) {
        out.tiles[o++] = tx0 + ax + dx * s;
        out.tiles[o++] = ty0 + ay + dy * s;
      }
    }
    return from + steps;
  }

  private newStamp(): void {
    if (this.stamp >= MAX_STAMP) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 0;
    }
    this.stamp++;
  }
}
