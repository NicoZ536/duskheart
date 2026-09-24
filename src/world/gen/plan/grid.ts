/**
 * Coarse raster of the world plan (docs/WORLD.md §2 step 1): one plan cell covers
 * `PLAN_CELL_TILES`² tiles. Helpers for neighbours, connected components, exact Euclidean distance
 * transforms (signed distance fields) and bilinear sampling at tile positions.
 *
 * Determinism: only + − × ÷, comparisons, `Math.floor` and `Math.sqrt` (all exactly rounded in
 * IEEE 754), so every JavaScript engine computes bit-identical fields (docs/ARCHITEKTUR.md
 * "Sampling und Kalender").
 */
import type { WorldSizePreset } from '../../../content/balance';
import { worldDimensions } from '../../model/worldSize';
import { PLAN_CELL_TILES } from './params';

/** Dimensions of the plan raster of one world. */
export interface PlanGrid {
  /** World edge length [tiles]. */
  readonly tiles: number;
  /** Edge length of one plan cell [tiles]. */
  readonly cellTiles: number;
  /** Cells per row. */
  readonly width: number;
  /** Cells per column. */
  readonly height: number;
  /** Number of cells (`width × height`). */
  readonly count: number;
}

/** Plan raster of a world size. */
export function planGrid(preset: WorldSizePreset): PlanGrid {
  const tiles = worldDimensions(preset).tiles;
  if (tiles % PLAN_CELL_TILES !== 0) throw new RangeError(`World edge ${tiles} is not a multiple of the plan cell (${PLAN_CELL_TILES} tiles)`);
  const width = tiles / PLAN_CELL_TILES;
  return Object.freeze({ tiles, cellTiles: PLAN_CELL_TILES, width, height: width, count: width * width });
}

/** x offsets of the four edge neighbours (east, south, west, north). */
export const DX4 = [1, 0, -1, 0] as const;
/** y offsets of the four edge neighbours (east, south, west, north). */
export const DY4 = [0, 1, 0, -1] as const;
/** Number of edge neighbours. */
export const NEIGHBOURS_4 = 4;

/** Index of the edge neighbour in direction `dir` (0 east, 1 south, 2 west, 3 north), or −1 outside the grid. */
export function neighbour4(grid: PlanGrid, cell: number, dir: number): number {
  const x = (cell % grid.width) + (DX4[dir] as number);
  const y = Math.floor(cell / grid.width) + (DY4[dir] as number);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
  return y * grid.width + x;
}

/** Tile x of a cell centre. */
export function cellCenterX(grid: PlanGrid, cell: number): number {
  return ((cell % grid.width) + 0.5) * grid.cellTiles;
}

/** Tile y of a cell centre. */
export function cellCenterY(grid: PlanGrid, cell: number): number {
  return (Math.floor(cell / grid.width) + 0.5) * grid.cellTiles;
}

/** Cell containing the tile position (x, y), clamped into the grid. */
export function cellAtTile(grid: PlanGrid, x: number, y: number): number {
  let cx = Math.floor(x / grid.cellTiles);
  let cy = Math.floor(y / grid.cellTiles);
  if (cx < 0) cx = 0;
  else if (cx >= grid.width) cx = grid.width - 1;
  if (cy < 0) cy = 0;
  else if (cy >= grid.height) cy = grid.height - 1;
  return cy * grid.width + cx;
}

/** Result of `labelComponents`. */
export interface Components {
  /** Component id per cell, −1 for cells outside the mask. Ids are dense, in scan order of their first cell. */
  readonly label: Int32Array;
  /** Cells per component. */
  readonly sizes: number[];
}

/**
 * Labels the 4-connected components of the cells for which `inMask(cell)` holds (breadth first,
 * scan order ⇒ deterministic ids).
 */
export function labelComponents(grid: PlanGrid, inMask: (cell: number) => boolean): Components {
  const label = new Int32Array(grid.count).fill(-1);
  const queue = new Int32Array(grid.count);
  const sizes: number[] = [];
  for (let start = 0; start < grid.count; start++) {
    if (label[start] !== -1 || !inMask(start)) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const c = queue[head++] as number;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const n = neighbour4(grid, c, d);
        if (n < 0 || label[n] !== -1 || !inMask(n)) continue;
        label[n] = id;
        queue[tail++] = n;
      }
    }
    sizes.push(tail);
  }
  return { label, sizes };
}

/** Squared distance used for "no feature" in the distance transform (finite, so differences stay exact enough). */
const EDT_INF = 1e20;

/** 1D squared Euclidean distance transform of `f` (Felzenszwalb & Huttenlocher 2012) into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    const fq = (f[q] as number) + q * q;
    let vk = v[k] as number;
    let s = (fq - ((f[vk] as number) + vk * vk)) / (2 * q - 2 * vk);
    while (s <= (z[k] as number)) {
      k--;
      vk = v[k] as number;
      s = (fq - ((f[vk] as number) + vk * vk)) / (2 * q - 2 * vk);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const vk = v[k] as number;
    d[q] = (q - vk) * (q - vk) + (f[vk] as number);
  }
}

/**
 * Exact squared Euclidean distance [cells²] from every cell centre to the nearest cell centre with
 * `feature(cell) === true`. Cells are far (`≥ EDT_INF`) when no feature exists.
 */
export function squaredDistanceTransform(grid: PlanGrid, feature: (cell: number) => boolean): Float64Array {
  const { width: w, height: h } = grid;
  const n = Math.max(w, h);
  const out = new Float64Array(grid.count);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = feature(y * w + x) ? 0 : EDT_INF;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y] as number;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x] as number;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x] as number;
  }
  return out;
}

