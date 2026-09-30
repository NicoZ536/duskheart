/**
 * Helpers of the path finding tests (M6-16): random tile-word grids with levels, ramps, doors, water and light, and
 * an independent reference – Dijkstra over the step rules as docs/SPIEL.md §12 and src/world/path/grid.ts state them,
 * written without the search code – plus a checker that walks a path step by step.
 */
import { BALANCE } from '../../../src/content/balance';
import { Rng } from '../../../src/engine/rng';
import { BLOCK_ALL, BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL } from '../../../src/world/collision/tiles';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { PATH_CONNECTOR, PATH_DOOR, PATH_LEVEL_SHIFT, PATH_LIGHT, PATH_WATER, PathGrid } from '../../../src/world/path/grid';
import type { MoverClass, PathResult } from '../../../src/world/path/types';

/** Spec of the mover classes, restated for the reference (docs/SPIEL.md §12, §19.4). */
const REF_BLOCKS: Record<MoverClass, number> = {
  land: BLOCK_ALL,
  schwimmer: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID,
  amphibie: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID,
  flieger: BLOCK_SOLID | BLOCK_VOID,
};

export const REF_STRAIGHT = 1000;
export const REF_DIAGONAL = 1414;
export const REF_DOOR = BALANCE.ai.path.doorCostTiles * REF_STRAIGHT;
export const REF_INF = Number.POSITIVE_INFINITY;

/** Reference rules of one request. */
export class RefRules {
  readonly blocked: number;
  readonly required: number;
  readonly walk: boolean;
  constructor(
    readonly grid: PathGrid,
    readonly mover: MoverClass,
    readonly opens: boolean,
    readonly light: boolean,
  ) {
    this.blocked = REF_BLOCKS[mover] | (opens ? 0 : PATH_DOOR) | (light ? PATH_LIGHT : 0);
    this.required = mover === 'schwimmer' ? PATH_WATER : 0;
    this.walk = mover !== 'flieger';
  }

  word(x: number, y: number): number {
    return this.grid.words[y * this.grid.width + x] as number;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.grid.width && y < this.grid.height;
  }

  pass(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const w = this.word(x, y);
    return (w & this.blocked) === 0 && (w & this.required) === this.required;
  }

  join(a: number, b: number): boolean {
    if (!this.walk) return true;
    const la = (a >> PATH_LEVEL_SHIFT) & 0b111;
    const lb = (b >> PATH_LEVEL_SHIFT) & 0b111;
    if (la === lb) return true;
    return (a & PATH_CONNECTOR) !== 0 && (b & PATH_CONNECTOR) !== 0 && Math.abs(la - lb) === 1;
  }

