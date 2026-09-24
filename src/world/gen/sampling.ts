/**
 * Point sampling for world generation (M2-01, docs/WORLD.md §2): Poisson-disc sets and a tileable
 * blue-noise threshold map. Complements the value/simplex/fBm/ridged/domain-warp noise of
 * `src/engine/noise.ts`.
 *
 * - `poissonDisc` (Bridson): points with a guaranteed minimum distance over a rectangle, optionally
 *   restricted by an acceptance mask (island, biome). Used once per world for the Poisson regions of
 *   the world plan (§9.2 step 2) and for sparse place slots.
 * - `createBlueNoiseTile` (void-and-cluster, Ulichney 1993): a toroidal rank map. Thresholding it at
 *   density d (`blueNoiseAt(...) < d`) yields evenly spread points without clumps or gaps at any
 *   density, and because the map wraps seamlessly, chunks can sample it at world coordinates in any
 *   order (§9.2 step 7 "Blue-Noise-Streuung", WORLD.md §2 "unabhängig von der Reihenfolge").
 *
 * Determinism across browsers: world generation must reproduce the same world from the seed on
 * every device (unchanged chunks are regenerated, not saved). Both samplers therefore use only
 * + − × ÷ and comparisons on doubles (exactly rounded per IEEE 754) and the seeded `Rng`; no
 * `Math.sin`/`cos`/`exp`, whose last bits may differ between JavaScript engines.
 */
import { Rng } from '../../engine/rng';

// ---------------------------------------------------------------------------------------------
// Poisson-disc sampling
// ---------------------------------------------------------------------------------------------

/** A set of 2D points in insertion order. */
export interface PointSet {
  readonly count: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

/** Options of `poissonDisc`. */
export interface PoissonDiscOptions {
  /** Candidates tried around an active point before it retires (Bridson's k). Default 30. */
  readonly attempts?: number;
  /** Acceptance mask: only positions with `accept(x, y) === true` become points (default: all). */
  readonly accept?: (x: number, y: number) => boolean;
  /**
   * After the growth front dies out, scan the grid for empty cells and start new fronts there
   * (reaches disconnected parts of a mask, e.g. offshore islands). Default true.
   */
  readonly fillGaps?: boolean;
}

/** Bridson's recommended number of candidates per active point. */
export const POISSON_DEFAULT_ATTEMPTS = 30;
/** Random positions tried in an empty grid cell while filling gaps. */
const GAP_FILL_ATTEMPTS = 4;
/** Candidates lie in the annulus [r, 2r] around their parent. */
const ANNULUS_OUTER = 2;
/** Grid cells checked around a candidate (cell edge r/√2 ⇒ 2 cells cover the radius r). */
const NEIGHBOUR_CELLS = 2;
/** Grid cell value of an empty cell. */
const EMPTY = -1;

/**
 * Poisson-disc point set over `[0, width) × [0, height)` with pairwise distance ≥ `minDist` (Bridson
 * 2007). Every accepted position of the area lies within `2 × minDist` of a point (maximal up to the
 * sampling attempts). Deterministic for a given `rng` state; consumes numbers from `rng`.
 */
export function poissonDisc(rng: Rng, width: number, height: number, minDist: number, options: PoissonDiscOptions = {}): PointSet {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError(`poissonDisc: invalid area ${String(width)} × ${String(height)}`);
  if (!(minDist > 0) || !Number.isFinite(minDist)) throw new RangeError(`poissonDisc: minDist must be > 0, got ${String(minDist)}`);
  const attempts = options.attempts ?? POISSON_DEFAULT_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError(`poissonDisc: attempts must be an integer ≥ 1, got ${String(attempts)}`);
  const accept = options.accept;
  const cell = minDist / Math.SQRT2;
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const cells = gw * gh;
  // One point per grid cell at most, so the cell count bounds the point count.
  const grid = new Int32Array(cells).fill(EMPTY);
  const xs = new Float64Array(cells);
  const ys = new Float64Array(cells);
  const active = new Int32Array(cells);
  const r2 = minDist * minDist;
  const outer = ANNULUS_OUTER * minDist;
  const outer2 = outer * outer;
  let count = 0;
  let activeCount = 0;

  const fits = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const x0 = Math.max(0, gx - NEIGHBOUR_CELLS);
    const x1 = Math.min(gw - 1, gx + NEIGHBOUR_CELLS);
    const y0 = Math.max(0, gy - NEIGHBOUR_CELLS);
    const y1 = Math.min(gh - 1, gy + NEIGHBOUR_CELLS);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const p = grid[cy * gw + cx] as number;
        if (p === EMPTY) continue;
        const dx = (xs[p] as number) - x;
        const dy = (ys[p] as number) - y;
        if (dx * dx + dy * dy < r2) return false;
      }
    }
    return accept === undefined || accept(x, y);
  };

  const add = (x: number, y: number): void => {
    xs[count] = x;
    ys[count] = y;
    grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = count;
    active[activeCount++] = count;
    count++;
  };

  const grow = (): void => {
    while (activeCount > 0) {
      const k = rng.int(0, activeCount);
      const p = active[k] as number;
      const px = xs[p] as number;
      const py = ys[p] as number;
      let found = false;
      for (let a = 0; a < attempts && !found; a++) {
        // Uniform point in the annulus [r, 2r] by rejection from its bounding square (no trigonometry).
        let dx: number;
        let dy: number;
        let d2: number;
        do {
          dx = rng.float(-outer, outer);
          dy = rng.float(-outer, outer);
          d2 = dx * dx + dy * dy;
        } while (d2 < r2 || d2 > outer2);
        const x = px + dx;
        const y = py + dy;
        if (fits(x, y)) {
          add(x, y);
          found = true;
        }
      }
      if (!found) active[k] = active[--activeCount] as number;
    }
  };

  // Seed: a random accepted position, then grow; afterwards seed every still empty cell that has room.
  for (let a = 0; a < attempts && count === 0; a++) {
    const x = rng.float(0, width);
    const y = rng.float(0, height);
    if (fits(x, y)) add(x, y);
  }
  grow();
  if (options.fillGaps ?? true) {
    for (let c = 0; c < cells; c++) {
      if (grid[c] !== EMPTY) continue;
      const cx = (c % gw) * cell;
      const cy = Math.floor(c / gw) * cell;
      for (let a = 0; a < GAP_FILL_ATTEMPTS; a++) {
        const x = cx + rng.float(0, cell);
        const y = cy + rng.float(0, cell);
        if (fits(x, y)) {
          add(x, y);
          grow();
          break;
        }
      }
    }
  }
  return { count, xs: xs.slice(0, count), ys: ys.slice(0, count) };
}