/** Largest magnitude of a signed distance field [tiles] (distances beyond it carry only their sign). */
export const SDF_CLAMP_TILES = 4096;

/**
 * Signed distance field [tiles] of a cell set: positive inside, negative outside, zero on the cell
 * edges between inside and outside (±½ cell at the centres of boundary cells). Bilinear sampling
 * (`sampleBilinear`) turns it into a smooth boundary curve at tile resolution.
 */
export function signedDistanceField(grid: PlanGrid, inside: (cell: number) => boolean): Float32Array {
  const toOutside = squaredDistanceTransform(grid, (c) => !inside(c));
  const toInside = squaredDistanceTransform(grid, inside);
  const out = new Float32Array(grid.count);
  const half = 0.5;
  for (let c = 0; c < grid.count; c++) {
    const isIn = inside(c);
    const d2 = isIn ? (toOutside[c] as number) : (toInside[c] as number);
    const d = d2 >= EDT_INF ? SDF_CLAMP_TILES : Math.min(SDF_CLAMP_TILES, (Math.sqrt(d2) - half) * grid.cellTiles);
    out[c] = isIn ? d : -d;
  }
  return out;
}

/**
 * Bilinear interpolation of a per-cell field at the tile position (x, y); cell values live at the
 * cell centres, positions outside the centre lattice clamp to the border cells.
 */
export function sampleBilinear(grid: PlanGrid, field: ArrayLike<number>, x: number, y: number): number {
  const gx = x / grid.cellTiles - 0.5;
  const gy = y / grid.cellTiles - 0.5;
  let x0 = Math.floor(gx);
  let y0 = Math.floor(gy);
  let fx = gx - x0;
  let fy = gy - y0;
  if (x0 < 0) {
    x0 = 0;
    fx = 0;
  } else if (x0 >= grid.width - 1) {
    x0 = grid.width - 2;
    fx = gx >= grid.width - 1 ? 1 : fx;
  }
  if (y0 < 0) {
    y0 = 0;
    fy = 0;
  } else if (y0 >= grid.height - 1) {
    y0 = grid.height - 2;
    fy = gy >= grid.height - 1 ? 1 : fy;
  }
  const i = y0 * grid.width + x0;
  const a = field[i] as number;
  const b = field[i + 1] as number;
  const c = field[i + grid.width] as number;
  const d = field[i + grid.width + 1] as number;
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Writes the tile-space gradient of the bilinear field at (x, y) into `out` (per tile). */
export function gradientBilinear(grid: PlanGrid, field: ArrayLike<number>, x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
  const gx = x / grid.cellTiles - 0.5;
  const gy = y / grid.cellTiles - 0.5;
  let x0 = Math.floor(gx);
  let y0 = Math.floor(gy);
  x0 = x0 < 0 ? 0 : x0 >= grid.width - 1 ? grid.width - 2 : x0;
  y0 = y0 < 0 ? 0 : y0 >= grid.height - 1 ? grid.height - 2 : y0;
  const fx = Math.min(1, Math.max(0, gx - x0));
  const fy = Math.min(1, Math.max(0, gy - y0));
  const i = y0 * grid.width + x0;
  const a = field[i] as number;
  const b = field[i + 1] as number;
  const c = field[i + grid.width] as number;
  const d = field[i + grid.width + 1] as number;
  out.x = ((b - a) * (1 - fy) + (d - c) * fy) / grid.cellTiles;
  out.y = ((c - a) * (1 - fx) + (d - b) * fx) / grid.cellTiles;
  return out;
}

/** Separable box blur of a per-cell field with the given radius [cells]; edges clamp. */
export function boxBlur(grid: PlanGrid, field: Float32Array, radius: number): Float32Array {
  if (radius <= 0) return field.slice();
  const { width: w, height: h } = grid;
  const tmp = new Float32Array(grid.count);
  const out = new Float32Array(grid.count);
  const span = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        s += field[y * w + xx] as number;
      }
      tmp[y * w + x] = s / span;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        s += tmp[yy * w + x] as number;
      }
      out[y * w + x] = s / span;
    }
  }
  return out;
}

/** Binary min-heap of cell indices keyed by a float priority; ties break on the smaller cell index. */
export class CellHeap {
  private readonly cells: Int32Array;
  private readonly keys: Float64Array;
  private n = 0;

  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  private less(i: number, j: number): boolean {
    const ki = this.keys[i] as number;
    const kj = this.keys[j] as number;
    return ki < kj || (ki === kj && (this.cells[i] as number) < (this.cells[j] as number));
  }

  private swap(i: number, j: number): void {
    const c = this.cells[i] as number;
    const k = this.keys[i] as number;
    this.cells[i] = this.cells[j] as number;
    this.keys[i] = this.keys[j] as number;
    this.cells[j] = c;
    this.keys[j] = k;
  }

  push(cell: number, key: number): void {
    let i = this.n++;
    this.cells[i] = cell;
    this.keys[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Key of the smallest entry (undefined behaviour when empty). */
  peekKey(): number {
    return this.keys[0] as number;
  }

  /** Removes and returns the cell with the smallest key. */
  pop(): number {
    const top = this.cells[0] as number;
    this.n--;
    if (this.n > 0) {
      this.cells[0] = this.cells[this.n] as number;
      this.keys[0] = this.keys[this.n] as number;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}