  /** Cost of the step (x, y) → (x + dx, y + dy), or ∞ if it is not allowed. */
  step(x: number, y: number, dx: number, dy: number): number {
    const bx = x + dx;
    const by = y + dy;
    if (!this.pass(bx, by)) return REF_INF;
    const a = this.word(x, y);
    const b = this.word(bx, by);
    if (!this.join(a, b)) return REF_INF;
    const door = this.opens && (b & PATH_DOOR) !== 0 ? REF_DOOR : 0;
    if (dx === 0 || dy === 0) return REF_STRAIGHT + door;
    if (!this.pass(bx, y) || !this.pass(x, by)) return REF_INF;
    const o1 = this.word(bx, y);
    const o2 = this.word(x, by);
    if ((o1 & PATH_DOOR) !== 0 || (o2 & PATH_DOOR) !== 0) return REF_INF;
    if (!this.join(a, o1) || !this.join(a, o2) || !this.join(b, o1) || !this.join(b, o2)) return REF_INF;
    return REF_DIAGONAL + door;
  }
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Reference distances from (sx, sy) over the whole grid (Dijkstra). `allowed(x, y)` restricts the tiles (the chunk of
 * a portal); the start is never checked. Returns the distance array (∞ where unreachable).
 */
export function refDistances(rules: RefRules, sx: number, sy: number, allowed: (x: number, y: number) => boolean = () => true): Float64Array {
  const { width, height } = rules.grid;
  const dist = new Float64Array(width * height).fill(REF_INF);
  const done = new Uint8Array(width * height);
  // Binary heap of [cost, node] with lazy deletion.
  const heapCost: number[] = [];
  const heapNode: number[] = [];
  const push = (c: number, n: number): void => {
    heapCost.push(c);
    heapNode.push(n);
    let i = heapCost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heapCost[p] as number) <= c) break;
      heapCost[i] = heapCost[p] as number;
      heapNode[i] = heapNode[p] as number;
      i = p;
    }
    heapCost[i] = c;
    heapNode[i] = n;
  };
  const pop = (): number => {
    const top = heapNode[0] as number;
    const lastC = heapCost.pop() as number;
    const lastN = heapNode.pop() as number;
    if (heapCost.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heapCost.length) break;
        const r = l + 1;
        const c = r < heapCost.length && (heapCost[r] as number) < (heapCost[l] as number) ? r : l;
        if ((heapCost[c] as number) >= lastC) break;
        heapCost[i] = heapCost[c] as number;
        heapNode[i] = heapNode[c] as number;
        i = c;
      }
      heapCost[i] = lastC;
      heapNode[i] = lastN;
    }
    return top;
  };
  const start = sy * width + sx;
  dist[start] = 0;
  push(0, start);
  while (heapCost.length > 0) {
    const n = pop();
    if (done[n] === 1) continue;
    done[n] = 1;
    const x = n % width;
    const y = (n - x) / width;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!rules.inside(nx, ny) || !allowed(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!allowed(nx, y) || !allowed(x, ny))) continue;
      const c = rules.step(x, y, dx, dy);
      if (c === REF_INF) continue;
      const m = ny * width + nx;
      const d = (dist[n] as number) + c;
      if (d < (dist[m] as number)) {
        dist[m] = d;
        push(d, m);
      }
    }
  }
  return dist;
}

/** Walks a path from (sx, sy) (window-local) and returns its cost under the reference rules (∞ if a step is illegal). */
export function refPathCost(rules: RefRules, sx: number, sy: number, path: PathResult): number {
  let x = sx;
  let y = sy;
  let cost = 0;
  const g = rules.grid;
  for (let i = 0; i < path.steps; i++) {
    const nx = (path.tiles[2 * i] as number) - g.tx0;
    const ny = (path.tiles[2 * i + 1] as number) - g.ty0;
    const dx = nx - x;
    const dy = ny - y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return REF_INF;
    const c = rules.step(x, y, dx, dy);
    if (c === REF_INF) return REF_INF;
    cost += c;
    x = nx;
    y = ny;
  }
  return cost;
}

/** Options of a random grid. */
export interface RandomGridOptions {
  /** Chunks per axis. */
  readonly chunks: number;
  /** Share of tiles with an object [0–1]. */
  readonly obstacles: number;
  /** Raised plateaus with ramps. */
  readonly levels: boolean;
  /** Wall lines with doors. */
  readonly doors: boolean;
  /** Ponds (shallow and deep water). */
  readonly water: boolean;
  /** Lit blobs. */
  readonly light: boolean;
}

