/**
 * Cave network of the underground layers (MASTERPROMPT §9.1 "Zugang über natürliche Höhleneingänge",
 * §9.2 "Untergrund: … Rauschtunnel + Kavernen …"; docs/WORLD.md §2).
 *
 * Built once per world from (seed, world size, surface entrance candidates, optional land extent),
 * small and structured-cloneable like the world plan, so a worker can rebuild or receive it. The
 * chunk generator (`chunk.ts`) rasterizes it; this module decides the topology:
 *
 * 1. **Entrances** (`selectCaveEntrances`): the surface plan proposes candidate tiles; valid ones
 *    (inside the world margin and the extent) are taken in a seed-hashed order with a minimum
 *    spacing and a cap per world size. The result does not depend on the order of the candidates.
 * 2. **Access points** of a layer: the entrances for −1, the shafts of the layer above for −2/−3.
 * 3. **Caverns**: Poisson-disc points in the extent. Each belongs to the cave system of its nearest
 *    access point (farther than `reachTiles` ⇒ dropped: solid rock); neighbouring access points
 *    sometimes share one system. So every system is built around at least one access point.
 * 4. **Tunnels**: per system a minimum spanning tree over its access points and caverns plus a few
 *    loop tunnels, each a meandering polyline (midpoint displacement). Side passages ("Rauschtunnel")
 *    wander from caverns in 22,5° steps and may end in a small chamber.
 * 5. **Features**: shafts down (spread by farthest-point sampling), place slots, water or lava
 *    lakes and the layer's special caverns (Pilzhain, Kristallgrotte, Obsidianhalle).
 *
 * Every carved piece is a disc or capsule primitive with a core radius (always open) and a soft
 * radius with noise and a rough band (worked by the cellular automaton). Cores of connected pieces
 * overlap by construction, so every system's core is one connected region that contains its access
 * points. Primitives are bucketed per chunk for the rasterizer.
 *
 * Determinism: only + − × ÷, `Math.sqrt`, `Math.floor` and seeded `Rng` streams (one per step and
 * layer); no trigonometry (docs/ARCHITEKTUR.md "Sampling und Kalender").
 */
import type { WorldSizePreset } from '../../../content/balance';
import { Fnv1a64 } from '../../../engine/binary';
import { Rng, hash2, hashCombine, hashString, normalizeSeed } from '../../../engine/rng';
import { CHUNK_SIZE } from '../../model/coords';
import { worldDimensions } from '../../model/worldSize';
import { poissonDisc } from '../sampling';
import { AREA, LINKS, LLOYD_ITERATIONS, SHAPES, UNDERGROUND_LAYERS, UNDERGROUND_VERSION, layerParams, type CaveSpecial, type LayerParams, type UndergroundLayer, type UpperLayer } from './params';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** A tile position (integer world tile coordinates). */
export interface TilePoint {
  readonly tx: number;
  readonly ty: number;
}

/**
 * Coarse land mask of the surface (e.g. the world plan's `grid` + `land`): caverns only lie under
 * cells with mask 1 (grown by `AREA.extentDilationCells`).
 */
export interface UndergroundExtent {
  /** Edge length of one mask cell [tiles]. */
  readonly cellTiles: number;
  /** Cells per row. */
  readonly width: number;
  /** Cells per column. */
  readonly height: number;
  /** 1 = land, row major. */
  readonly mask: Uint8Array;
}

/** Input of the underground generator. */
export interface UndergroundInput {
  /** World seed (any safe integer). */
  readonly seed: number;
  readonly preset: WorldSizePreset;
  /** Candidate surface tiles for natural cave entrances (e.g. from the world plan). */
  readonly entranceCandidates: readonly TilePoint[];
  /** Optional land extent; without it caverns may lie anywhere inside the world margin. */
  readonly extent?: UndergroundExtent;
}

/** Role of a network node. */
export type NodeRole = 'zugang' | 'kaverne';
/**
 * Feature of a node: `aufstieg` (chamber under an entrance or at the foot of a shaft), `abstieg`
 * (shaft down in its centre), `ort` (place slot), `see`/`lavasee` (lake in its core), a special
 * cavern kind, or `keine`.
 */
export type NodeFeature = 'keine' | 'aufstieg' | 'abstieg' | 'ort' | 'see' | 'lavasee' | CaveSpecial;

/** A chamber of the network (access chamber or cavern). */
export interface CaveNode {
  /** Centre [tiles, continuous]. */
  readonly x: number;
  readonly y: number;
  /** Radius of the always-open core [tiles]. */
  readonly coreRadius: number;
  /** Radius of the noisy soft outline [tiles]. */
  readonly softRadius: number;
  readonly role: NodeRole;
  readonly feature: NodeFeature;
  /** Cave system id within the layer. */
  readonly system: number;
  /** Link id of an access chamber or shaft cavern, −1 otherwise. */
  readonly link: number;
}

