/**
 * Carving of the underground (MASTERPROMPT §9.2 "zelluläre Automaten + Rauschtunnel + Kavernen";
 * docs/WORLD.md §2 "Höhlen per zellulärem Automaten mit Rand-Überlapp für nahtlose Chunkgrenzen").
 *
 * `carveRect` computes which tiles of any rectangle are open, as a pure function of the plan and the
 * tile coordinates, so neighbouring chunks agree on every shared border (tested by carving a 3 × 3
 * chunk block in one piece and chunk by chunk):
 *
 * 1. The primitives of the layer (`network.ts`) touching the rectangle plus its overlap are
 *    rasterized: inside a core radius the tile is skeleton (always open); around it lie the noisy
 *    soft outline and a rough band.
 * 2. Start state: skeleton open, inside the soft outline open with `insideOpenChance`, in the band
 *    with a chance falling to 0 (hash of the world tile), else rock.
 * 3. `caIterations` steps of the 4-5 cellular automaton round the band into alcoves and chambers;
 *    the skeleton stays open. Each step reads one ring of neighbours, so the overlap shrinks by one.
 * 4. Attachment: an extra open tile stays open only if a 4-connected open path of at most
 *    `attachMaxTiles` tiles leads to the skeleton; loose pockets become rock. Such a path never
 *    leaves the rectangle grown by `attachMaxTiles`, so the result is exact with the overlap
 *    `caIterations + attachMaxTiles`.
 *
 * Every open tile is therefore 4-connected to the skeleton, and the skeleton of a system contains
 * its access points: no cave is sealed off (tests/unit/world/hoehlen.test.ts).
 */
import { createSimplex2, type Noise2 } from '../../../engine/noise';
import { hash2, hashToUnit } from '../../../engine/rng';
import { CHUNK_SIZE } from '../../model/coords';
import { P_AX, P_AY, P_BAND, P_BX, P_BY, P_CORE, P_JITTER, P_KIND, P_NODE, P_SOFT, PRIM_DISC, PRIM_STRIDE, undergroundSeed, type UndergroundLayerPlan, type UndergroundPlan } from './network';
import { CARVE, type UndergroundLayer } from './params';

/** Open state of a rectangle of one layer. */
export interface CarvedRect {
  /** Top left tile. */
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** 1 = open (row major, `w × h`). */
  readonly open: Uint8Array;
  /** 1 = skeleton core (carved for sure). */
  readonly core: Uint8Array;
  /** Node whose chamber (soft radius + `specialMarginTiles`) covers the tile, −1 = none. */
  readonly node: Int32Array;
}

/** Border overlap of the carving [tiles]: automaton steps plus the attachment path length. */
export const CARVE_OVERLAP = CARVE.caIterations + CARVE.attachMaxTiles;
/** Marks an unreached tile in the attachment search. */
const UNREACHED = 0xff;
/** Rock neighbours of a tile outside the computed window (it counts as rock). */
const NEIGHBOURS = 8;

/** Per-layer noise of a plan (built once, reused for every chunk). */
interface LayerNoise {
  readonly shape: Noise2;
  readonly shapeDetail: Noise2;
  readonly alcove: Noise2;
  readonly caSalt: number;
}

const noiseCache = new WeakMap<UndergroundPlan, Map<UndergroundLayer, LayerNoise>>();

function layerNoise(plan: UndergroundPlan, layer: UndergroundLayer): LayerNoise {
  let perPlan = noiseCache.get(plan);
  if (perPlan === undefined) {
    perPlan = new Map();
    noiseCache.set(plan, perPlan);
  }
  let n = perPlan.get(layer);
  if (n === undefined) {
    n = {
      shape: createSimplex2(undergroundSeed(plan.seed, layer, 'umriss')),
      shapeDetail: createSimplex2(undergroundSeed(plan.seed, layer, 'umriss.fein')),
      alcove: createSimplex2(undergroundSeed(plan.seed, layer, 'nischen')),
      caSalt: undergroundSeed(plan.seed, layer, 'automat'),
    };
    perPlan.set(layer, n);
  }
  return n;
}