/** A random tile-word grid (see `RandomGridOptions`), with level links and special marks computed. */
export function randomGrid(seed: number, o: RandomGridOptions): PathGrid {
  const rng = new Rng(seed);
  const grid = new PathGrid();
  grid.reset(0, 0, 0, o.chunks, o.chunks);
  const { width, height, words } = grid;
  words.fill(0, 0, width * height);
  const set = (x: number, y: number, bits: number): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) words[y * width + x] = (words[y * width + x] as number) | bits;
  };
  const setLevel = (x: number, y: number, level: number): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) words[y * width + x] = ((words[y * width + x] as number) & ~(0b111 << PATH_LEVEL_SHIFT)) | (level << PATH_LEVEL_SHIFT);
  };
  const levelAt = (x: number, y: number): number => ((words[y * width + x] as number) >> PATH_LEVEL_SHIFT) & 0b111;
  if (o.levels) {
    const plateaus = 2 + rng.int(0, o.chunks * 2);
    for (let k = 0; k < plateaus; k++) {
      const w = rng.int(6, 24);
      const h = rng.int(6, 24);
      const x0 = rng.int(0, width - w);
      const y0 = rng.int(0, height - h);
      const level = levelAt(x0 + (w >> 1), y0 + (h >> 1)) + 1;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setLevel(x, y, level);
      // Ramps: 1–3 tiles wide on random edges – connector on the plateau edge and on the tile outside it.
      const ramps = rng.int(1, 4);
      for (let r = 0; r < ramps; r++) {
        const side = rng.int(0, 4);
        const wide = rng.int(1, 4);
        const along = rng.int(0, Math.max(1, (side % 2 === 0 ? w : h) - wide));
        for (let t = 0; t < wide; t++) {
          let ix: number;
          let iy: number;
          let ox: number;
          let oy: number;
          if (side === 0) [ix, iy, ox, oy] = [x0 + along + t, y0, x0 + along + t, y0 - 1];
          else if (side === 1) [ix, iy, ox, oy] = [x0 + w - 1, y0 + along + t, x0 + w, y0 + along + t];
          else if (side === 2) [ix, iy, ox, oy] = [x0 + along + t, y0 + h - 1, x0 + along + t, y0 + h];
          else [ix, iy, ox, oy] = [x0, y0 + along + t, x0 - 1, y0 + along + t];
          if (ox < 0 || oy < 0 || ox >= width || oy >= height) continue;
          if (levelAt(ox, oy) !== level - 1) continue;
          set(ix, iy, PATH_CONNECTOR);
          set(ox, oy, PATH_CONNECTOR);
        }
      }
      // A few lone connectors without a partner (a stair tile at the foot of nothing).
      set(rng.int(0, width), rng.int(0, height), PATH_CONNECTOR);
    }
  }
  if (o.water) {
    const ponds = 1 + rng.int(0, o.chunks * 2);
    for (let k = 0; k < ponds; k++) {
      const cx = rng.int(0, width);
      const cy = rng.int(0, height);
      const r = rng.int(2, 9);
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 > r * r) continue;
          set(x, y, PATH_WATER | (d2 < (r * r) / 3 ? BLOCK_DEEP_WATER : 0));
        }
      }
    }
  }
  if (o.doors) {
    const walls = 1 + rng.int(0, o.chunks * 2);
    for (let k = 0; k < walls; k++) {
      const horizontal = rng.next() < 0.5;
      const len = rng.int(8, 40);
      const x0 = rng.int(0, width);
      const y0 = rng.int(0, height);
      const door = rng.int(1, len - 1);
      for (let t = 0; t < len; t++) {
        const x = horizontal ? x0 + t : x0;
        const y = horizontal ? y0 : y0 + t;
        if (x >= width || y >= height) break;
        // The door's own solid is not in the word (the cache removes it), the door bit is.
        set(x, y, t === door ? PATH_DOOR : BLOCK_SOLID);
      }
    }
  }
  if (o.light) {
    const blobs = 1 + rng.int(0, o.chunks * 2);
    for (let k = 0; k < blobs; k++) {
      const cx = rng.int(0, width);
      const cy = rng.int(0, height);
      const r = rng.int(2, 7);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) set(x, y, PATH_LIGHT);
    }
  }
  for (let i = 0; i < width * height; i++) if (rng.next() < o.obstacles) words[i] = (words[i] as number) | BLOCK_OBJECT;
  finishGrid(grid);
  return grid;
}

/** Chunk versions handed out to hand-made grids: like the tile cache's, every finished grid gets new ones. */
let nextVersion = 1;

/** Computes level links, special marks and fresh chunk versions of a hand-made grid. */
export function finishGrid(grid: PathGrid): PathGrid {
  grid.markLinks();
  grid.markSpecials();
  for (let c = 0; c < grid.cw * grid.ch; c++) grid.versions[c] = nextVersion++;
  return grid;
}

/** An empty grid of `chunks × chunks` chunks (level 0 ground). */
export function emptyGrid(chunksX: number, chunksY = chunksX): PathGrid {
  const grid = new PathGrid();
  grid.reset(0, 0, 0, chunksX, chunksY);
  grid.words.fill(0, 0, grid.width * grid.height);
  return grid;
}

/** Random passable tile of the grid for the rules (window-local), or null after many tries. */
export function randomPassable(rng: Rng, rules: RefRules): [number, number] | null {
  for (let k = 0; k < 400; k++) {
    const x = rng.int(0, rules.grid.width);
    const y = rng.int(0, rules.grid.height);
    if (rules.pass(x, y)) return [x, y];
  }
  return null;
}

/** Tiles per chunk edge (re-export for the tests). */
export const CHUNK = CHUNK_SIZE;