/** A tunnel or side passage (for debug views and statistics; the rasterizer uses the primitives). */
export interface CaveTunnel {
  readonly system: number;
  /** `gang`: between two nodes; `seitengang`: dead-end side passage from a cavern. */
  readonly kind: 'gang' | 'seitengang';
  readonly from: number;
  /** Target node, −1 for side passages. */
  readonly to: number;
  readonly coreRadius: number;
  /** Polyline x0, y0, x1, y1, … [tiles]. */
  readonly points: readonly number[];
}

/** A connected cave system of one layer. */
export interface CaveSystem {
  readonly id: number;
  /** Links through which the system is entered from above (≥ 1). */
  readonly links: readonly number[];
  /** Node indices of the system. */
  readonly nodes: readonly number[];
}

/** A natural passage between two layers. */
export interface CaveLink {
  readonly id: number;
  /** `eingang`: surface → −1; `schacht`: −1 → −2 or −2 → −3. */
  readonly kind: 'eingang' | 'schacht';
  readonly upper: UpperLayer;
  readonly lower: UndergroundLayer;
  /** The link tile (same in both layers). */
  readonly tx: number;
  readonly ty: number;
  /** System in the upper layer (−1 for the surface). */
  readonly upperSystem: number;
  /** System in the lower layer. */
  readonly lowerSystem: number;
}

/** A place slot in a cavern (§21 "Höhlenorte"; filled by the place generator). */
export interface CaveSlot {
  readonly layer: UndergroundLayer;
  /** Centre tile. */
  readonly tx: number;
  readonly ty: number;
  /** Radius of the reserved, flagged area [tiles]. */
  readonly radius: number;
  readonly system: number;
  /** Node index in the layer. */
  readonly node: number;
}

/** Primitive layout in `UndergroundLayerPlan.prims` (Float64 per field). */
export const PRIM_STRIDE = 10;
export const P_KIND = 0;
export const P_AX = 1;
export const P_AY = 2;
export const P_BX = 3;
export const P_BY = 4;
export const P_CORE = 5;
export const P_SOFT = 6;
export const P_JITTER = 7;
export const P_BAND = 8;
export const P_NODE = 9;
/** Primitive kinds. */
export const PRIM_DISC = 0;
export const PRIM_CAPSULE = 1;

/** The network of one layer. */
export interface UndergroundLayerPlan {
  readonly layer: UndergroundLayer;
  readonly nodes: readonly CaveNode[];
  readonly tunnels: readonly CaveTunnel[];
  readonly systems: readonly CaveSystem[];
  /** Carving primitives, `PRIM_STRIDE` numbers each. */
  readonly prims: Float64Array;
  readonly primCount: number;
  /** Chunks per world edge (bucket grid). */
  readonly chunks: number;
  /** Bucket of chunk (cx, cy) = `bucketItems[bucketStart[cy × chunks + cx] … bucketStart[… + 1])`. */
  readonly bucketStart: Int32Array;
  readonly bucketItems: Int32Array;
}

/** The underground of a world. */
export interface UndergroundPlan {
  readonly version: number;
  /** World seed (u32). */
  readonly seed: number;
  readonly preset: WorldSizePreset;
  /** World edge [tiles]. */
  readonly tiles: number;
  /** All links: entrances first (ids 0 … n − 1), then the shafts top down. */
  readonly links: readonly CaveLink[];
  readonly slots: readonly CaveSlot[];
  /** Layers −1, −2, −3 (index = −layer − 1). */
  readonly layers: readonly UndergroundLayerPlan[];
}

// ---------------------------------------------------------------------------------------------
// Seeds, directions, area
// ---------------------------------------------------------------------------------------------

/** Seed of a named underground stream (per layer; 0 for world-wide streams). */
export function undergroundSeed(worldSeed: number, layer: UndergroundLayer | 0, name: string): number {
  return hashCombine(hashCombine(normalizeSeed(worldSeed), Math.abs(layer)), hashString(`untergrund.${name}`));
}

function layerRng(seed: number, layer: UndergroundLayer, name: string): Rng {
  return new Rng(undergroundSeed(seed, layer, name));
}

/** Integer direction 12 : 5 ≈ 22,6° (tan 22,5° ≈ 0,414, 5/12 ≈ 0,417). */
const DIR_LONG = 12;
const DIR_SHORT = 5;
/**
 * 16 compass directions (22,5° apart) as unit vectors, from integer vectors normalized with
 * `Math.sqrt` (exactly rounded, so identical on every engine).
 */