// ---------------------------------------------------------------------------------------------
// Blue noise (void-and-cluster)
// ---------------------------------------------------------------------------------------------

/** A toroidal blue-noise rank map: every rank 0…size²−1 appears exactly once. */
export interface BlueNoiseTile {
  /** Edge length [cells]; the map repeats every `size` cells in x and y. */
  readonly size: number;
  /** Rank per cell, row major (`y × size + x`). */
  readonly ranks: Uint16Array;
}

/** Default edge length of a blue-noise tile [cells] (64² = 4096 ranks, built in ≈ 0,1 s). */
export const BLUE_NOISE_DEFAULT_SIZE = 64;
/** Smallest supported tile edge [cells]. */
export const BLUE_NOISE_MIN_SIZE = 8;
/** Largest supported tile edge [cells] (build time grows with size⁴). */
export const BLUE_NOISE_MAX_SIZE = 128;
/** Share of cells set in the initial binary pattern (Ulichney: ≈ 10 %). */
const INITIAL_DENSITY = 0.1;
/** Width of the energy kernel [cells] (Ulichney's σ = 1,5). */
const KERNEL_SIGMA = 1.5;
/** Exponent of the rational kernel 1 / (1 + d²/σ²)^p: bell-shaped near, long but vanishing tail. */
const KERNEL_POWER = 4;
/** Safety cap of the initial swap phase (it converges after a few hundred swaps). */
const MAX_RELAX_SWAPS_PER_CELL = 1;

/**
 * Builds a seamless blue-noise rank map with the void-and-cluster algorithm on a torus. The energy
 * kernel is the rational bell 1 / (1 + d²/σ²)⁴ over the whole tile (no exact ties between far
 * apart cells, no transcendental functions). Cost O(size⁴).
 */
