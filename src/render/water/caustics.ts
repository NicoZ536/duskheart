/**
 * CPU mirror of the caustics of `water_surface.frag` (`waterHash` of water.glsl, `voronoiEdge`, `causticBend`,
 * `causticAt`; parameters `CAUSTICS` in `params.ts`), for the tests: the net of faint, bent lines of light in the sunny
 * shallows – its fineness, its strength and that its drift wraps without a seam (M5-62). Double precision where the
 * shader has 32-bit floats: the tests measure the net, not single pixels.
 */
import { CAUSTICS, causticWarpFrequency, motionRate } from './params';

/** The numbers of a caustic net (`CAUSTICS`; a test compares it with another). */
export type CausticNet = Pick<
  typeof CAUSTICS,
  'cellPx' | 'layerScale' | 'periodCells' | 'layerOffsetPx' | 'lineWidth' | 'layerLineWidth' | 'warpPx' | 'warpSpanCells' | 'wobble' | 'wobbleSpeed' | 'layerWobble' | 'strength' | 'maxCover'
>;
type Numbers<T> = { readonly [K in keyof T]: T[K] extends number ? number : T[K] extends readonly [number, number] ? readonly [number, number] : T[K] };
/** A caustic net with any numbers (the shipped one is `CAUSTICS`). */
export type CausticNetNumbers = Numbers<CausticNet>;

const TAU = 2 * Math.PI;
/** Hash constants of `waterHashU` (water.glsl). */
const HASH_X = 1597334673;
const HASH_Y = 3812015801;
const HASH_SALT = 2654435761;
const HASH_BITS = 0xffffff;
/** Nearest-point distances start beyond any cell of a 3 × 3 search (`FAR`). */
const FAR = 8;
/** Salts of the two layers (`causticAt`). */
const SALT_A = 3;
const SALT_B = 5;
const SALT_SECOND = 7;

/** `waterHash` of water.glsl: the hash of cell (`cx`, `cy`) with `salt` as 0…1 (32-bit unsigned arithmetic). */
export function waterHash(cx: number, cy: number, salt: number): number {
  const qx = Math.imul(cx | 0, HASH_X) >>> 0;
  const qy = Math.imul(cy | 0, HASH_Y | 0) >>> 0;
  const n = Math.imul((qx ^ qy ^ Math.imul(salt | 0, HASH_SALT | 0)) >>> 0, HASH_X) >>> 0;
  return (((n ^ (n >>> 16)) >>> 0) & HASH_BITS) / HASH_BITS;
}

function glslMod(v: number, m: number): number {
  return v - m * Math.floor(v / m);
}

/**
 * Distance to the nearest cell edge (F2 − F1, cell units) of the Voronoi field at `p` (cell units), each cell's point
 * swung around the cell's centre at the phases (`wobbleX`, `wobbleY`) [rad]; a lattice of `period` cells (`voronoiEdge`).
 */
export function voronoiEdge(px: number, py: number, wobbleX: number, wobbleY: number, salt: number, period: number, net: CausticNetNumbers = CAUSTICS): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  let f1 = FAR;
  let f2 = FAR;
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      let cx = ix + x;
      let cy = iy + y;
      if (period > 0) {
        cx = glslMod(cx, period);
        cy = glslMod(cy, period);
      }
      const h1 = waterHash(cx, cy, salt);
      const h2 = waterHash(cx, cy, salt + SALT_SECOND);
      const ox = 0.5 + net.wobble * Math.sin(wobbleX + TAU * h1);
      const oy = 0.5 + net.wobble * Math.cos(wobbleY + TAU * h2);
      const d = Math.hypot(x + ox - fx, y + oy - fy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return f2 - f1;
}

/** The bent lattice coordinates of a layer at `q` [px] (`causticBend`): warped in whole waves of `freq` [rad/px] per `period` [px]. */
export function causticBend(qx: number, qy: number, freq: number, period: number, net: CausticNetNumbers = CAUSTICS): [number, number] {
  const rx = glslMod(qx, period) * freq;
  const ry = glslMod(qy, period) * freq;
  return [qx + net.warpPx * Math.sin(ry), qy + net.warpPx * Math.cos(rx)];
}

/** Each layer's lattice period [px] (the drifts wrap after it). */
export function causticPeriods(net: CausticNetNumbers = CAUSTICS): [number, number] {
  return [net.cellPx * net.periodCells, net.cellPx * net.layerScale * net.periodCells];
}

/**
 * Caustic light 0…2 at world point (`x`, `y`) (`causticAt`): the two layers drifted by `driftA` and `driftB` [px], their
 * cells wobbling at motion time `motionTime` [s]; 2 where their lines cross.
 */
export function causticAt(x: number, y: number, driftA: readonly [number, number], driftB: readonly [number, number], motionTime: number, net: CausticNetNumbers = CAUSTICS): number {
  const cellB = net.cellPx * net.layerScale;
  const [periodA, periodB] = causticPeriods(net);
  const [ax, ay] = causticBend(x + driftA[0], y + driftA[1], causticWarpFrequency(net.cellPx, net.periodCells, net.warpSpanCells), periodA, net);
  const [bx, by] = causticBend(x + driftB[0] + net.layerOffsetPx[0], y + driftB[1] + net.layerOffsetPx[1], causticWarpFrequency(cellB, net.periodCells, net.warpSpanCells), periodB, net);
  const [sx, sy] = net.wobbleSpeed;
  const w = net.layerWobble;
  const a = voronoiEdge(ax / net.cellPx, ay / net.cellPx, motionTime * motionRate(sx), motionTime * motionRate(sy), SALT_A, net.periodCells, net) < net.lineWidth ? 1 : 0;
  const b = voronoiEdge(bx / cellB, by / cellB, motionTime * motionRate(sx * w), motionTime * motionRate(sy * w), SALT_B, net.periodCells, net) < net.lineWidth * net.layerLineWidth ? 1 : 0;
  return a + b;
}

/** Share of the caustic colour laid over the ground for caustic light `caustic` at depth fade `k` 0…1 (`waterColour`). */
export function causticCover(caustic: number, k: number, net: CausticNetNumbers = CAUSTICS): number {
  return caustic > 0.5 ? Math.min(net.strength * caustic * k, net.maxCover) : 0;
}