const DIRECTION_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [DIR_LONG, DIR_SHORT], [1, 1], [DIR_SHORT, DIR_LONG],
  [0, 1], [-DIR_SHORT, DIR_LONG], [-1, 1], [-DIR_LONG, DIR_SHORT],
  [-1, 0], [-DIR_LONG, -DIR_SHORT], [-1, -1], [-DIR_SHORT, -DIR_LONG],
  [0, -1], [DIR_SHORT, -DIR_LONG], [1, -1], [DIR_LONG, -DIR_SHORT],
];
/** Numbers per polyline point (x, y). */
const POINT_STRIDE = 2;
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = DIRECTION_VECTORS.map(([x, y]) => {
  const len = Math.sqrt(x * x + y * y);
  return [x / len, y / len] as const;
});
const DIRECTION_COUNT = DIRECTIONS.length;

/** Whether a tile position may hold caverns. */
type AreaTest = (x: number, y: number) => boolean;

function validateExtent(extent: UndergroundExtent): void {
  if (!Number.isInteger(extent.cellTiles) || extent.cellTiles < 1) throw new RangeError(`Underground extent: cellTiles must be a positive integer, got ${String(extent.cellTiles)}`);
  if (!Number.isInteger(extent.width) || !Number.isInteger(extent.height) || extent.width < 1 || extent.height < 1) throw new RangeError('Underground extent: width and height must be positive integers');
  if (extent.mask.length !== extent.width * extent.height) throw new RangeError(`Underground extent: mask has ${extent.mask.length} cells, expected ${extent.width * extent.height}`);
}

/** Area test of a world: inside the edge margin and (with an extent) under grown land. */
function createArea(tiles: number, extent: UndergroundExtent | undefined): AreaTest {
  const margin = AREA.edgeMarginTiles;
  const inBounds = (x: number, y: number): boolean => x >= margin && y >= margin && x < tiles - margin && y < tiles - margin;
  if (extent === undefined) return inBounds;
  validateExtent(extent);
  const { width, height, cellTiles, mask } = extent;
  const grow = AREA.extentDilationCells;
  const grown = new Uint8Array(width * height);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      if (mask[cy * width + cx] === 0) continue;
      for (let y = Math.max(0, cy - grow); y <= Math.min(height - 1, cy + grow); y++) {
        for (let x = Math.max(0, cx - grow); x <= Math.min(width - 1, cx + grow); x++) grown[y * width + x] = 1;
      }
    }
  }
  return (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    const cx = Math.floor(x / cellTiles);
    const cy = Math.floor(y / cellTiles);
    return cx >= 0 && cy >= 0 && cx < width && cy < height && grown[cy * width + cx] === 1;
  };
}

// ---------------------------------------------------------------------------------------------
// Entrances
// ---------------------------------------------------------------------------------------------

function comparePoints(a: TilePoint, b: TilePoint): number {
  return a.ty - b.ty || a.tx - b.tx;
}

/**
 * Natural cave entrances from surface candidates: candidates inside the world margin (and extent)
 * in a seed-hashed order, each at least `LINKS.entranceMinSpacingTiles` from the ones taken before,
 * at most `LINKS.entranceMaxCount[preset]`. Returned sorted by row, then column. Independent of the
 * candidate order and of duplicates. Throws `RangeError` on non-integer candidates.
 */
export function selectCaveEntrances(seed: number, preset: WorldSizePreset, candidates: readonly TilePoint[], extent?: UndergroundExtent): TilePoint[] {
  const tiles = worldDimensions(preset).tiles;
  const area = createArea(tiles, extent);
  const salt = undergroundSeed(seed, 0, 'eingaenge');
  const seen = new Set<number>();
  const valid: { p: TilePoint; key: number }[] = [];
  for (const c of candidates) {
    if (!Number.isSafeInteger(c.tx) || !Number.isSafeInteger(c.ty)) throw new RangeError(`Cave entrance candidate must be an integer tile, got ${String(c.tx)}, ${String(c.ty)}`);
    if (!area(c.tx + 0.5, c.ty + 0.5)) continue;
    const id = c.ty * tiles + c.tx;
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push({ p: { tx: c.tx, ty: c.ty }, key: hash2(c.tx, c.ty, salt) });
  }
  valid.sort((a, b) => a.key - b.key || comparePoints(a.p, b.p));
  const spacing2 = LINKS.entranceMinSpacingTiles * LINKS.entranceMinSpacingTiles;
  const max = LINKS.entranceMaxCount[preset];
  const taken: TilePoint[] = [];
  for (const { p } of valid) {
    if (taken.length >= max) break;
    if (taken.every((q) => (q.tx - p.tx) * (q.tx - p.tx) + (q.ty - p.ty) * (q.ty - p.ty) >= spacing2)) taken.push(p);
  }
  return taken.sort(comparePoints);
}