export function createBlueNoiseTile(seed: number, size: number = BLUE_NOISE_DEFAULT_SIZE): BlueNoiseTile {
  if (!Number.isInteger(size) || size < BLUE_NOISE_MIN_SIZE || size > BLUE_NOISE_MAX_SIZE) {
    throw new RangeError(`createBlueNoiseTile: size must be an integer in ${BLUE_NOISE_MIN_SIZE}…${BLUE_NOISE_MAX_SIZE}, got ${String(size)}`);
  }
  const n = size * size;
  // Toroidal kernel: kernel[dy × size + dx] for the wrapped offset (dx, dy).
  const kernel = new Float64Array(n);
  const s2 = KERNEL_SIGMA * KERNEL_SIGMA;
  for (let dy = 0; dy < size; dy++) {
    const wy = Math.min(dy, size - dy);
    for (let dx = 0; dx < size; dx++) {
      const wx = Math.min(dx, size - dx);
      let k = 1 / (1 + (wx * wx + wy * wy) / s2);
      let p = k;
      for (let e = 1; e < KERNEL_POWER; e++) p *= k;
      k = p;
      kernel[dy * size + dx] = k;
    }
  }

  const pattern = new Uint8Array(n);
  const energy = new Float64Array(n);
  const splat = (field: Float64Array, q: number, sign: number): void => {
    const qx = q % size;
    const qy = (q - qx) / size;
    for (let y = 0; y < size; y++) {
      const ky = ((y - qy + size) % size) * size;
      const row = y * size;
      for (let x = 0; x < size; x++) field[row + x] = (field[row + x] as number) + sign * (kernel[ky + ((x - qx + size) % size)] as number);
    }
  };
  /** Cell with the highest energy among cells whose pattern value is `want` (first on ties). */
  const argExtreme = (pat: Uint8Array, field: Float64Array, want: number, highest: boolean): number => {
    let best = -1;
    let bestE = highest ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      if (pat[i] !== want) continue;
      const e = field[i] as number;
      if (highest ? e > bestE : e < bestE) {
        bestE = e;
        best = i;
      }
    }
    return best;
  };

  // Initial pattern: random cells, then swap tightest cluster ↔ largest void until stable.
  const rng = new Rng(seed);
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  rng.shuffle(order);
  const ones = Math.max(1, Math.floor(n * INITIAL_DENSITY));
  for (let i = 0; i < ones; i++) {
    const q = order[i] as number;
    pattern[q] = 1;
    splat(energy, q, 1);
  }
  for (let swap = 0; swap < n * MAX_RELAX_SWAPS_PER_CELL; swap++) {
    const cluster = argExtreme(pattern, energy, 1, true);
    pattern[cluster] = 0;
    splat(energy, cluster, -1);
    const voidCell = argExtreme(pattern, energy, 0, false);
    pattern[voidCell] = 1;
    splat(energy, voidCell, 1);
    if (voidCell === cluster) break;
  }

  const ranks = new Uint16Array(n);
  // Phase 1: rank the initial ones by removing the tightest cluster first (highest rank).
  const pat1 = pattern.slice();
  const en1 = energy.slice();
  for (let rank = ones - 1; rank >= 0; rank--) {
    const q = argExtreme(pat1, en1, 1, true);
    ranks[q] = rank;
    pat1[q] = 0;
    splat(en1, q, -1);
  }
  // Phases 2 and 3: fill the largest void next (lowest energy of the ones = highest energy of the
  // zeros, so the same rule serves both halves).
  for (let rank = ones; rank < n; rank++) {
    const q = argExtreme(pattern, energy, 0, false);
    ranks[q] = rank;
    pattern[q] = 1;
    splat(energy, q, 1);
  }
  return { size, ranks };
}

/** Threshold value in (0, 1) of the tile at integer cell (x, y); wraps in both axes. */
export function blueNoiseAt(tile: BlueNoiseTile, x: number, y: number): number {
  const s = tile.size;
  const cx = ((x % s) + s) % s;
  const cy = ((y % s) + s) % s;
  return ((tile.ranks[cy * s + cx] as number) + 0.5) / (s * s);
}
