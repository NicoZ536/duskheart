/**
 * World plan step 6 (M2-09, MASTERPROMPT §9.2.6): biome borders blurred by a domain warp, with
 * transition strips of 4–12 tiles (e.g. taiga between Grünhain and Frostkamm).
 *
 * A tile looks up its biome at a domain-warped position. Inland and ring regions are separated where
 * the coast distance equals the noisy band width (the rule that classified the plan cells, smooth at
 * tile resolution); within each kind the Voronoi cell of the nearest
 * seed among the regions of the surrounding plan cells wins (the plan's cell regions keep the
 * candidates local, so no far region leaks in). The distance to the nearest region of another
 * biome is a first-order distance in tile space: the warped-space distance (Voronoi bisector,
 * or the ring iso-line) divided by the length of its gradient pulled back through the warp's
 * Jacobian. Inside half the local strip width (5–11 tiles, varying along the border) the tile
 * blends towards that biome: weight ½ on the border, 0 at the strip edge. Transition strips are
 * mixing zones, not biomes (docs/WORLD.md §7): the chunk generator dithers between the two biomes
 * with `pickBiome` and mixes their vegetation by the weight.
 */
import { fbm, noiseTo01 } from '../../../engine/noise';
import { planBiomeIndex } from './biomes';
import { createPlanFields, planNoise } from './fields';
import { cellAtTile, cellCenterX, cellCenterY, gradientBilinear, sampleBilinear } from './grid';
import type { WorldPlan } from './index';
import { BIOME_ROLES, BORDERS } from './params';
import { CELL_BAND, CELL_INTERIOR, CELL_SEA } from './regions';

/** Result of `BiomeSampler.sample` (reused by the caller). */
export interface BiomeSample {
  /** Index into `PLAN_BIOME_IDS` of the tile's own biome. */
  primary: number;
  /** Index of the neighbouring biome the tile blends towards (= `primary` outside a strip). */
  secondary: number;
  /** Weight of `secondary` [0, 0,5]: ½ on the border, 0 outside the strip. */
  blend: number;
  /** Region of the tile (−1 far out at sea). */
  region: number;
  /** Distance to the nearest border with another biome [tiles, first order]; Infinity when none is near. */
  borderDistance: number;
  /** Half width of the transition strip at this tile [tiles]. */
  halfWidth: number;
}

/** Tile sampler of the biome field. */
export interface BiomeSampler {
  readonly plan: WorldPlan;
  /** Samples the tile (tx, ty) (at its centre) into `out` and returns it. */
  sample(tx: number, ty: number, out: BiomeSample): BiomeSample;
  /** Samples the continuous tile-space position (x, y), e.g. for decoration inside a tile. */
  sampleAt(x: number, y: number, out: BiomeSample): BiomeSample;
}

/** New empty sample record. */
export function createBiomeSample(): BiomeSample {
  return { primary: 0, secondary: 0, blend: 0, region: -1, borderDistance: Infinity, halfWidth: 0 };
}

/**
 * Biome of a tile for a dither threshold in [0, 1) (e.g. blue noise at the tile): the secondary
 * biome wins where its weight exceeds the threshold, so the strip mixes both biomes.
 */
export function pickBiome(sample: BiomeSample, threshold: number): number {
  return sample.blend > threshold ? sample.secondary : sample.primary;
}

/** Largest number of candidate regions (3 × 3 cells). */
const MAX_CANDIDATES = 9;
/** Decorrelation offsets of the two warp axes [noise units]. */
const WARP_OFFSET_A = 23.1;
const WARP_OFFSET_B = 57.7;
/** Smallest |ring field| of a cell the plan put on the other side of the band-width rule [tiles]: half a cell, so the cell centre sits on the plan's side. */
const CLASS_MARGIN_TILES = 4;
/** Smallest gradient length accepted when converting to tile distances (degenerate warps). */
const MIN_GRADIENT = 0.25;