/**
 * A spread-out default set of entrance candidates (Poisson disc, `LINKS.candidateSpacingTiles`)
 * inside the world margin and extent. The surface plan may filter them by its own rules (hills,
 * cliffs, biomes) and pass the rest as `entranceCandidates`; tests and debug views use them as is.
 */
export function proposeEntranceCandidates(seed: number, preset: WorldSizePreset, extent?: UndergroundExtent): TilePoint[] {
  const tiles = worldDimensions(preset).tiles;
  const area = createArea(tiles, extent);
  const pts = poissonDisc(new Rng(undergroundSeed(seed, 0, 'kandidaten')), tiles, tiles, LINKS.candidateSpacingTiles, { accept: area });
  const out: TilePoint[] = [];
  for (let i = 0; i < pts.count; i++) out.push({ tx: Math.floor(pts.xs[i] as number), ty: Math.floor(pts.ys[i] as number) });
  return out.sort(comparePoints);
}

// ---------------------------------------------------------------------------------------------
// Layer network
// ---------------------------------------------------------------------------------------------

interface AccessPoint {
  readonly x: number;
  readonly y: number;
  readonly link: number;
}

interface MutableNode {
  x: number;
  y: number;
  coreRadius: number;
  softRadius: number;
  role: NodeRole;
  feature: NodeFeature;
  system: number;
  link: number;
}

/** Callbacks of `buildLayer` into the link table of the plan. */
interface LinkSink {
  /** An access point of the layer belongs to `system`. */
  entered(link: number, system: number): void;
  /** A shaft down from `system` at tile (tx, ty); returns its link id. */
  shaft(tx: number, ty: number, system: number): number;
}

function find(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r] as number;
  let c = i;
  while (parent[c] !== r) {
    const next = parent[c] as number;
    parent[c] = r;
    c = next;
  }
  return r;
}

function union(parent: Int32Array, a: number, b: number): boolean {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra === rb) return false;
  // Smaller root wins: the result does not depend on the order of unions.
  if (ra < rb) parent[rb] = ra;
  else parent[ra] = rb;
  return true;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/**
 * Picks `count` of the `eligible` nodes spread evenly over the area they cover: farthest-point
 * sampling from a random first node, then `LLOYD_ITERATIONS` rounds of Lloyd relaxation (each
 * centre moves to the mean of the nodes closest to it) and the node nearest to each centre.
 * Farthest-point sampling alone favours the rim; the relaxed centres sit in the middle of their
 * share, so shafts and slots cover the interior as well.
 */
function spreadPick(nodes: readonly MutableNode[], eligible: readonly number[], count: number, rng: Rng): number[] {
  const k = Math.min(count, eligible.length);
  if (k <= 0) return [];
  const pos = (n: number): MutableNode => nodes[n] as MutableNode;
  const cx: number[] = [];
  const cy: number[] = [];
  const first = pos(eligible[rng.int(0, eligible.length)] as number);
  cx.push(first.x);
  cy.push(first.y);
  const best = new Float64Array(eligible.length).fill(Infinity);
  while (cx.length < k) {
    let arg = 0;
    let far = -1;
    eligible.forEach((n, j) => {
      const d = dist2(pos(n).x, pos(n).y, cx[cx.length - 1] as number, cy[cy.length - 1] as number);
      if (d < (best[j] as number)) best[j] = d;
      if ((best[j] as number) > far) {
        far = best[j] as number;
        arg = j;
      }
    });
    const n = pos(eligible[arg] as number);
    cx.push(n.x);
    cy.push(n.y);
  }
  const nearestCentre = (x: number, y: number): number => {
    let c = 0;
    let bestD = Infinity;
    for (let i = 0; i < k; i++) {
      const d = dist2(x, y, cx[i] as number, cy[i] as number);
      if (d < bestD) {
        bestD = d;
        c = i;
      }
    }
    return c;
  };
  for (let iter = 0; iter < LLOYD_ITERATIONS; iter++) {
    const sx = new Float64Array(k);
    const sy = new Float64Array(k);
    const count2 = new Int32Array(k);
    for (const n of eligible) {
      const c = nearestCentre(pos(n).x, pos(n).y);
      sx[c] = (sx[c] as number) + pos(n).x;
      sy[c] = (sy[c] as number) + pos(n).y;
      count2[c] = (count2[c] as number) + 1;
    }
    for (let i = 0; i < k; i++) {
      if (count2[i] === 0) continue;
      cx[i] = (sx[i] as number) / (count2[i] as number);
      cy[i] = (sy[i] as number) / (count2[i] as number);
    }
  }
  const picked: number[] = [];
  for (let i = 0; i < k; i++) {
    let arg = -1;
    let bestD = Infinity;
    for (const n of eligible) {
      if (picked.includes(n)) continue;
      const d = dist2(pos(n).x, pos(n).y, cx[i] as number, cy[i] as number);
      if (d < bestD) {
        bestD = d;
        arg = n;
      }
    }
    if (arg >= 0) picked.push(arg);
  }
  return picked;
}

