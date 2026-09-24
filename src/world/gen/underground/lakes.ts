/**
 * Underground lakes and lava lakes (MASTERPROMPT §9.2 "unterirdische Seen und Lavaseen", §9.3
 * "Grundwasserseen", "Lavakammern").
 *
 * A lake lies in the core of its cavern and keeps `LAKES.ringTiles` of dry floor to the core's edge,
 * so the way around it never needs swimming and tunnels ending in the cavern stay joined. Its outline
 * is star-shaped around the cavern centre (the radius varies with the direction only), with a
 * shallow rim and a deep middle. Each lake is rasterized as a whole (pure function of the node), and
 * two clean-up floods remove raster artefacts: dry specks enclosed by the lake become shallow water,
 * and shallow water not reachable on foot from the shore becomes deep. A lava lake uses the same
 * outline; its shore is the cooled rim.
 */
import { createSimplex2, type Noise2 } from '../../../engine/noise';
import { undergroundSeed, type CaveNode, type UndergroundPlan } from './network';
import { LAKES, type UndergroundLayer } from './params';

/** Tile of a lake raster. */
export const LAKE_DRY = 0;
export const LAKE_SHALLOW = 1;
export const LAKE_DEEP = 2;
/** Dry tile next to the lake (shore or cooled rim). */
export const LAKE_RIM = 3;

/** Rasterized lake of one node. */
export interface LakeRaster {
  /** Top left tile of the raster. */
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** `LAKE_DRY`, `LAKE_SHALLOW`, `LAKE_DEEP` or `LAKE_RIM` per tile. */
  readonly cells: Uint8Array;
  readonly lava: boolean;
}

/** Dry tiles around the lake inside its raster [tiles]: room for the rim and the outside flood. */
const RASTER_BORDER = 2;

const lakeCache = new WeakMap<UndergroundPlan, Map<string, LakeRaster>>();
const noiseCache = new WeakMap<UndergroundPlan, Map<UndergroundLayer, Noise2>>();

function lakeNoise(plan: UndergroundPlan, layer: UndergroundLayer): Noise2 {
  let m = noiseCache.get(plan);
  if (m === undefined) {
    m = new Map();
    noiseCache.set(plan, m);
  }
  let n = m.get(layer);
  if (n === undefined) {
    n = createSimplex2(undergroundSeed(plan.seed, layer, 'seeufer'));
    m.set(layer, n);
  }
  return n;
}

/** Radius of the lake of a cavern (outline maximum) [tiles]. */
export function lakeRadius(node: CaveNode): number {
  return node.coreRadius - LAKES.ringTiles;
}

/** Flood fill over cells matching `pass`, from the seeds in `mark` (1); marks reached cells with 1. */
function flood(cells: Uint8Array, w: number, h: number, mark: Uint8Array, pass: (c: number) => boolean): void {
  const queue: number[] = [];
  for (let i = 0; i < mark.length; i++) if (mark[i] === 1) queue.push(i);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % w;
    const y = (i - x) / w;
    const visit = (j: number): void => {
      if (mark[j] === 0 && pass(cells[j] as number)) {
        mark[j] = 1;
        queue.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
}

function rasterize(plan: UndergroundPlan, layer: UndergroundLayer, node: CaveNode): LakeRaster {
  const noise = lakeNoise(plan, layer);
  const rMax = lakeRadius(node);
  const amp = LAKES.outlineAmplitude * rMax;
  const base = rMax - amp;
  const x0 = Math.floor(node.x - rMax) - RASTER_BORDER;
  const y0 = Math.floor(node.y - rMax) - RASTER_BORDER;
  const w = Math.floor(node.x + rMax) + RASTER_BORDER + 1 - x0;
  const h = Math.floor(node.y + rMax) + RASTER_BORDER + 1 - y0;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x0 + x + 0.5 - node.x;
      const dy = y0 + y + 0.5 - node.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Star-shaped: the outline radius depends on the direction only (noise sampled on a circle).
      const r = d > 0 ? base + amp * noise(node.x + (dx / d) * LAKES.outlineScale, node.y + (dy / d) * LAKES.outlineScale) : base;
      const radius = Math.max(LAKES.minRadius, r);
      cells[y * w + x] = d < radius - LAKES.shallowWidth ? LAKE_DEEP : d < radius ? LAKE_SHALLOW : LAKE_DRY;
    }
  }
  // Dry specks enclosed by water become shallow water.
  const outside = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    outside[x] = 1;
    outside[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    outside[y * w] = 1;
    outside[y * w + w - 1] = 1;
  }
  flood(cells, w, h, outside, (c) => c === LAKE_DRY);
  for (let i = 0; i < cells.length; i++) if (cells[i] === LAKE_DRY && outside[i] === 0) cells[i] = LAKE_SHALLOW;
  // Shallow water that cannot be waded into from the shore becomes deep.
  const wade = outside.slice();
  flood(cells, w, h, wade, (c) => c === LAKE_SHALLOW);
  for (let i = 0; i < cells.length; i++) if (cells[i] === LAKE_SHALLOW && wade[i] === 0) cells[i] = LAKE_DEEP;
  // Rim: dry tiles touching the lake (8-neighbourhood).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] !== LAKE_DRY) continue;
      let wet = false;
      for (let dy = -1; dy <= 1 && !wet; dy++) {
        for (let dx = -1; dx <= 1 && !wet; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            const c = cells[yy * w + xx] as number;
            wet = c === LAKE_SHALLOW || c === LAKE_DEEP;
          }
        }
      }
      if (wet) cells[y * w + x] = LAKE_RIM;
    }
  }
  return { x0, y0, w, h, cells, lava: node.feature === 'lavasee' };
}

/** The lake raster of a lake cavern (cached per plan). */
export function lakeRaster(plan: UndergroundPlan, layer: UndergroundLayer, nodeIndex: number): LakeRaster {
  let m = lakeCache.get(plan);
  if (m === undefined) {
    m = new Map();
    lakeCache.set(plan, m);
  }
  const key = `${layer}:${nodeIndex}`;
  let r = m.get(key);
  if (r === undefined) {
    const node = plan.layers[-layer - 1]?.nodes[nodeIndex];
    if (node === undefined || (node.feature !== 'see' && node.feature !== 'lavasee')) throw new RangeError(`Underground layer ${layer}: node ${nodeIndex} holds no lake`);
    r = rasterize(plan, layer, node);
    m.set(key, r);
  }
  return r;
}
