/**
 * World plan step 1 (M2-04, MASTERPROMPT §9.2.1): the island mask on the plan raster.
 *
 * A domain-warped, slightly oval radial falloff plus coast noise gives one main island; 2–3 bays
 * are carved into and 1–2 peninsulas pushed out of random, spread-apart coast cells (elongated,
 * frayed bumps), so every island has them. A hard sea margin keeps the world edge unreachable.
 * Enclosed sea becomes land (inland water comes from the hydrology step), specks below
 * `ISLAND.minIsletCells` vanish, and missing offshore islets are added as noisy blobs in the coastal
 * sea until `ISLAND.minIslets` is reached.
 */
import type { WorldSizePreset } from '../../../content/balance';
import { fbm } from '../../../engine/noise';
import { planNoise, planRng } from './fields';
import { labelComponents, planGrid, squaredDistanceTransform, type PlanGrid } from './grid';
import { ISLAND } from './params';

/** Landmass id of the main island. */
export const MAIN_LANDMASS = 0;
/** Landmass id of sea cells. */
export const NO_LANDMASS = -1;

/** The island mask of one plan attempt. */
export interface IslandMask {
  readonly grid: PlanGrid;
  /** 1 = land, 0 = sea, per cell. */
  readonly land: Uint8Array;
  /** Landmass per cell: 0 = main island, 1… = islets by decreasing size, −1 = sea. */
  readonly landmass: Int16Array;
  /** Cells per landmass (index = landmass id). */
  readonly landmassSizes: readonly number[];
  /** Islets added because the noise produced too few. */
  readonly addedIslets: number;
}

/** Decorrelation offsets of the two warp axes [noise units]. */
const WARP_OFFSET_A = 17.3;
const WARP_OFFSET_B = 41.9;
/** Spacing of the warp lattice [cells]. The warp changes over ≈ 60 cells; 4-cell sampling is exact to the eye. */
const WARP_LATTICE_CELLS = 4;
/** Rotation vectors shorter than this are redrawn (their direction is numerically unreliable). */
const MIN_ROTATION_LENGTH_SQ = 0.01;

/** Relabels land components: largest first (main island), ties by first cell. */
function relabelLandmasses(grid: PlanGrid, land: Uint8Array): { landmass: Int16Array; sizes: number[] } {
  const comps = labelComponents(grid, (c) => land[c] === 1);
  const order = comps.sizes.map((size, id) => ({ size, id }));
  order.sort((a, b) => b.size - a.size || a.id - b.id);
  const remap = new Int32Array(order.length);
  order.forEach((o, rank) => {
    remap[o.id] = rank;
  });
  const landmass = new Int16Array(grid.count).fill(NO_LANDMASS);
  for (let c = 0; c < grid.count; c++) {
    const id = comps.label[c] as number;
    if (id >= 0) landmass[c] = remap[id] as number;
  }
  return { landmass, sizes: order.map((o) => o.size) };
}

/** Enclosed sea becomes land: the only sea is the ocean around the island (lakes come from the hydrology). */
function fillInlandSea(grid: PlanGrid, land: Uint8Array): void {
  const sea = labelComponents(grid, (c) => land[c] === 0);
  const ocean = sea.label[0] as number;
  for (let c = 0; c < grid.count; c++) if (land[c] === 0 && sea.label[c] !== ocean) land[c] = 1;
}