/** Meandering polyline from a to b (midpoint displacement), clamped into the world margin. */
function meanderPolyline(ax: number, ay: number, bx: number, by: number, p: LayerParams, rng: Rng, lo: number, hi: number): number[] {
  const out = [ax, ay];
  const clamp = (v: number): number => (v < lo ? lo : v > hi ? hi : v);
  const split = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= p.segmentTiles) {
      out.push(x1, y1);
      return;
    }
    const off = rng.float(-1, 1) * p.meander * len;
    const mx = clamp((x0 + x1) * 0.5 - (dy / len) * off);
    const my = clamp((y0 + y1) * 0.5 + (dx / len) * off);
    split(x0, y0, mx, my);
    split(mx, my, x1, y1);
  };
  split(ax, ay, bx, by);
  return out;
}

/** Primitive list under construction. */
class PrimList {
  private data: number[] = [];

  add(kind: number, ax: number, ay: number, bx: number, by: number, core: number, soft: number, jitter: number, band: number, node: number): void {
    this.data.push(kind, ax, ay, bx, by, core, soft, jitter, band, node);
  }

  disc(x: number, y: number, core: number, soft: number, jitter: number, band: number, node: number): void {
    this.add(PRIM_DISC, x, y, x, y, core, soft, jitter, band, node);
  }

  polyline(points: readonly number[], core: number, soft: number, jitter: number, band: number): void {
    for (let i = 0; i + POINT_STRIDE < points.length; i += POINT_STRIDE) {
      this.add(PRIM_CAPSULE, points[i] as number, points[i + 1] as number, points[i + POINT_STRIDE] as number, points[i + POINT_STRIDE + 1] as number, core, soft, jitter, band, -1);
    }
  }

  build(): Float64Array {
    return Float64Array.from(this.data);
  }
}

/** Buckets primitives per chunk by their influence box (soft + jitter + band). */
function bucketPrims(prims: Float64Array, count: number, chunks: number): { start: Int32Array; items: Int32Array } {
  const range = (i: number): [number, number, number, number] => {
    const o = i * PRIM_STRIDE;
    const reach = (prims[o + P_SOFT] as number) + (prims[o + P_JITTER] as number) + (prims[o + P_BAND] as number) + 1;
    const ax = prims[o + P_AX] as number;
    const ay = prims[o + P_AY] as number;
    const bx = prims[o + P_BX] as number;
    const by = prims[o + P_BY] as number;
    const c = (v: number): number => Math.min(chunks - 1, Math.max(0, Math.floor(v / CHUNK_SIZE)));
    return [c(Math.min(ax, bx) - reach), c(Math.min(ay, by) - reach), c(Math.max(ax, bx) + reach), c(Math.max(ay, by) + reach)];
  };
  const counts = new Int32Array(chunks * chunks + 1);
  for (let i = 0; i < count; i++) {
    const [x0, y0, x1, y1] = range(i);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts[y * chunks + x + 1] = (counts[y * chunks + x + 1] as number) + 1;
  }
  for (let b = 1; b < counts.length; b++) counts[b] = (counts[b] as number) + (counts[b - 1] as number);
  const items = new Int32Array(counts[counts.length - 1] as number);
  const fill = counts.slice(0, chunks * chunks);
  for (let i = 0; i < count; i++) {
    const [x0, y0, x1, y1] = range(i);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const b = y * chunks + x;
        items[fill[b] as number] = i;
        fill[b] = (fill[b] as number) + 1;
      }
    }
  }
  return { start: counts, items };
}

interface LayerBuild {
  readonly plan: UndergroundLayerPlan;
  /** Access points of the layer below (the shafts down). */
  readonly below: readonly AccessPoint[];
  readonly slots: readonly CaveSlot[];
}