/** Builds the biome sampler of a plan. */
export function createBiomeSampler(plan: WorldPlan): BiomeSampler {
  const { grid, regions } = plan;
  const warp = planNoise(plan.seed, plan.attempt, 'tile.biomeWarp');
  const strip = planNoise(plan.seed, plan.attempt, 'tile.strip');
  const warpOpts = { octaves: BORDERS.warpOctaves, frequency: 1 / BORDERS.warpWavelengthTiles };
  // Ring/inland boundary field per cell [tiles]: coast distance minus the noisy band width (the rule
  // that classified the plan cells), forced to the plan's side where the plan reclassified a cell
  // (narrow tongues and small pieces joined the ring). Bilinear at tile resolution: smooth, and a
  // near-true distance because the coast field is one.
  const fields = createPlanFields(plan.seed, plan.attempt, plan.preset, grid.tiles);
  const ringField = new Float32Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    const g = (plan.coastDistance[c] as number) - fields.bandWidthAt(cellCenterX(grid, c), cellCenterY(grid, c));
    const kind = plan.cellKind[c] as number;
    ringField[c] = kind === CELL_INTERIOR ? (g > CLASS_MARGIN_TILES ? g : CLASS_MARGIN_TILES) : kind === CELL_BAND && g > -CLASS_MARGIN_TILES ? -CLASS_MARGIN_TILES : g;
  }
  const biomeOf = Int32Array.from(regions.map((r) => planBiomeIndex(r.biome)));
  const seedX = Float64Array.from(regions.map((r) => r.seedX));
  const seedY = Float64Array.from(regions.map((r) => r.seedY));
  const ringBiome = planBiomeIndex(BIOME_ROLES.ring);
  const cand = new Int32Array(MAX_CANDIDATES);
  const other = new Int32Array(MAX_CANDIDATES);
  const grad = { x: 0, y: 0 };
  const step = BORDERS.jacobianStepTiles;

  // Warp Jacobian of the tile being sampled (set per sample; no allocation per call).
  let jxx = 1;
  let jyx = 0;
  let jxy = 0;
  let jyy = 1;
  /** Length of the tile-space gradient of a warped-space function with gradient (gx, gy). */
  const pull = (gx: number, gy: number): number => {
    const ux = jxx * gx + jyx * gy;
    const uy = jxy * gx + jyy * gy;
    const len = Math.sqrt(ux * ux + uy * uy);
    return len < MIN_GRADIENT ? MIN_GRADIENT : len;
  };
  const warpX = (x: number, y: number): number => x + BORDERS.warpTiles * fbm(warp, x + WARP_OFFSET_A, y - WARP_OFFSET_B, warpOpts);
  const warpY = (x: number, y: number): number => y + BORDERS.warpTiles * fbm(warp, x - WARP_OFFSET_B, y + WARP_OFFSET_A, warpOpts);

  /** Collects the distinct regions of kind `kind` (or any land kind when `kind` < 0) around cell (cx, cy). */
  const collect = (cx: number, cy: number, kind: number, into: Int32Array): number => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= grid.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= grid.width) continue;
        const c = y * grid.width + x;
        const k = plan.cellKind[c] as number;
        if (k === CELL_SEA || (kind >= 0 && k !== kind)) continue;
        const r = plan.region[c] as number;
        let dup = false;
        for (let i = 0; i < n && !dup; i++) dup = into[i] === r;
        if (!dup) into[n++] = r;
      }
    }
    return n;
  };

  const sampleAt = (x: number, y: number, out: BiomeSample): BiomeSample => {
    const wx = warpX(x, y);
    const wy = warpY(x, y);
    // Warp Jacobian by forward differences (tile → warped space).
    jxx = (warpX(x + step, y) - wx) / step;
    jyx = (warpY(x + step, y) - wy) / step;
    jxy = (warpX(x, y + step) - wx) / step;
    jyy = (warpY(x, y + step) - wy) / step;

    const classValue = sampleBilinear(grid, ringField, wx, wy);
    const kind = classValue > 0 ? CELL_INTERIOR : CELL_BAND;
    const cell = cellAtTile(grid, wx, wy);
    const cx = cell % grid.width;
    const cy = Math.floor(cell / grid.width);
    let n = collect(cx, cy, kind, cand);
    if (n === 0) n = collect(cx, cy, -1, cand);
    out.halfWidth = (BORDERS.stripMinTiles + (BORDERS.stripMaxTiles - BORDERS.stripMinTiles) * noiseTo01(strip(x / BORDERS.stripWavelengthTiles, y / BORDERS.stripWavelengthTiles))) / 2;
    if (n === 0) {
      // Open sea: the coastal ring's water.
      out.primary = ringBiome;
      out.secondary = ringBiome;
      out.blend = 0;
      out.region = -1;
      out.borderDistance = Infinity;
      return out;
    }
    // Nearest seed of the candidates.
    let best = cand[0] as number;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const r = cand[i] as number;
      const dx = (seedX[r] as number) - wx;
      const dy = (seedY[r] as number) - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    const own = biomeOf[best] as number;
    let border = Infinity;
    let secondary = own;
    // Voronoi borders to candidates of another biome: distance to cell j ≥ max over k of the
    // signed distance to the bisector (k | j), each scaled into tile space.
    for (let i = 0; i < n; i++) {
      const j = cand[i] as number;
      if ((biomeOf[j] as number) === own) continue;
      let dj = -Infinity;
      for (let q = 0; q < n; q++) {
        const k = cand[q] as number;
        if (k === j) continue;
        const ex = (seedX[j] as number) - (seedX[k] as number);
        const ey = (seedY[j] as number) - (seedY[k] as number);
        const len = Math.sqrt(ex * ex + ey * ey);
        if (len === 0) continue;
        const ajx = wx - (seedX[j] as number);
        const ajy = wy - (seedY[j] as number);
        const akx = wx - (seedX[k] as number);
        const aky = wy - (seedY[k] as number);
        const f = (ajx * ajx + ajy * ajy - akx * akx - aky * aky) / (2 * len);
        const d = f / pull(-ex / len, -ey / len);
        if (d > dj) dj = d;
      }
      if (dj < border) {
        border = dj;
        secondary = biomeOf[j] as number;
      }
    }
    // Border between the ring and the interior: the iso-line of the interior distance field.
    const m = collect(cx, cy, kind === CELL_INTERIOR ? CELL_BAND : CELL_INTERIOR, other);
    if (m > 0) {
      let near = other[0] as number;
      let nearD = Infinity;
      for (let i = 0; i < m; i++) {
        const r = other[i] as number;
        const dx = (seedX[r] as number) - wx;
        const dy = (seedY[r] as number) - wy;
        const d = dx * dx + dy * dy;
        if (d < nearD) {
          nearD = d;
          near = r;
        }
      }
      if ((biomeOf[near] as number) !== own) {
        // Distance to the band-width iso-line: one Newton step along the gradient, then the rest
        // of the way from there (the coast field bends at concave shores).
        gradientBilinear(grid, ringField, wx, wy, grad);
        const g2 = grad.x * grad.x + grad.y * grad.y;
        if (g2 > 0) {
          const len = Math.sqrt(g2);
          const ux = grad.x / len;
          const uy = grad.y / len;
          const px = wx - (classValue * grad.x) / g2;
          const py = wy - (classValue * grad.y) / g2;
          const g1 = sampleBilinear(grid, ringField, px, py);
          const step0 = Math.abs(classValue) / len;
          let dw: number;
          if (g1 > 0 === classValue > 0) {
            // Short of the iso-line: add the rest from the Newton point.
            gradientBilinear(grid, ringField, px, py, grad);
            const len1 = Math.sqrt(grad.x * grad.x + grad.y * grad.y);
            dw = step0 + (len1 > 0 ? Math.abs(g1) / len1 : 0);
          } else {
            // Overshot: the iso-line lies between, where the secant crosses zero.
            dw = (step0 * Math.abs(classValue)) / (Math.abs(classValue) + Math.abs(g1));
          }
          const d = dw / pull(ux, uy);
          if (d < border) {
            border = d;
            secondary = biomeOf[near] as number;
          }
        }
      }
    }
    out.primary = own;
    out.region = best;
    out.borderDistance = border;
    if (border < out.halfWidth) {
      out.secondary = secondary;
      out.blend = 0.5 * (1 - (border > 0 ? border : 0) / out.halfWidth);
    } else {
      out.secondary = own;
      out.blend = 0;
    }
    return out;
  };
  return {
    plan,
    sample: (tx: number, ty: number, out: BiomeSample): BiomeSample => sampleAt(tx + 0.5, ty + 0.5, out),
    sampleAt,
  };
}