/** Generates the island mask of a world seed and plan attempt. */
export function generateIsland(worldSeed: number, attempt: number, preset: WorldSizePreset): IslandMask {
  const grid = planGrid(preset);
  const { width: w, height: h, cellTiles } = grid;
  const rng = planRng(worldSeed, attempt, 'island');
  const warp = planNoise(worldSeed, attempt, 'island.warp');
  const coast = planNoise(worldSeed, attempt, 'island.coast');
  const isletNoise = planNoise(worldSeed, attempt, 'island.islets');

  const radius = rng.float(ISLAND.radiusMin, ISLAND.radiusMax);
  const radius2 = radius * radius;
  const centerX = 0.5 + rng.float(-ISLAND.centerJitter, ISLAND.centerJitter);
  const centerY = 0.5 + rng.float(-ISLAND.centerJitter, ISLAND.centerJitter);
  const aspect = rng.float(ISLAND.aspectMin, ISLAND.aspectMax);
  let rotX = 0;
  let rotY = 0;
  let len2 = 0;
  while (len2 < MIN_ROTATION_LENGTH_SQ || len2 > 1) {
    rotX = rng.float(-1, 1);
    rotY = rng.float(-1, 1);
    len2 = rotX * rotX + rotY * rotY;
  }
  const rotLen = Math.sqrt(len2);
  rotX /= rotLen;
  rotY /= rotLen;

  const warpOpts = { octaves: ISLAND.warpOctaves, frequency: ISLAND.warpFrequency };
  const coastOpts = { octaves: ISLAND.noiseOctaves, frequency: ISLAND.noiseFrequency };
  const marginCells = ISLAND.edgeMarginTiles / cellTiles;
  // The warp is smooth (≈ 2 cycles per world edge): sample it on a coarse lattice and interpolate.
  const lw = Math.ceil(w / WARP_LATTICE_CELLS) + 1;
  const lh = Math.ceil(h / WARP_LATTICE_CELLS) + 1;
  const warpU = new Float64Array(lw * lh);
  const warpV = new Float64Array(lw * lh);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const u = (i * WARP_LATTICE_CELLS) / w;
      const v = (j * WARP_LATTICE_CELLS) / h;
      warpU[j * lw + i] = ISLAND.warpAmplitude * fbm(warp, u + WARP_OFFSET_A, v - WARP_OFFSET_B, warpOpts);
      warpV[j * lw + i] = ISLAND.warpAmplitude * fbm(warp, u - WARP_OFFSET_B, v + WARP_OFFSET_A, warpOpts);
    }
  }
  const lattice = (field: Float64Array, x: number, y: number): number => {
    const gx = x / WARP_LATTICE_CELLS;
    const gy = y / WARP_LATTICE_CELLS;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const k = j * lw + i;
    const top = (field[k] as number) + ((field[k + 1] as number) - (field[k] as number)) * fx;
    const bottom = (field[k + lw] as number) + ((field[k + lw + 1] as number) - (field[k + lw] as number)) * fx;
    return top + (bottom - top) * fy;
  };
  const field = new Float64Array(grid.count).fill(-1);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const edgeCells = Math.min(x + 0.5, w - x - 0.5, y + 0.5, h - y - 0.5);
      if (edgeCells < marginCells) continue;
      const u = (x + 0.5) / w;
      const pu = u + lattice(warpU, x + 0.5, y + 0.5) - centerX;
      const pv = v + lattice(warpV, x + 0.5, y + 0.5) - centerY;
      const ru = (pu * rotX + pv * rotY) / aspect;
      const rv = (pv * rotX - pu * rotY) * aspect;
      let f = 1 - (ru * ru + rv * rv) / radius2 + ISLAND.noiseAmplitude * fbm(coast, u, v, coastOpts);
      const edge = Math.min(u, 1 - u, v, 1 - v);
      if (edge < ISLAND.edgeSoftFraction) f -= ISLAND.edgeSoftStrength * (1 - edge / ISLAND.edgeSoftFraction);
      field[c] = f;
    }
  }

  // Bays carved into and peninsulas pushed out of the coast: bumps centred on random coast cells
  // (spread apart), so every island gets them even where the noise left a round shore.
  const coastCells: number[] = [];
  for (let c = 0; c < grid.count; c++) {
    if (!((field[c] as number) > 0)) continue;
    const x = c % w;
    const y = Math.floor(c / w);
    if ((x > 0 && !((field[c - 1] as number) > 0)) || (x < w - 1 && !((field[c + 1] as number) > 0)) || (y > 0 && !((field[c - w] as number) > 0)) || (y < h - 1 && !((field[c + w] as number) > 0))) coastCells.push(c);
  }
  const features: number[] = [];
  const spacing2 = ISLAND.featureSpacing * ISLAND.featureSpacing * w * w;
  const bump = (count: number, rMin: number, rMax: number, strength: number, push: number): void => {
    for (let i = 0, tries = 0; i < count && tries < ISLAND.featureAttempts && coastCells.length > 0; tries++) {
      const c = coastCells[rng.int(0, coastCells.length)] as number;
      const cx = c % w;
      const cy = Math.floor(c / w);
      if (features.some((f) => ((f % w) - cx) * ((f % w) - cx) + (Math.floor(f / w) - cy) * (Math.floor(f / w) - cy) < spacing2)) continue;
      features.push(c);
      i++;
      const r = rng.float(rMin, rMax) * w;
      // Outward direction: away from the island centre.
      let ox = (cx + 0.5) / w - centerX;
      let oy = (cy + 0.5) / h - centerY;
      const ol = Math.sqrt(ox * ox + oy * oy);
      ox = ol > 0 ? ox / ol : 0;
      oy = ol > 0 ? oy / ol : 0;
      const bx = cx + 0.5 + ox * r * push;
      const by = cy + 0.5 + oy * r * push;
      const reach = Math.ceil(r);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = Math.floor(bx) + dx;
          const y = Math.floor(by) + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          // Elongated along the outward axis, frayed by noise: bays read as inlets, not bites.
          const px = x + 0.5 - bx;
          const py = y + 0.5 - by;
          const along = (px * ox + py * oy) / ISLAND.featureElongation;
          const across = (px * oy - py * ox) * ISLAND.featureElongation;
          const fray = 1 + ISLAND.isletRadiusNoise * isletNoise(x * ISLAND.isletNoiseFrequency, y * ISLAND.isletNoiseFrequency);
          const q = (along * along + across * across) / (r * r * fray * fray);
          if (q >= 1) continue;
          const k = y * w + x;
          const edgeCells = Math.min(x + 0.5, w - x - 0.5, y + 0.5, h - y - 0.5);
          if (edgeCells < marginCells) continue;
          field[k] = (field[k] as number) + strength * (1 - q) * (1 - q);
        }
      }
    }
  };
  bump(rng.int(ISLAND.baysMin, ISLAND.baysMax + 1), ISLAND.bayRadiusMin, ISLAND.bayRadiusMax, -ISLAND.bayStrength, ISLAND.bayPush);
  bump(rng.int(ISLAND.peninsulasMin, ISLAND.peninsulasMax + 1), ISLAND.peninsulaRadiusMin, ISLAND.peninsulaRadiusMax, ISLAND.peninsulaStrength, ISLAND.peninsulaPush);
  const land = new Uint8Array(grid.count);
  for (let c = 0; c < grid.count; c++) if ((field[c] as number) > 0) land[c] = 1;

  fillInlandSea(grid, land);

  // Specks too small for a camp vanish.
  const specks = labelComponents(grid, (c) => land[c] === 1);
  for (let c = 0; c < grid.count; c++) {
    const id = specks.label[c] as number;
    if (id >= 0 && (specks.sizes[id] as number) < ISLAND.minIsletCells) land[c] = 0;
  }

  let { landmass, sizes } = relabelLandmasses(grid, land);
  if (sizes.length === 0) throw new RangeError('generateIsland: the island mask is empty');

  // Offshore islets (§9.2.1 "vorgelagerte Inseln"): noisy discs in the coastal sea, kept apart
  // from all other land by `isletGapTiles`; only the largest piece of a stamp survives.
  const minIslets = ISLAND.minIslets[preset];
  let islets = sizes.length - 1;
  let added = 0;
  const cellTiles2 = cellTiles * cellTiles;
  const gapCells2 = (ISLAND.isletGapTiles * ISLAND.isletGapTiles) / cellTiles2;
  const toLand = squaredDistanceTransform(grid, (c) => land[c] === 1);
  const toMain = squaredDistanceTransform(grid, (c) => landmass[c] === MAIN_LANDMASS);
  const placed: number[] = [];
  const inStamp = new Uint8Array(grid.count);
  for (let attemptNo = 0; islets < minIslets && attemptNo < ISLAND.isletAttempts * minIslets; attemptNo++) {
    const r = rng.float(ISLAND.isletRadiusMinCells, ISLAND.isletRadiusMaxCells);
    const rTiles = r * cellTiles;
    const center = rng.int(0, grid.count);
    const ccx = center % w;
    const ccy = Math.floor(center / w);
    const edgeCells = Math.min(ccx + 0.5, w - ccx - 0.5, ccy + 0.5, h - ccy - 0.5);
    if (edgeCells < marginCells + r + 1) continue;
    const mainDist = Math.sqrt(toMain[center] as number) * cellTiles;
    if (mainDist < ISLAND.isletOffshoreMinTiles + rTiles || mainDist > ISLAND.isletOffshoreMaxTiles + rTiles) continue;
    if (Math.sqrt(toLand[center] as number) * cellTiles < ISLAND.isletGapTiles + rTiles) continue;
    const stamp: number[] = [];
    const reach = Math.ceil(r * (1 + ISLAND.isletRadiusNoise));
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = ccx + dx;
        const y = ccy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const c = y * w + x;
        const limit = r * (1 + ISLAND.isletRadiusNoise * isletNoise(x * ISLAND.isletNoiseFrequency, y * ISLAND.isletNoiseFrequency));
        if (dx * dx + dy * dy > limit * limit || (toLand[c] as number) < gapCells2) continue;
        let clear = true;
        for (let i = 0; i < placed.length && clear; i++) {
          const p = placed[i] as number;
          const px = (p % w) - x;
          const py = Math.floor(p / w) - y;
          clear = px * px + py * py >= gapCells2;
        }
        if (clear) stamp.push(c);
      }
    }
    // Largest 4-connected piece of the stamp.
    for (const c of stamp) inStamp[c] = 1;
    let best: number[] = [];
    const seen = new Set<number>();
    for (const c of stamp) {
      if (seen.has(c)) continue;
      const piece = [c];
      seen.add(c);
      for (let i = 0; i < piece.length; i++) {
        const q = piece[i] as number;
        const qx = q % w;
        const qy = Math.floor(q / w);
        const next = [qx + 1 < w ? q + 1 : -1, qx > 0 ? q - 1 : -1, qy + 1 < h ? q + w : -1, qy > 0 ? q - w : -1];
        for (const nb of next) {
          if (nb < 0 || inStamp[nb] === 0 || seen.has(nb)) continue;
          seen.add(nb);
          piece.push(nb);
        }
      }
      if (piece.length > best.length) best = piece;
    }
    for (const c of stamp) inStamp[c] = 0;
    if (best.length < ISLAND.minIsletCells) continue;
    for (const c of best) {
      land[c] = 1;
      placed.push(c);
    }
    islets++;
    added++;
  }
  fillInlandSea(grid, land);
  ({ landmass, sizes } = relabelLandmasses(grid, land));
  return { grid, land, landmass, landmassSizes: sizes, addedIslets: added };
}