/** Primitive indices whose buckets touch the tile window (each index once, ascending). */
export function primsInWindow(lp: UndergroundLayerPlan, x0: number, y0: number, w: number, h: number): number[] {
  const c = lp.chunks;
  const cx0 = Math.max(0, Math.floor(x0 / CHUNK_SIZE));
  const cy0 = Math.max(0, Math.floor(y0 / CHUNK_SIZE));
  const cx1 = Math.min(c - 1, Math.floor((x0 + w - 1) / CHUNK_SIZE));
  const cy1 = Math.min(c - 1, Math.floor((y0 + h - 1) / CHUNK_SIZE));
  if (cx0 > cx1 || cy0 > cy1 || lp.primCount === 0) return [];
  const seen = new Uint8Array(lp.primCount);
  const out: number[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const b = cy * c + cx;
      for (let k = lp.bucketStart[b] as number; k < (lp.bucketStart[b + 1] as number); k++) {
        const i = lp.bucketItems[k] as number;
        if (seen[i] === 0) {
          seen[i] = 1;
          out.push(i);
        }
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** Distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/**
 * Carves the rectangle `x0, y0, w × h` (world tiles) of an underground layer. Pure: the same
 * tile gets the same result in every rectangle that contains it.
 */
export function carveRect(plan: UndergroundPlan, layer: UndergroundLayer, x0: number, y0: number, w: number, h: number): CarvedRect {
  const lp = plan.layers[-layer - 1] as UndergroundLayerPlan;
  const open = new Uint8Array(w * h);
  const coreOut = new Uint8Array(w * h);
  const nodeOut = new Int32Array(w * h).fill(-1);
  const m = CARVE_OVERLAP;
  const wx0 = x0 - m;
  const wy0 = y0 - m;
  const ww = w + 2 * m;
  const wh = h + 2 * m;
  const prims = primsInWindow(lp, wx0, wy0, ww, wh);
  if (prims.length === 0) return { x0, y0, w, h, open, core: coreOut, node: nodeOut };

  const noise = layerNoise(plan, layer);
  const n = ww * wh;
  const q = new Float64Array(n).fill(Infinity);
  const core = new Uint8Array(n);
  const node = new Int32Array(n).fill(-1);
  const nodeRel = new Float64Array(n).fill(Infinity);
  const shape = new Float64Array(n).fill(Number.NaN);
  const f = CARVE.shapeFrequency;
  const fd = CARVE.shapeDetailFrequency;
  const wd = CARVE.shapeDetailWeight;
  const data = lp.prims;
  for (const pi of prims) {
    const o = pi * PRIM_STRIDE;
    const disc = data[o + P_KIND] === PRIM_DISC;
    const ax = data[o + P_AX] as number;
    const ay = data[o + P_AY] as number;
    const bx = data[o + P_BX] as number;
    const by = data[o + P_BY] as number;
    const rCore = data[o + P_CORE] as number;
    const rSoft = data[o + P_SOFT] as number;
    const jitter = data[o + P_JITTER] as number;
    const band = data[o + P_BAND] as number;
    const nodeIndex = data[o + P_NODE] as number;
    const reach = rSoft + jitter + band;
    const nodeReach = rSoft + CARVE.specialMarginTiles;
    const tx0 = Math.max(wx0, Math.floor(Math.min(ax, bx) - reach));
    const ty0 = Math.max(wy0, Math.floor(Math.min(ay, by) - reach));
    const tx1 = Math.min(wx0 + ww - 1, Math.floor(Math.max(ax, bx) + reach));
    const ty1 = Math.min(wy0 + wh - 1, Math.floor(Math.max(ay, by) + reach));
    for (let ty = ty0; ty <= ty1; ty++) {
      const py = ty + 0.5;
      for (let tx = tx0; tx <= tx1; tx++) {
        const px = tx + 0.5;
        let d: number;
        if (disc) {
          const dx = px - ax;
          const dy = py - ay;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach) continue;
          d = Math.sqrt(d2);
        } else {
          d = segmentDistance(px, py, ax, ay, bx, by);
          if (d >= reach) continue;
        }
        const i = (ty - wy0) * ww + (tx - wx0);
        if (d < rCore) core[i] = 1;
        let s = shape[i] as number;
        if (Number.isNaN(s)) {
          s = (1 - wd) * noise.shape(tx * f, ty * f) + wd * noise.shapeDetail(tx * fd, ty * fd);
          shape[i] = s;
        }
        const qq = (d - (rSoft + jitter * s)) / band;
        if (qq < (q[i] as number)) q[i] = qq;
        if (nodeIndex >= 0 && d < nodeReach) {
          const rel = d / rSoft;
          if (rel < (nodeRel[i] as number) || (rel === nodeRel[i] && nodeIndex < (node[i] as number))) {
            nodeRel[i] = rel;
            node[i] = nodeIndex;
          }
        }
      }
    }
  }

  // Start state of the automaton.
  const fa = CARVE.alcoveFrequency;
  let state = new Uint8Array(n);
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      if (core[i] === 1) {
        state[i] = 1;
        continue;
      }
      const qq = q[i] as number;
      if (qq >= 1) continue;
      const u = hashToUnit(hash2(wx0 + x, wy0 + y, noise.caSalt));
      let chance = CARVE.insideOpenChance;
      if (qq >= 0) chance = CARVE.bandOpenChance * (1 + CARVE.alcoveGain * noise.alcove((wx0 + x) * fa, (wy0 + y) * fa));
      state[i] = u < chance ? 1 : 0;
    }
  }

  // Cellular automaton (4-5 rule); tiles outside the window count as rock.
  let next = new Uint8Array(n);
  for (let step = 0; step < CARVE.caIterations; step++) {
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const i = y * ww + x;
        if (core[i] === 1) {
          next[i] = 1;
          continue;
        }
        let openN = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= wh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if ((dx === 0 && dy === 0) || xx < 0 || xx >= ww) continue;
            openN += state[yy * ww + xx] as number;
          }
        }
        const rock = NEIGHBOURS - openN;
        next[i] = rock >= CARVE.closeAtRockNeighbours ? 0 : rock <= CARVE.openAtRockNeighbours ? 1 : (state[i] as number);
      }
    }
    const t = state;
    state = next;
    next = t;
  }

  // Attachment: breadth-first search from the skeleton inside the exact region, up to attachMaxTiles.
  const k = CARVE.caIterations;
  const L = CARVE.attachMaxTiles;
  const dist = new Uint8Array(n).fill(UNREACHED);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let y = k; y < wh - k; y++) {
    for (let x = k; x < ww - k; x++) {
      const i = y * ww + x;
      if (core[i] === 1) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++] as number;
    const d = (dist[i] as number) + 1;
    if (d > L) continue;
    const x = i % ww;
    const y = (i - x) / ww;
    if (x > k && state[i - 1] === 1 && dist[i - 1] === UNREACHED) {
      dist[i - 1] = d;
      queue[tail++] = i - 1;
    }
    if (x < ww - k - 1 && state[i + 1] === 1 && dist[i + 1] === UNREACHED) {
      dist[i + 1] = d;
      queue[tail++] = i + 1;
    }
    if (y > k && state[i - ww] === 1 && dist[i - ww] === UNREACHED) {
      dist[i - ww] = d;
      queue[tail++] = i - ww;
    }
    if (y < wh - k - 1 && state[i + ww] === 1 && dist[i + ww] === UNREACHED) {
      dist[i + ww] = d;
      queue[tail++] = i + ww;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + m) * ww + (x + m);
      const j = y * w + x;
      coreOut[j] = core[i] as number;
      open[j] = core[i] === 1 || (state[i] === 1 && (dist[i] as number) <= L) ? 1 : 0;
      nodeOut[j] = node[i] as number;
    }
  }
  return { x0, y0, w, h, open, core: coreOut, node: nodeOut };
}