/** Builds the network of one layer around its access points. */
function buildLayer(seed: number, preset: WorldSizePreset, tiles: number, p: LayerParams, access: readonly AccessPoint[], area: AreaTest, sink: LinkSink): LayerBuild {
  const layer = p.layer;
  const chunks = tiles / CHUNK_SIZE;
  const nodes: MutableNode[] = [];

  // Systems: union of neighbouring access points (some systems get two ways out).
  const parent = new Int32Array(access.length).map((_, i) => i);
  const mergeRng = layerRng(seed, layer, 'systeme');
  const mergeDistance = LINKS.mergeDistanceFactor * LINKS.entranceMinSpacingTiles;
  const merge2 = mergeDistance * mergeDistance;
  for (let i = 0; i < access.length; i++) {
    for (let j = i + 1; j < access.length; j++) {
      const a = access[i] as AccessPoint;
      const b = access[j] as AccessPoint;
      if (dist2(a.x, a.y, b.x, b.y) < merge2 && mergeRng.bool(LINKS.mergeChance)) union(parent, i, j);
    }
  }
  const systemOfRoot = new Map<number, number>();
  const accessSystem = access.map((_, i) => {
    const r = find(parent, i);
    let s = systemOfRoot.get(r);
    if (s === undefined) {
      s = systemOfRoot.size;
      systemOfRoot.set(r, s);
    }
    return s;
  });
  access.forEach((a, i) => {
    const system = accessSystem[i] as number;
    nodes.push({ x: a.x, y: a.y, coreRadius: LINKS.accessCoreRadius, softRadius: LINKS.accessSoftRadius, role: 'zugang', feature: 'aufstieg', system, link: a.link });
    sink.entered(a.link, system);
  });

  // Caverns: Poisson points near an access point of the layer.
  if (access.length > 0) {
    const clearance2 = LINKS.accessClearanceTiles * LINKS.accessClearanceTiles;
    const reach2 = p.reachTiles[preset] * p.reachTiles[preset];
    const nearest = (x: number, y: number): { index: number; d2: number } => {
      let index = -1;
      let best = Infinity;
      access.forEach((a, i) => {
        const d = dist2(a.x, a.y, x, y);
        if (d < best) {
          best = d;
          index = i;
        }
      });
      return { index, d2: best };
    };
    const pts = poissonDisc(layerRng(seed, layer, 'kavernen'), tiles, tiles, p.cavernSpacing, {
      accept: (x, y) => {
        if (!area(x, y)) return false;
        const n = nearest(x, y);
        return n.d2 >= clearance2 && n.d2 <= reach2;
      },
    });
    const radiusRng = layerRng(seed, layer, 'radien');
    for (let k = 0; k < pts.count; k++) {
      const x = pts.xs[k] as number;
      const y = pts.ys[k] as number;
      const soft = radiusRng.float(p.cavernRadiusMin, p.cavernRadiusMax);
      nodes.push({ x, y, coreRadius: soft * p.coreFraction, softRadius: soft, role: 'kaverne', feature: 'keine', system: accessSystem[nearest(x, y).index] as number, link: -1 });
    }
  }
  const systemCount = systemOfRoot.size;
  const members: number[][] = Array.from({ length: systemCount }, () => []);
  nodes.forEach((n, i) => (members[n.system] as number[]).push(i));

  // Tunnels: minimum spanning tree per system plus loops.
  const edges: [number, number][] = [];
  const adjacent = new Set<number>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * nodes.length + b : b * nodes.length + a);
  const loopRng = layerRng(seed, layer, 'schleifen');
  const loopMax = p.loopMaxFactor * p.cavernSpacing;
  const loopMax2 = loopMax * loopMax;
  for (const list of members) {
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = nodes[list[i] as number] as MutableNode;
        const b = nodes[list[j] as number] as MutableNode;
        pairs.push([dist2(a.x, a.y, b.x, b.y), list[i] as number, list[j] as number]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const tree = new Int32Array(nodes.length).map((_, i) => i);
    for (const [, a, b] of pairs) {
      if (union(tree, a, b)) {
        edges.push([a, b]);
        adjacent.add(edgeKey(a, b));
      }
    }
    for (const i of list) {
      const a = nodes[i] as MutableNode;
      let best = -1;
      let bestD = loopMax2;
      for (const j of list) {
        if (j === i || adjacent.has(edgeKey(i, j))) continue;
        const b = nodes[j] as MutableNode;
        const d = dist2(a.x, a.y, b.x, b.y);
        if (d <= bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best >= 0 && loopRng.bool(p.loopChance)) {
        edges.push([i, best]);
        adjacent.add(edgeKey(i, best));
      }
    }
  }
  const lo = AREA.edgeMarginTiles * 0.5;
  const hi = tiles - lo;
  const tunnelRng = layerRng(seed, layer, 'gaenge');
  const tunnels: CaveTunnel[] = edges.map(([a, b]) => {
    const na = nodes[a] as MutableNode;
    const nb = nodes[b] as MutableNode;
    const coreRadius = tunnelRng.float(p.tunnelCoreMin, p.tunnelCoreMax);
    return { system: na.system, kind: 'gang', from: a, to: b, coreRadius, points: meanderPolyline(na.x, na.y, nb.x, nb.y, p, tunnelRng, lo, hi) };
  });

  // Features: shafts down, place slots, lakes, special caverns (in this order, each on the rest).
  const caverns = nodes.map((n, i) => (n.role === 'kaverne' ? i : -1)).filter((i) => i >= 0);
  const below: AccessPoint[] = spreadPick(nodes, caverns, p.shaftsDown[preset], layerRng(seed, layer, 'schaechte')).map((i) => {
    const n = nodes[i] as MutableNode;
    const tx = Math.floor(n.x);
    const ty = Math.floor(n.y);
    n.feature = 'abstieg';
    n.link = sink.shaft(tx, ty, n.system);
    return { x: tx + 0.5, y: ty + 0.5, link: n.link };
  });
  const slotEligible = caverns.filter((i) => (nodes[i] as MutableNode).feature === 'keine' && (nodes[i] as MutableNode).coreRadius >= p.slotMinCore);
  const slots: CaveSlot[] = spreadPick(nodes, slotEligible, p.slots[preset], layerRng(seed, layer, 'orte')).map((i) => {
    const n = nodes[i] as MutableNode;
    n.feature = 'ort';
    return { layer, tx: Math.floor(n.x), ty: Math.floor(n.y), radius: n.coreRadius, system: n.system, node: i };
  });
  const lakeRng = layerRng(seed, layer, 'seen');
  const specialRng = layerRng(seed, layer, 'besonders');
  for (const i of caverns) {
    const n = nodes[i] as MutableNode;
    if (n.feature !== 'keine') continue;
    if (n.coreRadius * p.lake.cavernScale >= p.lake.minCore && lakeRng.bool(p.lake.chance)) {
      n.feature = p.lake.kind === 'lava' ? 'lavasee' : 'see';
      n.coreRadius *= p.lake.cavernScale;
      n.softRadius *= p.lake.cavernScale;
    } else if (specialRng.bool(p.special.chance)) n.feature = p.special.kind;
  }

  // Primitives: chambers (+ satellites), tunnels, side passages.
  const prims = new PrimList();
  const satRng = layerRng(seed, layer, 'nebenkammern');
  const wormRng = layerRng(seed, layer, 'seitengaenge');
  nodes.forEach((n, i) => {
    if (n.role === 'zugang') {
      prims.disc(n.x, n.y, n.coreRadius, n.softRadius, LINKS.accessJitter, LINKS.accessBand, i);
      return;
    }
    const jitter = p.cavernJitter * n.softRadius;
    prims.disc(n.x, n.y, n.coreRadius, n.softRadius, jitter, p.cavernBand, i);
    const satellites = satRng.int(0, p.satellitesMax + 1);
    for (let s = 0; s < satellites; s++) {
      const [ux, uy] = DIRECTIONS[satRng.int(0, DIRECTION_COUNT)] as readonly [number, number];
      const soft = satRng.float(SHAPES.satelliteSizeMin, SHAPES.satelliteSizeMax) * n.softRadius;
      const core = soft * p.coreFraction;
      // The cores overlap, so the satellite is always joined to the main chamber.
      const offset = Math.max(0, Math.min(satRng.float(SHAPES.satelliteOffsetMin, SHAPES.satelliteOffsetMax) * n.softRadius, n.coreRadius + core - SHAPES.satelliteCoreOverlap));
      prims.disc(n.x + ux * offset, n.y + uy * offset, core, soft, p.cavernJitter * soft, p.cavernBand, i);
    }
  });
  for (const t of tunnels) prims.polyline(t.points, t.coreRadius, t.coreRadius + p.tunnelSoftExtra, p.tunnelJitter, p.tunnelBand);
  const margin = AREA.edgeMarginTiles;
  for (const i of caverns) {
    const n = nodes[i] as MutableNode;
    if (!wormRng.bool(p.wormChance)) continue;
    const count = wormRng.bool(SHAPES.wormSecondChance) ? 2 : 1;
    for (let w = 0; w < count; w++) {
      let dir = wormRng.int(0, DIRECTION_COUNT);
      const steps = wormRng.int(p.wormStepsMin, p.wormStepsMax + 1);
      const pts = [n.x, n.y];
      let x = n.x;
      let y = n.y;
      for (let s = 0; s < steps; s++) {
        if (wormRng.bool(p.wormTurnChance)) dir = (dir + (wormRng.bool() ? 1 : DIRECTION_COUNT - 1)) % DIRECTION_COUNT;
        const [ux, uy] = DIRECTIONS[dir] as readonly [number, number];
        const nx = x + ux * p.wormStepTiles;
        const ny = y + uy * p.wormStepTiles;
        if (nx < margin || ny < margin || nx >= tiles - margin || ny >= tiles - margin) break;
        x = nx;
        y = ny;
        pts.push(x, y);
      }
      const chamber = wormRng.bool(p.wormChamberChance);
      const chamberSoft = wormRng.float(SHAPES.wormChamberMin, SHAPES.wormChamberMax);
      if (pts.length < 2 * POINT_STRIDE) continue;
      const core = p.tunnelCoreMin;
      prims.polyline(pts, core, core + p.tunnelSoftExtra, p.tunnelJitter, p.tunnelBand);
      if (chamber) prims.disc(x, y, chamberSoft * p.coreFraction, chamberSoft, p.cavernJitter * chamberSoft, p.tunnelBand, -1);
      tunnels.push({ system: n.system, kind: 'seitengang', from: i, to: -1, coreRadius: core, points: pts });
    }
  }
  const primData = prims.build();
  const primCount = primData.length / PRIM_STRIDE;
  const buckets = bucketPrims(primData, primCount, chunks);
  const systems: CaveSystem[] = members.map((list, id) => ({ id, links: list.filter((i) => (nodes[i] as MutableNode).role === 'zugang').map((i) => (nodes[i] as MutableNode).link), nodes: list }));
  const frozenNodes: CaveNode[] = nodes.map((n) => ({ ...n }));
  return {
    plan: { layer, nodes: frozenNodes, tunnels, systems, prims: primData, primCount, chunks, bucketStart: buckets.start, bucketItems: buckets.items },
    below,
    slots,
  };
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

/** Mutable link record while the layers are built. */
interface LinkDraft {
  id: number;
  kind: 'eingang' | 'schacht';
  upper: UpperLayer;
  lower: UndergroundLayer;
  tx: number;
  ty: number;
  upperSystem: number;
  lowerSystem: number;
}

/**
 * Builds the underground of a world (pure, deterministic). Entrances are selected from the
 * candidates with `selectCaveEntrances`; the surface places its cave mouths at `plan.links` of
 * kind `eingang` (tile `tx, ty`).
 */
export function createUndergroundPlan(input: UndergroundInput): UndergroundPlan {
  const seed = normalizeSeed(input.seed);
  const preset = input.preset;
  const tiles = worldDimensions(preset).tiles;
  const area = createArea(tiles, input.extent);
  const links: LinkDraft[] = selectCaveEntrances(seed, preset, input.entranceCandidates, input.extent).map((e, id) => ({
    id,
    kind: 'eingang',
    upper: 0,
    lower: -1,
    tx: e.tx,
    ty: e.ty,
    upperSystem: -1,
    lowerSystem: -1,
  }));
  const layers: UndergroundLayerPlan[] = [];
  const slots: CaveSlot[] = [];
  let access: readonly AccessPoint[] = links.map((l) => ({ x: l.tx + 0.5, y: l.ty + 0.5, link: l.id }));
  for (const layer of UNDERGROUND_LAYERS) {
    const sink: LinkSink = {
      entered(link, system) {
        (links[link] as LinkDraft).lowerSystem = system;
      },
      shaft(tx, ty, system) {
        const id = links.length;
        // Shafts only leave −1 and −2 (Glutadern has no shafts down).
        links.push({ id, kind: 'schacht', upper: layer as UpperLayer, lower: (layer - 1) as UndergroundLayer, tx, ty, upperSystem: system, lowerSystem: -1 });
        return id;
      },
    };
    const built = buildLayer(seed, preset, tiles, layerParams(layer), access, area, sink);
    layers.push(built.plan);
    slots.push(...built.slots);
    access = built.below;
  }
  return { version: UNDERGROUND_VERSION, seed, preset, tiles, links: links.map((l) => ({ ...l })), slots, layers };
}

/** The network of one underground layer. */
export function layerPlanOf(plan: UndergroundPlan, layer: UndergroundLayer): UndergroundLayerPlan {
  return plan.layers[-layer - 1] as UndergroundLayerPlan;
}

/** Stable 64 bit hash of a plan (version, links, slots, nodes and primitives of every layer). */
export function undergroundPlanHash(plan: UndergroundPlan): string {
  const h = new Fnv1a64();
  h.update(Int32Array.of(plan.version, plan.seed, plan.tiles));
  const ints: number[] = [];
  for (const l of plan.links) ints.push(l.id, l.upper, l.lower, l.tx, l.ty, l.upperSystem, l.lowerSystem);
  for (const s of plan.slots) ints.push(s.layer, s.tx, s.ty, s.system, s.node);
  h.update(Int32Array.from(ints));
  for (const lp of plan.layers) {
    h.update(lp.prims);
    const nodeData: number[] = [];
    for (const n of lp.nodes) nodeData.push(n.x, n.y, n.coreRadius, n.softRadius, n.system, n.link, hashString(n.feature));
    h.update(Float64Array.from(nodeData));
  }
  return h.hex();
}
